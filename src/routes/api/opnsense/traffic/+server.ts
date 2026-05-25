import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

async function opnGet(host: string, key: string, secret: string, path: string) {
	const credentials = Buffer.from(`${key}:${secret}`).toString('base64');
	const res = await fetch(`${host}/api${path}`, {
		headers: { Authorization: `Basic ${credentials}` }
	});
	if (!res.ok) throw new Error(`OPNsense API error ${res.status}: ${res.statusText}`);
	return res;
}

async function readTrafficStream(host: string, key: string, secret: string) {
	const res = await opnGet(host, key, secret, '/diagnostics/traffic/stream?poll_interval=1');
	if (!res.body) throw new Error('No stream body');

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const frames: any[] = [];

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
				} catch {}
			}
		}
	} finally {
		await reader.cancel();
	}

	if (frames.length === 0) throw new Error('No traffic data in stream');

	const firstFrame = frames[0];
	const frame = frames[frames.length - 1];
	const timeDelta = frames.length >= 2
		? Math.max(1, (frame.time ?? 1) - (firstFrame.time ?? 0))
		: 1;

	const ifaceMap: Record<string, { name: string; rxRate: number; txRate: number }> = {};
	let totalRx = 0, totalTx = 0;

	for (const [dev, info] of Object.entries(frame.interfaces as Record<string, any>)) {
		if (typeof info !== 'object' || !info) continue;
		const prev = (firstFrame.interfaces as Record<string, any>)?.[dev] ?? {};
		// Support both naming conventions OPNsense has used across versions
		const rxNow  = Number(info.bytes_received    ?? info['bytes received']    ?? info.inbytes  ?? 0);
		const txNow  = Number(info.bytes_transmitted ?? info['bytes transmitted'] ?? info.outbytes ?? 0);
		const rxPrev = Number(prev.bytes_received    ?? prev['bytes received']    ?? prev.inbytes  ?? 0);
		const txPrev = Number(prev.bytes_transmitted ?? prev['bytes transmitted'] ?? prev.outbytes ?? 0);
		const rx = Math.max(0, rxNow - rxPrev);
		const tx = Math.max(0, txNow - txPrev);
		const rxBps = (rx / timeDelta) * 8;
		const txBps = (tx / timeDelta) * 8;
		ifaceMap[dev] = { name: info.name ?? dev, rxRate: rxBps, txRate: txBps };
		totalRx += rxBps;
		totalTx += txBps;
	}

	return { rxRate: totalRx, txRate: totalTx, interfaces: ifaceMap, source: 'stream' };
}

async function readInterfacesFallback(host: string, key: string, secret: string) {
	// Fallback: interfaces overview provides per-interface byte counters without streaming
	const res = await opnGet(host, key, secret, '/interfaces/overview/interfaces_info');
	const raw = await res.json();
	const rows: any[] = Array.isArray(raw)
		? raw
		: Array.isArray(raw?.rows)
			? raw.rows
			: Object.values(raw?.interfaces ?? raw ?? {});

	const ifaceMap: Record<string, { name: string; rxRate: number; txRate: number }> = {};
	let totalRx = 0, totalTx = 0;

	for (const row of rows) {
		if (typeof row !== 'object' || !row) continue;
		const dev = String(row.identifier ?? row.if ?? row.device ?? row.name ?? '');
		if (!dev) continue;
		// These are per-second rate fields the overview endpoint exposes
		const rxBps = Number(row.inpktrate ?? row.rxbps ?? row['bytes received'] ?? 0);
		const txBps = Number(row.outpktrate ?? row.txbps ?? row['bytes transmitted'] ?? 0);
		ifaceMap[dev] = { name: row.description ?? row.descr ?? dev, rxRate: rxBps, txRate: txBps };
		totalRx += rxBps;
		totalTx += txBps;
	}

	return { rxRate: totalRx, txRate: totalTx, interfaces: ifaceMap, source: 'overview' };
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

		// Primary: streaming traffic endpoint — gives accurate byte deltas
		try {
			const result = await readTrafficStream(host, apiKey, apiSecret);
			// Only accept if at least one interface has non-zero traffic
			const hasData = Object.values(result.interfaces).some(
				(i: any) => i.rxRate > 0 || i.txRate > 0
			);
			if (hasData) return json({ ...result, timestamp: Date.now() });
		} catch (streamErr) {
			// Stream failed — try fallback below
		}

		// Fallback: interfaces overview — less granular but widely available
		const fallback = await readInterfacesFallback(host, apiKey, apiSecret);
		return json({ ...fallback, timestamp: Date.now() });
	} catch (err: any) {
		return json({ error: err.message ?? 'Failed to fetch traffic data' }, { status: 500 });
	}
};
