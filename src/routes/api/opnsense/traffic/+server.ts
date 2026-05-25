import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

/**
 * Read one data frame from the OPNsense traffic SSE stream.
 * Endpoint: GET /api/diagnostics/traffic/stream?poll_interval=1
 * Each frame shape: { interfaces: { [name]: { name, bytes_received, bytes_transmitted, packets_received, packets_transmitted } }, time: number }
 *
 * We read TWO frames and compute the per-second delta so rates are meaningful.
 */
async function readTrafficFrames(
	host: string, key: string, secret: string
): Promise<{ rxRate: number; txRate: number; interfaces: Record<string, { name: string; rxRate: number; txRate: number }> }> {
	const credentials = Buffer.from(`${key}:${secret}`).toString('base64');
	const res = await fetch(`${host}/api/diagnostics/traffic/stream?poll_interval=1`, {
		headers: { Authorization: `Basic ${credentials}` }
	});
	if (!res.ok) throw new Error(`OPNsense traffic stream ${res.status}`);
	if (!res.body) throw new Error('No stream body');

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let frames: any[] = [];

	try {
		for (let i = 0; i < 40 && frames.length < 2; i++) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				if (!line.startsWith('data:')) continue;
				try {
					const parsed = JSON.parse(line.substring(5).trim());
					if (parsed?.interfaces) frames.push(parsed);
				} catch { /* skip malformed */ }
			}
		}
	} finally {
		await reader.cancel();
	}

	if (frames.length === 0) throw new Error('No traffic data in stream');

	// Use the last frame directly — OPNsense already emits deltas (bytes since last poll),
	// so we don't need to compute differences ourselves.
	const frame = frames[frames.length - 1];
	const timeDelta = frames.length >= 2
		? Math.max(1, (frame.time ?? 1) - (frames[0].time ?? 0))
		: 1;

	const ifaceMap: Record<string, { name: string; rxRate: number; txRate: number }> = {};
	let totalRx = 0, totalTx = 0;

	for (const [dev, info] of Object.entries(frame.interfaces as Record<string, any>)) {
		if (typeof info !== 'object' || !info) continue;
		// bytes_received / bytes_transmitted are deltas per poll interval
		const rx = (info.bytes_received   ?? info['bytes received']   ?? 0);
		const tx = (info.bytes_transmitted ?? info['bytes transmitted'] ?? 0);
		// Convert bytes-per-interval to bits-per-second
		const rxBps = (rx / timeDelta) * 8;
		const txBps = (tx / timeDelta) * 8;
		ifaceMap[dev] = { name: info.name ?? dev, rxRate: rxBps, txRate: txBps };
		totalRx += rxBps;
		totalTx += txBps;
	}

	return { rxRate: totalRx, txRate: totalTx, interfaces: ifaceMap };
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		const [host, apiKey, apiSecret] = await Promise.all([
			getSetting('opnsense_host'),
			getSetting('opnsense_api_key'),
			getSetting('opnsense_api_secret')
		]);

		if (!host || !apiKey || !apiSecret) {
			return json({ error: 'OPNsense not configured' }, { status: 400 });
		}

		const result = await readTrafficFrames(host, apiKey, apiSecret);
		return json({ ...result, timestamp: Date.now() });
	} catch (err: any) {
		return json({ error: err.message ?? 'Failed to fetch traffic data' }, { status: 500 });
	}
};
