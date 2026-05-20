<svelte:head>
	<title>Proxmox — Dockhand</title>
</svelte:head>

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		Server, Cpu, MemoryStick, HardDrive, Play, Square, RefreshCw,
		AlertCircle, Settings, Power, RotateCcw, StopCircle, Zap
	} from 'lucide-svelte';

	let { data } = $props();

	let refreshing = $state(false);
	let actionStatus = $state<Record<number, string>>({});
	let actionError = $state<Record<number, string>>({});
	let interval: ReturnType<typeof setInterval>;

	type Guest = { vmid: number; name: string; status: string; type: string; cpu: number; mem: number; maxmem: number; };
	type RrdPoint = { t: number; cpu: number | null; netin: number | null; netout: number | null; mem: number | null; };

	// Derive rrd reactively so Svelte re-renders sparklines after invalidateAll()
	let rrd = $derived((data.rrd ?? []) as RrdPoint[]);

	function fmt(bytes: number) {
		if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
		if (bytes > 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
		return (bytes / 1e3).toFixed(0) + ' KB';
	}

	function fmtBps(bps: number) {
		if (bps > 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
		if (bps > 1e3) return (bps / 1e3).toFixed(0) + ' KB/s';
		return bps.toFixed(0) + ' B/s';
	}

	function fmtUptime(s: number) {
		const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}

	function pct(used: number, total: number) { return total ? (used / total) * 100 : 0; }

	function pctColor(p: number) {
		if (p >= 90) return 'bg-destructive';
		if (p >= 70) return 'bg-yellow-500';
		return 'bg-primary';
	}

	function sparkline(points: (number | null)[], w = 200, h = 40): string {
		const valid = points.filter((v): v is number => v !== null && isFinite(v));
		if (valid.length < 2) return '';
		const max = Math.max(...valid) || 1;
		const step = w / (points.length - 1);
		return points
			.map((v, i) => {
				if (v === null || !isFinite(v)) return null;
				return `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`;
			})
			.filter(Boolean)
			.join(' ');
	}

	function lastVal(points: (number | null)[]): number | null {
		for (let i = points.length - 1; i >= 0; i--) {
			if (points[i] !== null && isFinite(points[i] as number)) return points[i];
		}
		return null;
	}

	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}

	async function doAction(vmid: number, type: string, action: string) {
		actionStatus = { ...actionStatus, [vmid]: 'loading' };
		actionError = { ...actionError, [vmid]: '' };
		try {
			const res = await fetch('/api/proxmox/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ vmid, type, action })
			});
			const json = await res.json();
			if (json.error) { actionStatus = { ...actionStatus, [vmid]: 'error' }; actionError = { ...actionError, [vmid]: json.error }; }
			else { actionStatus = { ...actionStatus, [vmid]: 'ok' }; setTimeout(() => { actionStatus = { ...actionStatus, [vmid]: '' }; refresh(); }, 1500); }
		} catch (e: any) {
			actionStatus = { ...actionStatus, [vmid]: 'error' };
			actionError = { ...actionError, [vmid]: e.message };
		}
	}

	onMount(() => { interval = setInterval(refresh, 15000); });
	onDestroy(() => clearInterval(interval));
</script>

<div class="flex flex-col gap-4 p-4 max-w-5xl">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Server class="w-5 h-5 text-muted-foreground" />
			<h1 class="text-xl font-semibold">Proxmox</h1>
			{#if data.data}
				<span class="text-sm text-muted-foreground font-normal">— {data.data.node}</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<a href="/settings/proxmox" class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted">
				<Settings class="w-3.5 h-3.5" /><span>Settings</span>
			</a>
			<button onclick={refresh} class="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Refresh" aria-label="Refresh">
				<RefreshCw class="w-4 h-4 {refreshing ? 'animate-spin' : ''}" />
			</button>
		</div>
	</div>

	{#if data.notConfigured}
		<div class="flex flex-col items-center justify-center gap-4 py-16 text-center">
			<AlertCircle class="w-10 h-10 text-muted-foreground" />
			<div><p class="font-medium mb-1">Proxmox not configured</p><p class="text-sm text-muted-foreground">Add your Proxmox host and API token to get started.</p></div>
			<a href="/settings/proxmox" class="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md hover:opacity-90">
				<Settings class="w-4 h-4" />Configure Proxmox
			</a>
		</div>

	{:else if data.error}
		<div class="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
			<AlertCircle class="w-4 h-4 text-destructive shrink-0 mt-0.5" />
			<div><p class="text-sm font-medium text-destructive">Connection failed</p><p class="text-xs text-muted-foreground mt-0.5">{data.error}</p></div>
		</div>

	{:else if data.data}
		<!-- KPI cards -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground"><Cpu class="w-3.5 h-3.5" /><span>CPU</span></div>
				<div class="text-2xl font-semibold tabular-nums">{(data.data.cpu * 100).toFixed(1)}<span class="text-base font-normal text-muted-foreground">%</span></div>
				<div class="w-full bg-muted rounded-full h-1.5 overflow-hidden"><div class="h-full rounded-full transition-all {pctColor(data.data.cpu * 100)}" style="width:{Math.min(data.data.cpu*100,100)}%"></div></div>
				<div class="text-xs text-muted-foreground">{data.data.cpuCores} cores</div>
			</div>
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground"><MemoryStick class="w-3.5 h-3.5" /><span>Memory</span></div>
				<div class="text-2xl font-semibold tabular-nums">{pct(data.data.memUsed,data.data.memTotal).toFixed(1)}<span class="text-base font-normal text-muted-foreground">%</span></div>
				<div class="w-full bg-muted rounded-full h-1.5 overflow-hidden"><div class="h-full rounded-full transition-all {pctColor(pct(data.data.memUsed,data.data.memTotal))}" style="width:{Math.min(pct(data.data.memUsed,data.data.memTotal),100)}%"></div></div>
				<div class="text-xs text-muted-foreground">{fmt(data.data.memUsed)} / {fmt(data.data.memTotal)}</div>
			</div>
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground"><HardDrive class="w-3.5 h-3.5" /><span>Storage</span></div>
				<div class="text-2xl font-semibold tabular-nums">{pct(data.data.rootFsUsed,data.data.rootFsTotal).toFixed(1)}<span class="text-base font-normal text-muted-foreground">%</span></div>
				<div class="w-full bg-muted rounded-full h-1.5 overflow-hidden"><div class="h-full rounded-full transition-all {pctColor(pct(data.data.rootFsUsed,data.data.rootFsTotal))}" style="width:{Math.min(pct(data.data.rootFsUsed,data.data.rootFsTotal),100)}%"></div></div>
				<div class="text-xs text-muted-foreground">{fmt(data.data.rootFsUsed)} / {fmt(data.data.rootFsTotal)}</div>
			</div>
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground"><Server class="w-3.5 h-3.5" /><span>Guests</span></div>
				<div class="text-2xl font-semibold tabular-nums">{data.data.vmsRunning}<span class="text-base font-normal text-muted-foreground">/{data.data.vmsTotal}</span></div>
				<div class="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium"><Play class="w-2.5 h-2.5 fill-current" />{data.data.vmsRunning} running</div>
				<div class="text-xs text-muted-foreground">{data.data.vmsStopped} stopped</div>
			</div>
		</div>

		<!-- Graphs row — all driven by reactive $derived rrd -->
		{#if rrd.length > 2}
			{@const netinSeries = rrd.map(p => p.netin)}
			{@const netoutSeries = rrd.map(p => p.netout)}
			{@const cpuSeries = rrd.map(p => p.cpu)}
			{@const memSeries = rrd.map(p => p.mem)}
			{@const netinLast = lastVal(netinSeries)}
			{@const netoutLast = lastVal(netoutSeries)}
			{@const cpuLast = lastVal(cpuSeries)}
			{@const memLast = lastVal(memSeries)}

			<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
				<!-- Network graph -->
				<div class="rounded-lg border bg-card p-3 space-y-1">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-muted-foreground">Network I/O (1h)</span>
						<div class="flex gap-3 text-xs">
							{#if netinLast !== null}<span class="text-blue-500">↑ {fmtBps(netinLast)}</span>{/if}
							{#if netoutLast !== null}<span class="text-orange-400">↓ {fmtBps(netoutLast)}</span>{/if}
						</div>
					</div>
					<svg viewBox="0 0 200 40" class="w-full" preserveAspectRatio="none" style="height:48px">
						{#if sparkline(netinSeries)}
							<polyline points={sparkline(netinSeries)} fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />
						{/if}
						{#if sparkline(netoutSeries)}
							<polyline points={sparkline(netoutSeries)} fill="none" stroke="#fb923c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />
						{/if}
					</svg>
				</div>

				<!-- CPU over time -->
				<div class="rounded-lg border bg-card p-3 space-y-1">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-muted-foreground">CPU Usage (1h)</span>
						{#if cpuLast !== null}
							<span class="text-xs tabular-nums {cpuLast > 0.9 ? 'text-destructive' : cpuLast > 0.7 ? 'text-yellow-500' : 'text-muted-foreground'}">{(cpuLast * 100).toFixed(1)}%</span>
						{/if}
					</div>
					<svg viewBox="0 0 200 40" class="w-full" preserveAspectRatio="none" style="height:48px">
						{#if sparkline(cpuSeries)}
							<polyline points={sparkline(cpuSeries)} fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
						{/if}
					</svg>
				</div>

				<!-- Memory over time -->
				<div class="rounded-lg border bg-card p-3 space-y-1">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-muted-foreground">Memory Usage (1h)</span>
						{#if memLast !== null}
							<span class="text-xs tabular-nums {memLast > 0.9 ? 'text-destructive' : memLast > 0.7 ? 'text-yellow-500' : 'text-muted-foreground'}">{(memLast * 100).toFixed(1)}%</span>
						{/if}
					</div>
					<svg viewBox="0 0 200 40" class="w-full" preserveAspectRatio="none" style="height:48px">
						{#if sparkline(memSeries)}
							<polyline points={sparkline(memSeries)} fill="none" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
						{/if}
					</svg>
				</div>
			</div>
		{/if}

		<!-- Uptime -->
		<div class="text-xs text-muted-foreground">Node uptime: {fmtUptime(data.data.uptime)} · auto-refreshes every 15s</div>

		<!-- Guest table -->
		{#if data.data.guests.length > 0}
			<div class="rounded-lg border overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b bg-muted/40">
							<th class="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Name</th>
							<th class="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
							<th class="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
							<th class="text-right px-3 py-2 text-xs font-medium text-muted-foreground">CPU</th>
							<th class="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Memory</th>
							{#if data.hasManageToken}<th class="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Actions</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each data.data.guests.slice().sort((a: Guest, b: Guest) => (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1) || a.name.localeCompare(b.name)) as g (g.vmid)}
							<tr class="border-b last:border-0 hover:bg-muted/30 transition-colors">
								<td class="px-3 py-2">
									<span class="font-medium">{g.name}</span>
									<span class="text-xs text-muted-foreground ml-1.5">#{g.vmid}</span>
								</td>
								<td class="px-3 py-2"><span class="text-xs uppercase tracking-wide text-muted-foreground">{g.type}</span></td>
								<td class="px-3 py-2">
									{#if actionStatus[g.vmid] === 'loading'}
										<span class="text-xs text-muted-foreground animate-pulse">Working…</span>
									{:else if actionStatus[g.vmid] === 'ok'}
										<span class="text-xs text-green-600 dark:text-green-400">Done ✓</span>
									{:else if actionStatus[g.vmid] === 'error'}
										<span class="text-xs text-destructive" title={actionError[g.vmid]}>Error</span>
									{:else if g.status === 'running'}
										<span class="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400"><Play class="w-3 h-3 fill-current" />running</span>
									{:else}
										<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><Square class="w-3 h-3" />{g.status}</span>
									{/if}
								</td>
								<td class="px-3 py-2 text-right tabular-nums text-xs">{g.status === 'running' ? (g.cpu * 100).toFixed(1) + '%' : '—'}</td>
								<td class="px-3 py-2 text-right tabular-nums text-xs">{g.status === 'running' && g.maxmem > 0 ? fmt(g.mem) + ' / ' + fmt(g.maxmem) : '—'}</td>
								{#if data.hasManageToken}
									<td class="px-3 py-2">
										<div class="flex items-center justify-end gap-1">
											{#if g.status === 'running'}
												<button
													onclick={() => doAction(g.vmid, g.type, 'shutdown')}
													disabled={actionStatus[g.vmid] === 'loading'}
													title="Shutdown (graceful)"
													class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
												><StopCircle class="w-3.5 h-3.5" /></button>
												<button
													onclick={() => doAction(g.vmid, g.type, 'stop')}
													disabled={actionStatus[g.vmid] === 'loading'}
													title="Stop (force off)"
													class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive disabled:opacity-40"
												><Power class="w-3.5 h-3.5" /></button>
												<button
													onclick={() => doAction(g.vmid, g.type, g.type === 'lxc' ? 'reboot' : 'reset')}
													disabled={actionStatus[g.vmid] === 'loading'}
													title="Restart"
													class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-yellow-500 disabled:opacity-40"
												><RotateCcw class="w-3.5 h-3.5" /></button>
											{:else if g.status === 'stopped'}
												<button
													onclick={() => doAction(g.vmid, g.type, 'start')}
													disabled={actionStatus[g.vmid] === 'loading'}
													title="Start"
													class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-green-500 disabled:opacity-40"
												><Zap class="w-3.5 h-3.5" /></button>
											{/if}
										</div>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">No VMs or containers found on this node.</div>
		{/if}
	{/if}
</div>
