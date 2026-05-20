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

// Strip CIDR suffix from IP e.g. "10.0.0.205/24" -> "10.0.0.205"
// Returns null if the value is "dhcp", "dhcp6", empty, or not a real IP
function stripCidr(ip: string | null | undefined): string | null {
	if (!ip) return null;
	const raw = ip.split('/')[0].trim().toLowerCase();
	// Ignore DHCP placeholders and obviously non-IP values
	if (!raw || raw === 'dhcp' || raw === 'dhcp6' || raw === 'auto') return null;
	// Must look like an IP (contains dots or colons for IPv6)
	if (!raw.includes('.') && !raw.includes(':')) return null;
	return raw || null;
}

// Get IP for a QEMU VM via guest agent
async function getQemuIp(host: string, tokenId: string, tokenSecret: string, node: string, vmid: number): Promise<string | null> {
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

// Get IP for an LXC container.
// Priority:
//   1. /lxc/{vmid}/interfaces  — live kernel data, returns actual DHCP-assigned IP
//   2. top-level ip field from the status list (may be "dhcp" placeholder)
//   3. net0 from /lxc/{vmid}/config (also may be "dhcp" placeholder)
async function getLxcIp(host: string, tokenId: string, tokenSecret: string, node: string, g: any): Promise<string | null> {
	// 1. Query the live interfaces endpoint — this is the only reliable source for DHCP leases
	try {
		const ifaces: any[] = await pveGet(host, tokenId, tokenSecret, `/nodes/${node}/lxc/${g.vmid}/interfaces`);
		if (Array.isArray(ifaces)) {
			for (const iface of ifaces) {
				if (iface.name === 'lo') continue;
				// The interfaces endpoint returns inet/inet6 entries
				const ip = iface.inet ?? iface['ip-address'] ?? null;
				const stripped = stripCidr(ip);
				if (stripped) return stripped;
			}
		}
	} catch {
		// Not available on older PVE versions or insufficient permissions — fall through
	}

	// 2. Top-level ip field from the status list (some PVE versions, usually CIDR format)
	if (g.ip) {
		const stripped = stripCidr(g.ip);
		if (stripped) return stripped;
	}

	// 3. Fall back to reading config net0 field
	try {
		const config = await pveGet(host, tokenId, tokenSecret, `/nodes/${node}/lxc/${g.vmid}/config`);
		const net0: string = config?.net0 ?? '';
		// net0 looks like: "name=eth0,bridge=vmbr0,ip=10.0.0.205/24,..."
		// ip= may also be "dhcp" or "dhcp6" — stripCidr handles those
		const match = net0.match(/(?:^|,)ip=([^,]+)/);
		if (match) return stripCidr(match[1]);
	} catch {
		// silently ignore
	}
	return null;
}

// Module-level server-side cache — avoids re-fetching on every nav click
let cache: { ts: number; result: any } | null = null;
const CACHE_TTL_MS = 30_000;

export const load: PageServerLoad = async ({ cookies, depends }) => {
	// Register a dependency key so manual invalidateAll() still triggers a real fetch
	depends('proxmox:data');

	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return { error: 'Authentication required', data: null, rrd: null, hasManageToken: false };
	}

	// Return cached result if it's still fresh
	if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
		return cache.result;
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

		// Fetch IPs for all guests in parallel
		const guestIps: Record<number, string | null> = {};
		await Promise.all(allGuests.map(async (g: any) => {
			if (g.status !== 'running') { guestIps[g.vmid] = null; return; }
			const isLxc = !!lxcsData.find((l: any) => l.vmid === g.vmid);
			if (isLxc) {
				guestIps[g.vmid] = await getLxcIp(host, tokenId, tokenSecret, nodeName, g);
			} else {
				guestIps[g.vmid] = await getQemuIp(host, tokenId, tokenSecret, nodeName, g.vmid);
			}
		}));

		// Build RRD points — last 60 mins
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

		const result = {
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

		// Store in cache
		cache = { ts: Date.now(), result };
		return result;

	} catch (err: any) {
		console.error('Proxmox page load error:', err);
		// On error, return stale cache if available rather than showing an error
		if (cache) return cache.result;
		return { error: err.message ?? 'Failed to connect to Proxmox', data: null, rrd: null, hasManageToken: false };
	}
};
