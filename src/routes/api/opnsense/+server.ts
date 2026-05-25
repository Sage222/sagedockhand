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

async function fetchCpuFromStream(host: string, key: string, secret: string): Promise<number> {
	const credentials = Buffer.from(`${key}:${secret}`).toString('base64');
	const res = await fetch(`${host}/api/diagnostics/cpu_usage/stream`, {
		headers: { Authorization: `Basic ${credentials}` }
	});
	if (!res.ok) throw new Error(`OPNsense CPU stream ${res.status}`);
	if (!res.body) throw new Error('No readable stream body');

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let frameCount = 0;
	let buffer = '';

	try {
		for (let i = 0; i < 20; i++) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				if (!line.startsWith('data:')) continue;
				frameCount++;
				if (frameCount < 2) continue;
				try {
					const parsed = JSON.parse(line.substring(5).trim());
					if (typeof parsed?.total === 'number') return parsed.total;
				} catch { /* malformed frame */ }
			}
		}
	} finally {
		await reader.cancel();
	}
	throw new Error('No valid CPU data in stream');
}

function uptimeStr(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function parseSize(val: any): number {
	if (typeof val === 'number') return val;
	if (typeof val !== 'string') return 0;
	const m = val.trim().match(/^([\d.]+)\s*(TB|T|GB|G|MB|M|KB|K|B)?$/i);
	if (!m) return 0;
	const n = parseFloat(m[1]);
	switch ((m[2] ?? 'B').toUpperCase()) {
		case 'TB': case 'T': return Math.round(n * 1_099_511_627_776);
		case 'GB': case 'G': return Math.round(n * 1_073_741_824);
		case 'MB': case 'M': return Math.round(n * 1_048_576);
		case 'KB': case 'K': return Math.round(n * 1_024);
		default:   return Math.round(n);
	}
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
			return json(
				{ error: 'OPNsense not configured. Go to Settings → OPNsense to set up your connection.' },
				{ status: 400 }
			);
		}

		const [sysInfoResult, memResult, diskResult, timeResult, ifaceConfigResult, servicesResult] = await Promise.allSettled([
			opnGet(host, apiKey, apiSecret, '/diagnostics/system/system_information'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/system/system_resources'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/system/system_disk'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/system/system_time'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/interface/get_interface_config'),
			opnGet(host, apiKey, apiSecret, '/core/service/search')
		]);

		let cpuPct = 0;
		try { cpuPct = await fetchCpuFromStream(host, apiKey, apiSecret); } catch { /* non-fatal */ }

		const sys = sysInfoResult.status === 'fulfilled' ? sysInfoResult.value : {};
		const hostname: string = sys?.name ?? 'OPNsense';
		const version: string  = Array.isArray(sys?.versions) ? (sys.versions[0] ?? '') : '';

		let uptimeSeconds = 0;
		if (timeResult.status === 'fulfilled') {
			const t = timeResult.value;
			if (typeof t?.uptime === 'number') {
				uptimeSeconds = t.uptime;
			} else if (typeof t?.uptime === 'string') {
				const dm = t.uptime.match(/(\d+)\s+day[s]?,\s*(\d+):(\d+)/);
				if (dm) uptimeSeconds = parseInt(dm[1]) * 86400 + parseInt(dm[2]) * 3600 + parseInt(dm[3]) * 60;
				else {
					const hm = t.uptime.match(/(\d+):(\d+)/);
					if (hm) uptimeSeconds = parseInt(hm[1]) * 3600 + parseInt(hm[2]) * 60;
				}
			}
		}

		const memData  = memResult.status === 'fulfilled' ? memResult.value : {};
		const memStats = memData?.memory ?? memData ?? {};
		const memTotal = parseSize(memStats.total ?? memStats.total_real ?? 0);
		const memUsed  = parseSize(memStats.used  ?? memStats.used_real  ?? 0);

		let diskUsed = 0, diskTotal = 0;
		if (diskResult.status === 'fulfilled') {
			const disks: any[] = diskResult.value?.storage ?? diskResult.value?.devices ?? diskResult.value?.rows ?? [];
			const rootDisk = disks.find((d: any) => d.mountpoint === '/') ??
				           disks.sort((a: any, b: any) => parseSize(b.size) - parseSize(a.size))[0];
			if (rootDisk) {
				diskTotal = parseSize(rootDisk.size);
				if (rootDisk.used !== undefined) {
					diskUsed = parseSize(rootDisk.used);
				} else if (rootDisk.capacity !== undefined) {
					const pctNum = parseFloat(String(rootDisk.capacity).replace('%', ''));
					if (!isNaN(pctNum)) diskUsed = Math.round(diskTotal * pctNum / 100);
				}
			}
		}

		const ifCfg = ifaceConfigResult.status === 'fulfilled' ? ifaceConfigResult.value : {};
		const interfaceList: { name: string; device: string; ipv4: string; ipv6: string; status: string }[] = [];
		for (const [dev, info] of Object.entries(ifCfg as Record<string, any>)) {
			if (typeof info !== 'object' || !info) continue;
			interfaceList.push({
				name:   info.descr ?? info.name ?? dev,
				device: dev,
				ipv4:   info.ipaddr   ?? '',
				ipv6:   info.ipaddrv6 ?? '',
				status: info.enable === '1' || info.enable === true ? 'up' : 'down'
			});
		}

		let serviceList: { name: string; description: string; running: boolean }[] = [];
		if (servicesResult.status === 'fulfilled') {
			const _svcRaw = servicesResult.value;
			const _svcRows: any[] = Array.isArray(_svcRaw)
				? _svcRaw
				: Array.isArray((_svcRaw as any)?.rows)
					? (_svcRaw as any).rows
					: [];
			serviceList = _svcRows.map((s: any) => ({
				name:        s.name        ?? s.id   ?? 'unknown',
				description: s.description ?? '',
				running:     s.running === true || s.running === 1 || s.running === '1'
			}));
		}

		return json({
			hostname,
			version,
			uptime: uptimeStr(uptimeSeconds),
			uptimeSeconds,
			cpuPct: Math.round(cpuPct * 100) / 100,
			memUsed,
			memTotal,
			diskUsed,
			diskTotal,
			interfaces: interfaceList,
			services: serviceList,
			opnsenseHost: host
		});
	} catch (err: any) {
		console.error('OPNsense API error:', err);
		return json({ error: err.message ?? 'Failed to connect to OPNsense' }, { status: 500 });
	}
};
