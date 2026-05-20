import type { PageServerLoad } from './$types';
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

export const load: PageServerLoad = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return { error: 'Authentication required', data: null, rrd: null, hasManageToken: false };
	}
	try {
		const [host, tokenId, tokenSecret, node, manageTokenId, manageTokenSecret] = await Promise.all([
			getSetting('proxmox_host'),
			getSetting('proxmox_token_id'),
			getSetting('proxmox_token_secret'),
			getSetting('proxmox_node'),
			getSetting('proxmox_manage_token_id'),
			getSetting('proxmox_manage_token_secret')
		]);

		if (!host || !tokenId || !tokenSecret) {
			return { notConfigured: true, data: null, rrd: null, hasManageToken: false };
		}

		const nodeName = node ?? 'pve';
		const hasManageToken = !!(manageTokenId && manageTokenSecret);

		const [nodeStatus, vms, lxcs, rrdRaw] = await Promise.allSettled([
			pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/status`),
			pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/qemu`),
			pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/lxc`),
			pveGet(host, tokenId, tokenSecret, `/nodes/${nodeName}/rrddata?timeframe=hour&cf=AVERAGE`)
		]);

		if (nodeStatus.status === 'rejected') throw new Error(nodeStatus.reason?.message ?? 'Failed to fetch node status');

		const ns = nodeStatus.value;
		const vmsData = vms.status === 'fulfilled' ? (vms.value ?? []) : [];
		const lxcsData = lxcs.status === 'fulfilled' ? (lxcs.value ?? []) : [];
		const rrdData = rrdRaw.status === 'fulfilled' ? (rrdRaw.value ?? []) : [];

		const allGuests = [...vmsData, ...lxcsData];
		const running = allGuests.filter((g: any) => g.status === 'running').length;
		const stopped = allGuests.filter((g: any) => g.status === 'stopped').length;

		// Build RRD points — last 60 mins
		const rrdPoints = rrdData.map((p: any) => ({
			t: p.time,
			cpu: p.cpu ?? null,
			netin: p.netin ?? null,
			netout: p.netout ?? null,
			cpuPsi: p.cpu_psi_avg10 ?? null,
			memPsi: p.mem_psi_avg10 ?? null
		}));

		return {
			notConfigured: false,
			error: null,
			hasManageToken,
			data: {
				node: nodeName,
				cpu: ns.cpu ?? 0,
				cpuCores: ns.cpuinfo?.cpus ?? 0,
				memUsed: ns.memory?.used ?? 0,
				memTotal: ns.memory?.total ?? 0,
				rootFsUsed: ns.rootfs?.used ?? 0,
				rootFsTotal: ns.rootfs?.total ?? 0,
				uptime: ns.uptime ?? 0,
				vmsRunning: running,
				vmsStopped: stopped,
				vmsTotal: allGuests.length,
				guests: allGuests.map((g: any) => ({
					vmid: g.vmid,
					name: g.name ?? `VM ${g.vmid}`,
					status: g.status,
					type: vmsData.find((v: any) => v.vmid === g.vmid) ? 'qemu' : 'lxc',
					cpu: g.cpu ?? 0,
					mem: g.mem ?? 0,
					maxmem: g.maxmem ?? 0
				}))
			},
			rrd: rrdPoints
		};
	} catch (err: any) {
		console.error('Proxmox page load error:', err);
		return { error: err.message ?? 'Failed to connect to Proxmox', data: null, rrd: null, hasManageToken: false };
	}
};
