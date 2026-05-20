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

// Fetch QEMU guest agent IPs — returns first non-loopback IPv4, or null
async function getVmIp(host: string, tokenId: string, tokenSecret: string, node: string, vmid: number): Promise<string | null> {
	try {
		const ifaces = await pveGet(host, tokenId, tokenSecret, `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`);
		const results: any[] = ifaces?.result ?? [];
		for (const iface of results) {
			if (iface.name === 'lo') continue;
			for (const addr of (iface['ip-addresses'] ?? [])) {
				if (addr['ip-address-type'] === 'ipv4' && !addr['ip-address'].startsWith('127.')) {
					return addr['ip-address'];
				}
			}
		}
		return null;
	} catch {
		return null;
	}
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
		const running = allGuests.filter((g: any) => g.status === 'running');
		const stopped = allGuests.filter((g: any) => g.status === 'stopped');

		// Fetch IPs for running guests in parallel
		const guestIps: Record<number, string | null> = {};
		await Promise.all(allGuests.map(async (g: any) => {
			if (g.status !== 'running') { guestIps[g.vmid] = null; return; }
			const isLxc = !!lxcsData.find((l: any) => l.vmid === g.vmid);
			if (isLxc) {
				guestIps[g.vmid] = g.ip ?? null;
			} else {
				guestIps[g.vmid] = await getVmIp(host, tokenId, tokenSecret, nodeName, g.vmid);
			}
		}));

		// Build RRD points — last 60 mins
		// PVE node RRD field names vary slightly across versions; try all known variants
		const memTotal = ns.memory?.total ?? 0;
		const rrdPoints = rrdData.map((p: any) => {
			const memUsed = p.memory ?? p.memused ?? null;
			const memMax  = p.memtotal ?? p.maxmem ?? (memTotal > 0 ? memTotal : null);
			return {
				t: p.time,
				cpu: p.cpu ?? null,
				netin: p.netin ?? null,
				netout: p.netout ?? null,
				mem: (memUsed != null && memMax != null && memMax > 0) ? memUsed / memMax : null
			};
		});

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
				vmsRunning: running.length,
				vmsStopped: stopped.length,
				vmsTotal: allGuests.length,
				guests: allGuests.map((g: any) => ({
					vmid: g.vmid,
					name: g.name ?? `VM ${g.vmid}`,
					status: g.status,
					type: vmsData.find((v: any) => v.vmid === g.vmid) ? 'qemu' : 'lxc',
					cpu: g.cpu ?? 0,
					mem: g.mem ?? 0,
					maxmem: g.maxmem ?? 0,
					uptime: g.uptime ?? null,
					ip: guestIps[g.vmid] ?? null
				}))
			},
			rrd: rrdPoints
		};
	} catch (err: any) {
		console.error('Proxmox page load error:', err);
		return { error: err.message ?? 'Failed to connect to Proxmox', data: null, rrd: null, hasManageToken: false };
	}
};
