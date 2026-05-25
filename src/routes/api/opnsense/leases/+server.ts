import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

async function opnGet(host: string, key: string, secret: string, path: string) {
	const credentials = Buffer.from(`${key}:${secret}`).toString('base64');
	const res = await fetch(`${host}/api${path}`, {
		headers: { Authorization: `Basic ${credentials}` }
	});
	if (!res.ok) throw new Error(`OPNsense API error ${res.status}: ${res.statusText}`);
	return res.json();
}

function normalizeLease(row: any) {
	return {
		ip:          row.address     ?? row.ip       ?? row.ipaddr    ?? '',
		mac:         row.hwaddr      ?? row.mac      ?? row.macaddr   ?? '',
		hostname:    row.hostname    ?? row.host     ?? row.clienthostname ?? '',
		description: row.description ?? row.desc     ?? '',
		start:       row.starts      ?? row.start    ?? '',
		end:         row.ends        ?? row.end      ?? row.expire    ?? '',
		state:       row.state       ?? row.type     ?? 'active',
		interface:   row.iface       ?? row.interface ?? row.if       ?? ''
	};
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

		// dnsmasq leases endpoint — available in OPNsense 25.x+
		const raw = await opnGet(host, apiKey, apiSecret, '/dnsmasq/leases/search');
		const rows: any[] = Array.isArray(raw)
			? raw
			: Array.isArray(raw?.rows)
				? raw.rows
				: Array.isArray(raw?.leases)
					? raw.leases
					: [];

		const leases = rows
			.map(normalizeLease)
			.filter((l: any) => l.ip || l.mac || l.hostname);

		return json({ leases, total: leases.length, unavailable: false });
	} catch (err: any) {
		return json({ error: err.message ?? 'Failed to load dnsmasq leases' }, { status: 500 });
	}
};
