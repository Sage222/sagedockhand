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

function fmt(bytes: number) {
	if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
	return (bytes / 1e6).toFixed(0) + ' MB';
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
			return json({ error: 'Proxmox not configured. Go to Settings → Proxmox to set up your connection.' }, { status: 400 });
		}

		const nodeName = node ?? 'pve';

		const [nodeStatus, vms, lxcs] = await Promise.all([
			pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/status`),
			pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/qemu`),
			pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/lxc`)
		]);

		const allGuests = [...(vms ?? []), ...(lxcs ?? [])];
		const running = allGuests.filter((g: any) => g.status === 'running').length;
		const stopped = allGuests.filter((g: any) => g.status === 'stopped').length;

		return json({
			node: nodeName,
			cpu: nodeStatus.cpu ?? 0,
			cpuCores: nodeStatus.cpuinfo?.cpus ?? 0,
			memUsed: nodeStatus.memory?.used ?? 0,
			memTotal: nodeStatus.memory?.total ?? 0,
			rootFsUsed: nodeStatus.rootfs?.used ?? 0,
			rootFsTotal: nodeStatus.rootfs?.total ?? 0,
			uptime: nodeStatus.uptime ?? 0,
			vmsRunning: running,
			vmsStopped: stopped,
			vmsTotal: allGuests.length,
			guests: allGuests.map((g: any) => ({
				vmid: g.vmid,
				name: g.name ?? `VM ${g.vmid}`,
				status: g.status,
				type: vms?.find((v: any) => v.vmid === g.vmid) ? 'qemu' : 'lxc',
				cpu: g.cpu ?? 0,
				mem: g.mem ?? 0,
				maxmem: g.maxmem ?? 0
			}))
		});
	} catch (err: any) {
		console.error('Proxmox API error:', err);
		return json({ error: err.message ?? 'Failed to connect to Proxmox' }, { status: 500 });
	}
};
