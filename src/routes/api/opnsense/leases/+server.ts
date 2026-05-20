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

		const data = await opnGet(host, apiKey, apiSecret, '/dhcpv4/leases/searchLease');

		// Normalise — OPNsense returns { rows: [...], total, ... }
		const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? []);

		const leases = rows.map((l: any) => ({
			ip: l.address ?? l.ip ?? '',
			mac: l.hwaddr ?? l.mac ?? '',
			hostname: l.hostname ?? l.client_hostname ?? '',
			description: l.descr ?? l.description ?? '',
			start: l.starts ?? l.start ?? '',
			end: l.ends ?? l.end ?? '',
			state: l.binding ?? l.state ?? 'active',
			interface: l['if'] ?? l.interface ?? ''
		}));

		return json({ leases, total: leases.length });
	} catch (err: any) {
		return json({ error: err.message ?? 'Failed to fetch DHCP leases' }, { status: 500 });
	}
};
