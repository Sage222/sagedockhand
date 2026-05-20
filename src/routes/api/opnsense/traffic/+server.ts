import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

async function opnGet(host: string, key: string, secret: string, path: string) {
	const credentials = Buffer.from(`${key}:${secret}`).toString('base64');
	const res = await fetch(`${host}/api${path}`, {
		headers: { Authorization: `Basic ${credentials}` }
	});
	if (!res.ok) throw new Error(`OPNsense API ${res.status}`);
	return res.json();
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

		// Fetch interface traffic stats
		const traffic = await opnGet(host, apiKey, apiSecret, '/diagnostics/traffic/interface');

		// OPNsense returns interfaces keyed by name with bytes_received/bytes_transmitted
		const interfaces: Record<string, { name: string; rxBytes: number; txBytes: number; rxRate: number; txRate: number }> = {};

		const ifObj: Record<string, any> = typeof traffic === 'object' ? (traffic?.interfaces ?? traffic) : {};
		for (const [dev, info] of Object.entries(ifObj)) {
			if (typeof info !== 'object' || !info) continue;
			interfaces[dev] = {
				name: (info as any).name ?? dev,
				rxBytes: (info as any)['bytes received'] ?? (info as any).bytes_received ?? 0,
				txBytes: (info as any)['bytes transmitted'] ?? (info as any).bytes_transmitted ?? 0,
				rxRate: (info as any).rate_in ?? (info as any)['bits received'] ?? 0,
				txRate: (info as any).rate_out ?? (info as any)['bits transmitted'] ?? 0
			};
		}

		return json({ interfaces, timestamp: Date.now() });
	} catch (err: any) {
		return json({ error: err.message ?? 'Failed to fetch traffic data' }, { status: 500 });
	}
};
