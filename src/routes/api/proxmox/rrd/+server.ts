import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

async function pveGet(host: string, tokenId: string, tokenSecret: string, path: string) {
	const res = await fetch(`${host}/api2/json${path}`, {
		headers: { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` }
	});
	if (!res.ok) throw new Error(`Proxmox API error ${res.status}: ${res.statusText}`);
	const body = await res.json();
	return body.data;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	try {
		const [host, tokenId, tokenSecret, node] = await Promise.all([
			getSetting('proxmox_host'),
			getSetting('proxmox_token_id'),
			getSetting('proxmox_token_secret'),
			getSetting('proxmox_node')
		]);
		if (!host || !tokenId || !tokenSecret) {
			return json({ error: 'Proxmox not configured' }, { status: 400 });
		}
		const nodeName = node ?? 'pve';
		// hour timeframe gives ~60 data points at 1min resolution
		const rrd = await pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/rrddata?timeframe=hour&cf=AVERAGE`);
		// rrd is array of objects with: time, cpu, memused, memtotal, netin, netout, roottotal, rootused, swaptotal, swapused
		// pressure stall fields: cpu_psi_avg10, mem_psi_avg10 (available in PVE 8+, may be absent)
		const points = (rrd ?? []).map((p: any) => ({
			t: p.time,
			cpu: p.cpu ?? null,
			netin: p.netin ?? null,
			netout: p.netout ?? null,
			cpuPsi: p.cpu_psi_avg10 ?? null,
			memPsi: p.mem_psi_avg10 ?? null
		}));
		return json({ points });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
