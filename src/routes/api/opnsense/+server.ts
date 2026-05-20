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

function uptimeStr(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
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
			return json({ error: 'OPNsense not configured. Go to Settings → OPNsense to set up your connection.' }, { status: 400 });
		}

		// Fetch all data in parallel
		const [sysInfo, cpuData, memData, diskData, interfaceData, servicesData] = await Promise.allSettled([
			opnGet(host, apiKey, apiSecret, '/core/system/status'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/cpu_usage'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/memory'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/disk'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/networkinsight/getInterfaces'),
			opnGet(host, apiKey, apiSecret, '/core/menu/search')
		]);

		const sys = sysInfo.status === 'fulfilled' ? sysInfo.value : {};
		const cpu = cpuData.status === 'fulfilled' ? cpuData.value : {};
		const mem = memData.status === 'fulfilled' ? memData.value : {};
		const disk = diskData.status === 'fulfilled' ? diskData.value : {};
		const ifaces = interfaceData.status === 'fulfilled' ? interfaceData.value : {};
		const svcs = servicesData.status === 'fulfilled' ? servicesData.value : {};

		// Parse memory
		const memStats = mem?.memory ?? {};
		const memTotal = memStats.total ?? 0;
		const memUsed = memStats.used ?? (memStats.total - (memStats.free ?? 0)) ?? 0;

		// Parse CPU — OPNsense returns an array of per-core % strings or a total
		let cpuPct = 0;
		if (typeof cpu?.cpu === 'number') {
			cpuPct = cpu.cpu;
		} else if (Array.isArray(cpu?.cpu)) {
			const vals = cpu.cpu.map((v: string) => parseFloat(v)).filter((v: number) => !isNaN(v));
			cpuPct = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
		} else if (typeof cpu?.total === 'number') {
			cpuPct = cpu.total;
		}

		// Parse disk — find root partition
		const diskArr: any[] = Array.isArray(disk) ? disk : (disk?.storage ?? []);
		const rootDisk = diskArr.find((d: any) => d.mountpoint === '/' || d.device?.includes('da0') || d.device?.includes('nvme0')) ?? diskArr[0];
		const diskUsed = rootDisk?.used ?? 0;
		const diskTotal = rootDisk?.size ?? 0;

		// Parse interfaces — build IP map
		const interfaceList: { name: string; device: string; ipv4: string; ipv6: string; status: string }[] = [];
		const ifObj: Record<string, any> = typeof ifaces === 'object' ? ifaces : {};
		for (const [dev, info] of Object.entries(ifObj)) {
			if (typeof info !== 'object' || !info) continue;
			interfaceList.push({
				name: (info as any).name ?? dev,
				device: dev,
				ipv4: (info as any).ipaddr ?? (info as any).ipv4?.[0]?.ipaddr ?? '',
				ipv6: (info as any).ipaddrv6 ?? (info as any).ipv6?.[0]?.ipaddr ?? '',
				status: (info as any).status ?? 'unknown'
			});
		}

		// Parse services — try the running services endpoint
		let serviceList: { name: string; description: string; running: boolean }[] = [];
		try {
			const svcRunning = await opnGet(host, apiKey, apiSecret, '/core/service/getServices');
			if (Array.isArray(svcRunning)) {
				serviceList = svcRunning.map((s: any) => ({
					name: s.name ?? s.id ?? 'unknown',
					description: s.description ?? '',
					running: s.running === true || s.running === 1 || s.running === '1'
				}));
			}
		} catch {
			// Services endpoint optional — skip if unavailable
		}

		return json({
			hostname: sys.hostname ?? sys.product_name ?? 'OPNsense',
			version: sys.product_version ?? sys.product_series ?? '',
			uptime: uptimeStr(sys.uptime ?? 0),
			uptimeSeconds: sys.uptime ?? 0,
			cpuPct: Math.round(cpuPct * 100) / 100,
			memUsed,
			memTotal,
			diskUsed,
			diskTotal,
			interfaces: interfaceList,
			services: serviceList
		});
	} catch (err: any) {
		console.error('OPNsense API error:', err);
		return json({ error: err.message ?? 'Failed to connect to OPNsense' }, { status: 500 });
	}
};
