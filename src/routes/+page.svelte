<svelte:head>
	<title>SageDockHand</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { RefreshCw, Server, Box, ShieldCheck, CheckCircle2, XCircle, AlertCircle } from 'lucide-svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	interface StatRow {
		label: string;
		value: string | number;
		sub: string;
		ok: boolean | null;
	}

	interface Card {
		title: string;
		href: string;
		Icon: any;
		rows: StatRow[];
		loading: boolean;
		error: string | null;
	}

	let cards = $state<Card[]>([
		{ title: 'Proxmox',    href: '/proxmox',    Icon: Server,      rows: [], loading: true, error: null },
		{ title: 'OPNsense',   href: '/opnsense',   Icon: ShieldCheck, rows: [], loading: true, error: null },
		{ title: 'Containers', href: '/containers', Icon: Box,         rows: [], loading: true, error: null }
	]);

	let refreshCountdown = $state(30);
	let countdownInterval: ReturnType<typeof setInterval> | undefined;

	// ── Proxmox ──────────────────────────────────────────────────────────────
	async function loadProxmox() {
		const i = 0;
		try {
			const res = await fetch('/api/proxmox');
			const d = await res.json();
			if (d.error) { cards[i].error = d.error; cards[i].rows = []; return; }
			cards[i].error = null;
			cards[i].rows = [
				{
					label: 'VMs / LXCs',
					value: `${d.vmsRunning ?? 0} running`,
					sub: `${d.vmsStopped ?? 0} stopped · ${d.vmsTotal ?? 0} total`,
					ok: (d.vmsRunning ?? 0) > 0
				},
				{
					label: 'Node',
					value: d.node ?? 'pve',
					sub: `CPU ${((d.cpu ?? 0) * 100).toFixed(1)}% · up ${d.uptime ? uptimeStr(d.uptime) : '—'}`,
					ok: true
				}
			];
		} catch (e: any) {
			cards[i].error = e.message ?? 'Failed to reach Proxmox';
			cards[i].rows = [];
		} finally {
			cards[i].loading = false;
		}
	}

	// ── OPNsense ─────────────────────────────────────────────────────────────
	async function loadOpnsense() {
		const i = 1;
		try {
			const res = await fetch('/api/opnsense');
			const d = await res.json();
			if (d.error) { cards[i].error = d.error; cards[i].rows = []; return; }
			cards[i].error = null;
			const svcTotal   = d.services?.length ?? 0;
			const svcRunning = d.services?.filter((s: any) => s.running).length ?? 0;
			const svcStopped = svcTotal - svcRunning;
			cards[i].rows = [
				{
					label: 'Firewall',
					value: 'Online',
					sub: `Uptime ${d.uptime ?? '—'}`,
					ok: true
				},
				{
					label: 'Services',
					value: `${svcRunning} / ${svcTotal} running`,
					sub: svcStopped > 0 ? `${svcStopped} stopped` : svcTotal === 0 ? 'No services returned' : 'All running',
					ok: svcStopped === 0 && svcTotal > 0
				}
			];
		} catch (e: any) {
			cards[i].error = e.message ?? 'Failed to reach OPNsense';
			cards[i].rows = [];
		} finally {
			cards[i].loading = false;
		}
	}

	// ── Containers (via dashboard/stats) ─────────────────────────────────────
	async function loadContainers() {
		const i = 2;
		try {
			const res = await fetch('/api/dashboard/stats');
			const d = await res.json();
			const envs: any[] = Array.isArray(d) ? d : [];
			const running   = envs.reduce((s: number, e: any) => s + (e.containers?.running  ?? 0), 0);
			const stopped   = envs.reduce((s: number, e: any) => s + (e.containers?.stopped  ?? 0), 0);
			const total     = envs.reduce((s: number, e: any) => s + (e.containers?.total    ?? 0), 0);
			const unhealthy = envs.reduce((s: number, e: any) => s + (e.containers?.unhealthy ?? 0), 0);
			// Memory: sum across all envs that have metrics
			const memUsed  = envs.reduce((s: number, e: any) => s + (e.metrics?.memoryUsed  ?? 0), 0);
			const memTotal = envs.reduce((s: number, e: any) => s + (e.metrics?.memoryTotal ?? 0), 0);
			cards[i].error = null;
			cards[i].rows = [
				{
					label: 'Containers',
					value: `${running} running`,
					sub: `${stopped} stopped · ${total} total`,
					ok: running > 0 && unhealthy === 0
				},
				...(memTotal > 0 ? [{
					label: 'Memory',
					value: fmtBytes(memUsed),
					sub: `of ${fmtBytes(memTotal)} · ${Math.round((memUsed / memTotal) * 100)}% used`,
					ok: (memUsed / memTotal) < 0.9
				}] : []),
				...(unhealthy > 0 ? [{
					label: 'Unhealthy',
					value: `${unhealthy} container${unhealthy !== 1 ? 's' : ''}`,
					sub: 'Needs attention',
					ok: false
				}] : [])
			];
		} catch (e: any) {
			cards[i].error = e.message ?? 'Failed to load container stats';
			cards[i].rows = [];
		} finally {
			cards[i].loading = false;
		}
	}

	function fmtBytes(b: number): string {
		if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
		if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
		if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
		return b + ' B';
	}

	function uptimeStr(seconds: number): string {
		const d = Math.floor(seconds / 86400);
		const h = Math.floor((seconds % 86400) / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}

	async function fetchAll() {
		// Reset loading states
		cards = cards.map(c => ({ ...c, loading: true }));
		await Promise.allSettled([loadProxmox(), loadOpnsense(), loadContainers()]);
	}

	function startCycle() {
		refreshCountdown = 30;
		clearInterval(countdownInterval);
		countdownInterval = setInterval(() => {
			refreshCountdown--;
			if (refreshCountdown <= 0) {
				fetchAll();
				refreshCountdown = 30;
			}
		}, 1000);
	}

	onMount(() => { fetchAll(); startCycle(); });
	onDestroy(() => { clearInterval(countdownInterval); });
</script>

<div class="flex-1 flex flex-col gap-4 min-h-0">

	<!-- Header row -->
	<div class="shrink-0 flex items-center justify-between gap-3">
		<PageHeader icon={RefreshCw} title="Dashboard" showConnection={false} />
		<span class="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
			<RefreshCw class="w-3 h-3 opacity-40" />
			{refreshCountdown}s
		</span>
	</div>

	<!-- Service cards -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
		{#each cards as card}
			<a
				href={card.href}
				class="group rounded-xl border bg-card hover:bg-muted/30 transition-colors p-5 flex flex-col gap-4 shadow-sm no-underline"
			>
				<!-- Card title + status icon -->
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 text-sm font-semibold">
						<card.Icon class="w-4 h-4 text-muted-foreground" aria-hidden="true" />
						{card.title}
					</div>
					{#if card.loading}
						<RefreshCw class="w-3.5 h-3.5 text-muted-foreground animate-spin" />
					{:else if card.error}
						<XCircle class="w-4 h-4 text-destructive/70" />
					{:else}
						<CheckCircle2 class="w-4 h-4 text-emerald-500" />
					{/if}
				</div>

				<!-- Stat rows -->
				{#if card.loading}
					<div class="flex flex-col gap-2.5">
						<div class="h-3.5 w-2/3 rounded bg-muted animate-pulse"></div>
						<div class="h-3 w-1/2 rounded bg-muted animate-pulse"></div>
					</div>
				{:else if card.error}
					<div class="flex items-start gap-1.5 text-xs text-destructive/80">
						<AlertCircle class="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
						<span class="leading-snug">{card.error}</span>
					</div>
				{:else if card.rows.length === 0}
					<p class="text-xs text-muted-foreground italic">No data</p>
				{:else}
					<div class="flex flex-col gap-3.5">
						{#each card.rows as row}
							<div class="flex items-start justify-between gap-3">
								<div class="flex flex-col gap-0.5 min-w-0">
									<span class="text-xs text-muted-foreground">{row.label}</span>
									<span class="text-sm font-semibold tabular-nums truncate">{row.value}</span>
									{#if row.sub}
										<span class="text-xs text-muted-foreground">{row.sub}</span>
									{/if}
								</div>
								{#if row.ok === true}
									<CheckCircle2 class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
								{:else if row.ok === false}
									<XCircle class="w-4 h-4 text-destructive/70 shrink-0 mt-0.5" aria-hidden="true" />
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</a>
		{/each}
	</div>
</div>
