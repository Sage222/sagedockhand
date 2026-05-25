<svelte:head>
	<title>OPNsense - Dockhand</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { ShieldCheck, RefreshCw, Cpu, MemoryStick, HardDrive, Clock, Network, Activity, CheckCircle2, XCircle, WifiOff, ChevronRight, ExternalLink } from 'lucide-svelte';

	interface OPNsenseData {
		hostname: string;
		version: string;
		uptime: string;
		cpuPct: number;
		memUsed: number;
		memTotal: number;
		diskUsed: number;
		diskTotal: number;
		interfaces: { name: string; device: string; ipv4: string; ipv6: string; status: string }[];
		services: { name: string; description: string; running: boolean }[];
		opnsenseHost: string;
	}

	interface TrafficData {
		interfaces: Record<string, { name: string; rxBytes: number; txBytes: number; rxRate: number; txRate: number }>;
		timestamp: number;
	}

	let data = $state<OPNsenseData | null>(null);
	let traffic = $state<TrafficData | null>(null);
	let prevTraffic = $state<TrafficData | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let refreshCountdown = $state(30);
	let refreshing = $state(false);

	let trafficHistory = $state<{ time: string; rx: number; tx: number }[]>([]);

	const GRAPH_POINTS = 30;
	let countdownInterval: ReturnType<typeof setInterval> | undefined;
	let trafficInterval: ReturnType<typeof setInterval> | undefined;

	function fmtBytes(bytes: number): string {
		if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
		if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
		if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
		return bytes + ' B';
	}

	function fmtRate(bitsPerSec: number): string {
		if (bitsPerSec >= 1e9) return (bitsPerSec / 1e9).toFixed(1) + ' Gbps';
		if (bitsPerSec >= 1e6) return (bitsPerSec / 1e6).toFixed(1) + ' Mbps';
		if (bitsPerSec >= 1e3) return (bitsPerSec / 1e3).toFixed(0) + ' Kbps';
		return bitsPerSec + ' bps';
	}

	function pct(used: number, total: number): number {
		if (!total) return 0;
		return Math.min(100, Math.round((used / total) * 100));
	}

	function barColor(p: number): string {
		if (p > 85) return 'bg-red-500';
		if (p > 65) return 'bg-amber-500';
		return 'bg-emerald-500';
	}

	async function fetchTraffic() {
		try {
			const trafficRes = await fetch('/api/opnsense/traffic');
			if (!trafficRes.ok) return;
			const tData: TrafficData = await trafficRes.json();
			if ((tData as any).error) return;
			prevTraffic = traffic;
			traffic = tData;
			let totalRx = 0, totalTx = 0;
			for (const iface of Object.values(tData.interfaces)) {
				totalRx += iface.rxRate;
				totalTx += iface.txRate;
			}
			const now = new Date();
			const label = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
			trafficHistory = [...trafficHistory.slice(-(GRAPH_POINTS - 1)), { time: label, rx: totalRx, tx: totalTx }];
		} catch { /* non-fatal */ }
	}

	async function fetchAll() {
		try {
			const statsRes = await fetch('/api/opnsense');

			const stats = await statsRes.json();
			if (stats.error) { error = stats.error; data = null; }
			else { error = null; data = stats; }

			await fetchTraffic();
		} catch (e: any) {
			error = e.message ?? 'Failed to load OPNsense data';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	// Single interval — ticks every second, fetches at 0.
	function startCycle() {
		clearInterval(countdownInterval);
		refreshCountdown = 30;
		countdownInterval = setInterval(async () => {
			refreshCountdown = Math.max(0, refreshCountdown - 1);
			if (refreshCountdown === 0) {
				refreshing = true;
				await fetchAll();
				refreshCountdown = 30;
			}
		}, 1000);
	}

	async function manualRefresh() {
		refreshing = true;
		await fetchAll();
		startCycle();
	}

	function svgTrafficPath(series: number[], width: number, height: number, pad = 4): string {
		if (series.length < 2) return '';
		const max = Math.max(...series, 1);
		const points = series.map((v, i) => {
			const x = pad + (i / (series.length - 1)) * (width - pad * 2);
			const y = height - pad - ((v / max) * (height - pad * 2));
			return `${x},${y}`;
		});
		return `M ${points.join(' L ')}`;
	}

	onMount(() => {
		fetchAll();
		startCycle();
		trafficInterval = setInterval(fetchTraffic, 5000);
	});

	onDestroy(() => {
		clearInterval(countdownInterval);
		clearInterval(trafficInterval);
	});
</script>

<div class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
	<!-- Header -->
	<div class="shrink-0 flex flex-wrap justify-between items-center gap-3 min-h-8">
		<div class="flex items-center gap-2">
			<ShieldCheck class="w-5 h-5 text-muted-foreground" />
			{#if data?.opnsenseHost}
				<a
					href={data.opnsenseHost}
					target="_blank"
					rel="noopener noreferrer"
					class="text-xl font-semibold hover:text-primary transition-colors inline-flex items-center gap-1.5"
					title="Open OPNsense UI"
				>
					OPNsense
					<ExternalLink class="w-3.5 h-3.5 text-muted-foreground" />
				</a>
			{:else}
				<span class="text-xl font-semibold">OPNsense</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<span class="text-xs text-muted-foreground tabular-nums">{refreshCountdown}s</span>
			<button
				onclick={manualRefresh}
				disabled={refreshing}
				class="inline-flex items-center gap-1.5 border text-sm px-3 py-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
			>
				<RefreshCw class="w-3.5 h-3.5 {refreshing ? 'animate-spin' : ''}" />
				Refresh
			</button>
		</div>
	</div>

	<div class="flex-1 min-h-0 overflow-y-auto">
		{#if loading}
			<div class="flex items-center justify-center h-40 text-muted-foreground">
				<RefreshCw class="w-5 h-5 animate-spin mr-2" /> Loading OPNsense data...
			</div>
		{:else if error}
			<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-6 flex flex-col items-center gap-3 text-center max-w-lg mx-auto mt-8">
				<WifiOff class="w-8 h-8 text-destructive/60" />
				<p class="text-sm font-medium text-destructive">{error}</p>
				<a href="/settings?tab=opnsense" class="text-xs text-primary hover:underline">Go to Settings → OPNsense</a>
			</div>
		{:else if data}
			<div class="space-y-4 pb-4">

				<!-- Hostname / version banner -->
				<div class="rounded-lg border bg-card px-4 py-3 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<ShieldCheck class="w-5 h-5 text-primary" />
						<span class="font-semibold">{data.hostname}</span>
						{#if data.version}
							<span class="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{data.version}</span>
						{/if}
					</div>
					<div class="flex items-center gap-1.5 text-sm text-muted-foreground">
						<Clock class="w-4 h-4" />
						<span>Up {data.uptime}</span>
					</div>
				</div>

				<!-- Resource gauges -->
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
					<!-- CPU -->
					<div class="rounded-lg border bg-card p-4 space-y-2">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm font-medium">
								<Cpu class="w-4 h-4 text-muted-foreground" />CPU
							</div>
							<span class="text-xl font-bold tabular-nums">{data.cpuPct.toFixed(1)}<span class="text-sm font-normal text-muted-foreground">%</span></span>
						</div>
						<div class="w-full h-2 rounded-full bg-muted overflow-hidden">
							<div class="h-full rounded-full transition-all {barColor(data.cpuPct)}" style="width:{data.cpuPct}%"></div>
						</div>
					</div>
					<!-- Memory -->
					<div class="rounded-lg border bg-card p-4 space-y-2">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm font-medium">
								<MemoryStick class="w-4 h-4 text-muted-foreground" />Memory
							</div>
							<span class="text-xl font-bold tabular-nums">{pct(data.memUsed, data.memTotal)}<span class="text-sm font-normal text-muted-foreground">%</span></span>
						</div>
						<div class="w-full h-2 rounded-full bg-muted overflow-hidden">
							<div class="h-full rounded-full transition-all {barColor(pct(data.memUsed, data.memTotal))}" style="width:{pct(data.memUsed, data.memTotal)}%"></div>
						</div>
						<p class="text-xs text-muted-foreground">{fmtBytes(data.memUsed)} / {fmtBytes(data.memTotal)}</p>
					</div>
					<!-- Disk -->
					<div class="rounded-lg border bg-card p-4 space-y-2">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm font-medium">
								<HardDrive class="w-4 h-4 text-muted-foreground" />Storage
							</div>
							<span class="text-xl font-bold tabular-nums">{pct(data.diskUsed, data.diskTotal)}<span class="text-sm font-normal text-muted-foreground">%</span></span>
						</div>
						<div class="w-full h-2 rounded-full bg-muted overflow-hidden">
							<div class="h-full rounded-full transition-all {barColor(pct(data.diskUsed, data.diskTotal))}" style="width:{pct(data.diskUsed, data.diskTotal)}%"></div>
						</div>
						<p class="text-xs text-muted-foreground">{fmtBytes(data.diskUsed)} / {fmtBytes(data.diskTotal)}</p>
					</div>
				</div>

				<!-- Traffic graph -->
				<div class="rounded-lg border bg-card p-4 space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm font-medium">
							<Activity class="w-4 h-4 text-muted-foreground" />Network Traffic
						</div>
						<div class="flex items-center gap-4 text-xs text-muted-foreground">
							<span class="flex items-center gap-1"><span class="inline-block w-3 h-0.5 bg-emerald-500 rounded"></span>RX</span>
							<span class="flex items-center gap-1"><span class="inline-block w-3 h-0.5 bg-blue-500 rounded"></span>TX</span>
						</div>
					</div>
					{#if trafficHistory.length >= 2}
						{@const rxSeries = trafficHistory.map(p => p.rx)}
						{@const txSeries = trafficHistory.map(p => p.tx)}
						{@const rxPath = svgTrafficPath(rxSeries, 500, 80)}
						{@const txPath = svgTrafficPath(txSeries, 500, 80)}
						<svg class="w-full" viewBox="0 0 500 80" preserveAspectRatio="none">
							{#if rxPath}
								<path d="{rxPath} L 496,76 L 4,76 Z" fill="rgb(16 185 129 / 0.15)" />
								<path d="{rxPath}" fill="none" stroke="rgb(16 185 129)" stroke-width="1.5" />
							{/if}
							{#if txPath}
								<path d="{txPath} L 496,76 L 4,76 Z" fill="rgb(59 130 246 / 0.15)" />
								<path d="{txPath}" fill="none" stroke="rgb(59 130 246)" stroke-width="1.5" />
							{/if}
						</svg>
						<div class="grid grid-cols-2 gap-4 pt-1">
							<div class="text-center">
								<p class="text-xs text-muted-foreground">↓ Download</p>
								<p class="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
									{fmtRate(trafficHistory[trafficHistory.length - 1]?.rx ?? 0)}
								</p>
							</div>
							<div class="text-center">
								<p class="text-xs text-muted-foreground">↑ Upload</p>
								<p class="text-sm font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
									{fmtRate(trafficHistory[trafficHistory.length - 1]?.tx ?? 0)}
								</p>
							</div>
						</div>
					{:else}
						<div class="h-20 flex items-center justify-center text-sm text-muted-foreground">Collecting traffic data...</div>
					{/if}
				</div>

				<!-- Interfaces + Services side by side -->
				<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
					<!-- Interfaces -->
					<div class="rounded-lg border bg-card p-4 space-y-3">
						<div class="flex items-center gap-2 text-sm font-medium">
							<Network class="w-4 h-4 text-muted-foreground" />Interfaces
						</div>
						{#if data.interfaces.length === 0}
							<p class="text-xs text-muted-foreground">No interface data available.</p>
						{:else}
							<div class="space-y-2">
								{#each data.interfaces as iface}
									<div class="flex items-start justify-between gap-2 py-1.5 border-b last:border-0">
										<div class="flex items-center gap-2 min-w-0">
											<span class="w-2 h-2 rounded-full shrink-0 mt-1 {iface.status === 'up' ? 'bg-emerald-500' : 'bg-red-400'}"></span>
											<div class="min-w-0">
												<p class="text-sm font-medium truncate">{iface.name}</p>
												<p class="text-xs text-muted-foreground font-mono">{iface.device}</p>
											</div>
										</div>
										<div class="text-right shrink-0">
											{#if iface.ipv4}
												<p class="text-xs font-mono">{iface.ipv4}</p>
											{/if}
											{#if iface.ipv6}
												<p class="text-xs font-mono text-muted-foreground">{iface.ipv6}</p>
											{/if}
											{#if !iface.ipv4 && !iface.ipv6}
												<p class="text-xs text-muted-foreground">No IP</p>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Services -->
					<div class="rounded-lg border bg-card p-4 space-y-3">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm font-medium">
								<Activity class="w-4 h-4 text-muted-foreground" />Services
							</div>
							{#if data.services.length > 0}
								<span class="text-xs text-muted-foreground">
									{data.services.filter(s => s.running).length}/{data.services.length} running
								</span>
							{/if}
						</div>
						{#if data.services.length === 0}
							<p class="text-xs text-muted-foreground">No service data available.</p>
						{:else}
							<div class="space-y-1.5">
								{#each data.services as svc}
									<div class="flex items-center justify-between gap-2 py-1 border-b last:border-0">
										<div class="flex items-center gap-2 min-w-0">
											{#if svc.running}
												<CheckCircle2 class="w-3.5 h-3.5 text-emerald-500 shrink-0" />
											{:else}
												<XCircle class="w-3.5 h-3.5 text-red-400 shrink-0" />
											{/if}
											<span class="text-sm truncate">{svc.name}</span>
										</div>
										{#if svc.description}
											<span class="text-xs text-muted-foreground truncate max-w-32">{svc.description}</span>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- DHCP Leases link -->
				<a href="/opnsense/leases"
					class="rounded-lg border bg-card px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors group">
					<div class="flex items-center gap-2">
						<Network class="w-4 h-4 text-muted-foreground" />
						<span class="text-sm font-medium">DHCP Leases</span>
						<span class="text-xs text-muted-foreground">View all IP assignments from dnsmasq</span>
					</div>
					<ChevronRight class="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
				</a>

			</div>
		{/if}
	</div>
</div>
