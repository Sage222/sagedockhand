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

/**
 * Read the first valid data frame from the OPNsense CPU SSE stream.
 * The stream emits "data: {...}" lines continuously. We skip the first
 * frame (baseline) and return the second, which contains the real delta.
 */
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
				if (frameCount < 2) continue; // skip baseline frame
				try {
					const parsed = JSON.parse(line.substring(5).trim());
					// { total: number } — 0–100
					if (typeof parsed?.total === 'number') return parsed.total;
				} catch {
					// malformed frame — keep reading
				}
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

		// Fetch system info, memory, interfaces and services in parallel.
		// CPU uses a streaming endpoint so it runs separately.
		const [sysInfoResult, memResult, ifaceResult, servicesResult] = await Promise.allSettled([
			opnGet(host, apiKey, apiSecret, '/diagnostics/system/system_information'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/system/system_resources'),
			opnGet(host, apiKey, apiSecret, '/diagnostics/traffic/interface'),
			opnGet(host, apiKey, apiSecret, '/core/service/getServices')
		]);

		// CPU — streaming SSE endpoint
		let cpuPct = 0;
		try {
			cpuPct = await fetchCpuFromStream(host, apiKey, apiSecret);
		} catch {
			// Non-fatal — show 0 if stream unavailable
		}

		// --- System info ---
		// Actual API shape: { name: string, versions: [string, ...] }
		const sys = sysInfoResult.status === 'fulfilled' ? sysInfoResult.value : {};
		const hostname: string = sys?.name ?? 'OPNsense';
		const version: string = Array.isArray(sys?.versions) ? (sys.versions[0] ?? '') : '';

		// --- Uptime ---
		// system_information does not expose uptime as a number.
		// Parse it from versions[0] which looks like:
		// "OPNsense 26.1.6_2 ... up 3 days, 4:02"
		let uptimeSeconds = 0;
		const verStr: string = version;
		const upMatch = verStr.match(/up\s+(\d+)\s+day[s]?,\s*(\d+):(\d+)/);
		if (upMatch) {
			uptimeSeconds = parseInt(upMatch[1]) * 86400 + parseInt(upMatch[2]) * 3600 + parseInt(upMatch[3]) * 60;
		} else {
			const hrMatch = verStr.match(/up\s+(\d+):(\d+)/);
			if (hrMatch) uptimeSeconds = parseInt(hrMatch[1]) * 3600 + parseInt(hrMatch[2]) * 60;
		}

		// --- Memory ---
		// Actual API shape from /diagnostics/system/system_resources:
		// {
		//   memory: { total: "2133 MB", used: "921 MB", ... }
		// }
		// Values are human-readable strings like "2133 MB" or "921 MB".
		// We parse them into bytes.
		const memData = memResult.status === 'fulfilled' ? memResult.value : {};
		const memStats = memData?.memory ?? memData ?? {};

		function parseMemStr(val: any): number {
			if (typeof val === 'number') return val;
			if (typeof val === 'string') {
				const m = val.match(/([\d.]+)\s*(MB|GB|KB|B)?/i);
				if (!m) return 0;
				const n = parseFloat(m[1]);
				const unit = (m[2] ?? 'B').toUpperCase();
				if (unit === 'GB') return Math.round(n * 1073741824);
				if (unit === 'MB') return Math.round(n * 1048576);
				if (unit === 'KB') return Math.round(n * 1024);
				return Math.round(n);
			}
			return 0;
		}

		// Field names may be 'total'/'used' or 'total_real'/'used_real' depending on version
		const memTotal: number = parseMemStr(memStats.total ?? memStats.total_real ?? 0);
		const memUsed: number  = parseMemStr(memStats.used  ?? memStats.used_real  ?? 0);

		// --- Interfaces / Traffic ---
		// Shape: { interfaces: { [key]: { name, "bytes received": string, "bytes transmitted": string } }, time: number }
		const ifaceData = ifaceResult.status === 'fulfilled' ? ifaceResult.value : {};
		const ifObj: Record<string, any> = ifaceData?.interfaces ?? {};
		const interfaceList: { name: string; device: string; rxBytes: number; txBytes: number }[] = [];
		for (const [dev, info] of Object.entries(ifObj)) {
			if (typeof info !== 'object' || !info) continue;
			interfaceList.push({
				name: (info as any).name ?? dev,
				device: dev,
				rxBytes: parseInt((info as any)['bytes received'] ?? '0', 10),
				txBytes: parseInt((info as any)['bytes transmitted'] ?? '0', 10)
			});
		}

		// --- Services ---
		let serviceList: { name: string; description: string; running: boolean }[] = [];
		if (servicesResult.status === 'fulfilled' && Array.isArray(servicesResult.value)) {
			serviceList = servicesResult.value.map((s: any) => ({
				name: s.name ?? s.id ?? 'unknown',
				description: s.description ?? '',
				running: s.running === true || s.running === 1 || s.running === '1'
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
			// Disk not available via these endpoints
			diskUsed: 0,
			diskTotal: 0,
			interfaces: interfaceList,
			services: serviceList
		});
	} catch (err: any) {
		console.error('OPNsense API error:', err);
		return json({ error: err.message ?? 'Failed to connect to OPNsense' }, { status: 500 });
	}
};
