import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

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

		const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

		// OPNsense DHCP leases require a POST to searchLease — a GET to this path returns 404.
		// Ref: https://docs.opnsense.org/development/api/core/dhcpv4.html
		const res = await fetch(`${host}/api/dhcpv4/leases/searchLease`, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${credentials}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				current: 1,
				rowCount: 9999,
				searchPhrase: '',
				sort: {}
			})
		});

		if (!res.ok) {
			throw new Error(`OPNsense DHCP API ${res.status}: ${res.statusText}`);
		}

		const data = await res.json();

		// Response shape: { rows: [...], rowCount: N, total: N, current: 1 }
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
