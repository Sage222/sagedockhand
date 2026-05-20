<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Server, Cpu, MemoryStick, HardDrive, Play, Square, RefreshCw, AlertCircle, Settings } from 'lucide-svelte';

	let { data } = $props();

	let refreshing = $state(false);

	type Guest = {
		vmid: number;
		name: string;
		status: string;
		type: string;
		cpu: number;
		mem: number;
		maxmem: number;
	};

	function fmt(bytes: number) {
		if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
		return (bytes / 1e6).toFixed(0) + ' MB';
	}

	function fmtUptime(s: number) {
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}

	function pct(used: number, total: number) {
		if (!total) return 0;
		return (used / total) * 100;
	}

	function pctColor(p: number) {
		if (p >= 90) return 'bg-destructive';
		if (p >= 70) return 'bg-yellow-500';
		return 'bg-primary';
	}

	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
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
				<Settings class="w-3.5 h-3.5" />
				<span>Settings</span>
			</a>
			<button
				onclick={refresh}
				class="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
				title="Refresh"
				aria-label="Refresh Proxmox data"
			>
				<RefreshCw class="w-4 h-4 {refreshing ? 'animate-spin' : ''}" />
			</button>
		</div>
	</div>

	<!-- Not configured -->
	{#if data.notConfigured}
		<div class="flex flex-col items-center justify-center gap-4 py-16 text-center">
			<AlertCircle class="w-10 h-10 text-muted-foreground" />
			<div>
				<p class="font-medium mb-1">Proxmox not configured</p>
				<p class="text-sm text-muted-foreground">Add your Proxmox host and API token to get started.</p>
			</div>
			<a href="/settings/proxmox" class="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md hover:opacity-90 transition-opacity">
				<Settings class="w-4 h-4" />
				Configure Proxmox
			</a>
		</div>

	<!-- Error -->
	{:else if data.error}
		<div class="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
			<AlertCircle class="w-4 h-4 text-destructive shrink-0 mt-0.5" />
			<div>
				<p class="text-sm font-medium text-destructive">Connection failed</p>
				<p class="text-xs text-muted-foreground mt-0.5">{data.error}</p>
			</div>
		</div>

	<!-- Data -->
	{:else if data.data}
		<!-- KPI cards -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<!-- CPU -->
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Cpu class="w-3.5 h-3.5" />
					<span>CPU</span>
				</div>
				<div class="text-2xl font-semibold tabular-nums">{(data.data.cpu * 100).toFixed(1)}<span class="text-base font-normal text-muted-foreground">%</span></div>
				<div class="w-full bg-muted rounded-full h-1.5 overflow-hidden">
					<div class="h-full rounded-full transition-all {pctColor(data.data.cpu * 100)}" style="width: {Math.min(data.data.cpu * 100, 100)}%"></div>
				</div>
				<div class="text-xs text-muted-foreground">{data.data.cpuCores} cores</div>
			</div>

			<!-- Memory -->
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<MemoryStick class="w-3.5 h-3.5" />
					<span>Memory</span>
				</div>
				<div class="text-2xl font-semibold tabular-nums">{pct(data.data.memUsed, data.data.memTotal).toFixed(1)}<span class="text-base font-normal text-muted-foreground">%</span></div>
				<div class="w-full bg-muted rounded-full h-1.5 overflow-hidden">
					<div class="h-full rounded-full transition-all {pctColor(pct(data.data.memUsed, data.data.memTotal))}" style="width: {Math.min(pct(data.data.memUsed, data.data.memTotal), 100)}%"></div>
				</div>
				<div class="text-xs text-muted-foreground">{fmt(data.data.memUsed)} / {fmt(data.data.memTotal)}</div>
			</div>

			<!-- Storage -->
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<HardDrive class="w-3.5 h-3.5" />
					<span>Storage</span>
				</div>
				<div class="text-2xl font-semibold tabular-nums">{pct(data.data.rootFsUsed, data.data.rootFsTotal).toFixed(1)}<span class="text-base font-normal text-muted-foreground">%</span></div>
				<div class="w-full bg-muted rounded-full h-1.5 overflow-hidden">
					<div class="h-full rounded-full transition-all {pctColor(pct(data.data.rootFsUsed, data.data.rootFsTotal))}" style="width: {Math.min(pct(data.data.rootFsUsed, data.data.rootFsTotal), 100)}%"></div>
				</div>
				<div class="text-xs text-muted-foreground">{fmt(data.data.rootFsUsed)} / {fmt(data.data.rootFsTotal)}</div>
			</div>

			<!-- Guests -->
			<div class="rounded-lg border bg-card p-3 space-y-1.5">
				<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Server class="w-3.5 h-3.5" />
					<span>Guests</span>
				</div>
				<div class="text-2xl font-semibold tabular-nums">
					{data.data.vmsRunning}<span class="text-base font-normal text-muted-foreground">/{data.data.vmsTotal}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
						<Play class="w-2.5 h-2.5 fill-current" />{data.data.vmsRunning} running
					</span>
				</div>
				<div class="text-xs text-muted-foreground">{data.data.vmsStopped} stopped</div>
			</div>
		</div>

		<!-- Uptime -->
		<div class="text-xs text-muted-foreground">Node uptime: {fmtUptime(data.data.uptime)}</div>

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
						</tr>
					</thead>
					<tbody>
						{#each data.data.guests.slice().sort((a: Guest, b: Guest) => (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1) || a.name.localeCompare(b.name)) as g (g.vmid)}
							<tr class="border-b last:border-0 hover:bg-muted/30 transition-colors">
								<td class="px-3 py-2">
									<span class="font-medium">{g.name}</span>
									<span class="text-xs text-muted-foreground ml-1.5">#{g.vmid}</span>
								</td>
								<td class="px-3 py-2">
									<span class="text-xs uppercase tracking-wide text-muted-foreground">{g.type}</span>
								</td>
								<td class="px-3 py-2">
									{#if g.status === 'running'}
										<span class="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
											<Play class="w-3 h-3 fill-current" />running
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
											<Square class="w-3 h-3" />{g.status}
										</span>
									{/if}
								</td>
								<td class="px-3 py-2 text-right tabular-nums text-xs">
									{g.status === 'running' ? (g.cpu * 100).toFixed(1) + '%' : '—'}
								</td>
								<td class="px-3 py-2 text-right tabular-nums text-xs">
									{g.status === 'running' && g.maxmem > 0 ? fmt(g.mem) + ' / ' + fmt(g.maxmem) : '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
				No VMs or containers found on this node.
			</div>
		{/if}
	{/if}
</div>
