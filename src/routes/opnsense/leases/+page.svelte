<svelte:head>
	<title>DHCP Leases - OPNsense - Dockhand</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Network, RefreshCw, Search, ChevronLeft, WifiOff, ArrowUpDown } from 'lucide-svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	interface Lease {
		ip: string;
		mac: string;
		hostname: string;
		description: string;
		start: string;
		end: string;
		state: string;
		interface: string;
	}

	let leases = $state<Lease[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let refreshing = $state(false);
	let refreshCountdown = $state(30);
	let search = $state('');
	let sortKey = $state<keyof Lease>('ip');
	let sortAsc = $state(true);

	let countdownInterval: ReturnType<typeof setInterval>;

	let filtered = $derived.by(() => {
		const q = search.toLowerCase();
		let list = q
			? leases.filter(l =>
					l.ip.includes(q) ||
					l.mac.toLowerCase().includes(q) ||
					l.hostname.toLowerCase().includes(q) ||
					l.description.toLowerCase().includes(q)
				)
			: [...leases];
		list.sort((a, b) => {
			const av = a[sortKey] ?? '';
			const bv = b[sortKey] ?? '';
			const cmp = sortKey === 'ip'
				? ipCompare(String(av), String(bv))
				: String(av).localeCompare(String(bv));
			return sortAsc ? cmp : -cmp;
		});
		return list;
	});

	function ipCompare(a: string, b: string): number {
		const ap = a.split('.').map(Number);
		const bp = b.split('.').map(Number);
		for (let i = 0; i < 4; i++) {
			if ((ap[i] ?? 0) !== (bp[i] ?? 0)) return (ap[i] ?? 0) - (bp[i] ?? 0);
		}
		return 0;
	}

	function setSort(key: keyof Lease) {
		if (sortKey === key) sortAsc = !sortAsc;
		else { sortKey = key; sortAsc = true; }
	}

	async function fetchLeases() {
		try {
			const res = await fetch('/api/opnsense/leases');
			const json = await res.json();
			if (json.error) { error = json.error; leases = []; }
			else { error = null; leases = json.leases ?? []; }
		} catch (e: any) {
			error = e.message ?? 'Failed to load leases';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	function startCycle() {
		refreshCountdown = 30;
		clearInterval(countdownInterval);
		countdownInterval = setInterval(() => {
			refreshCountdown--;
			if (refreshCountdown <= 0) {
				refreshing = true;
				fetchLeases();
				refreshCountdown = 30;
			}
		}, 1000);
	}

	async function manualRefresh() {
		refreshing = true;
		await fetchLeases();
		startCycle();
	}

	onMount(() => { fetchLeases(); startCycle(); });
	onDestroy(() => { clearInterval(countdownInterval); });
</script>

<div class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
	<div class="shrink-0 flex flex-wrap justify-between items-center gap-3 min-h-8">
		<div class="flex items-center gap-2">
			<a href="/opnsense" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
				<ChevronLeft class="w-4 h-4" /> OPNsense
			</a>
			<span class="text-muted-foreground">/</span>
			<PageHeader icon={Network} title="DHCP Leases" showConnection={false} />
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

	<!-- Search -->
	{#if !loading && !error}
		<div class="shrink-0 relative">
			<Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
			<input
				bind:value={search}
				placeholder="Search by IP, MAC, hostname..."
				class="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
			/>
		</div>
	{/if}

	<div class="flex-1 min-h-0 overflow-auto">
		{#if loading}
			<div class="flex items-center justify-center h-40 text-muted-foreground">
				<RefreshCw class="w-5 h-5 animate-spin mr-2" /> Loading leases...
			</div>
		{:else if error}
			<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-6 flex flex-col items-center gap-3 text-center max-w-lg mx-auto mt-8">
				<WifiOff class="w-8 h-8 text-destructive/60" />
				<p class="text-sm font-medium text-destructive">{error}</p>
			</div>
		{:else if filtered.length === 0}
			<div class="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
				<Network class="w-8 h-8 opacity-30" />
				<p class="text-sm">{search ? 'No leases match your search.' : 'No DHCP leases found.'}</p>
			</div>
		{:else}
			<div class="rounded-lg border overflow-hidden">
				<table class="w-full text-sm">
					<thead class="bg-muted/50 border-b">
						<tr>
							{#each [['ip','IP Address'],['hostname','Hostname'],['mac','MAC Address'],['description','Description'],['interface','Interface'],['state','State'],['end','Expires']] as [key, label]}
								<th class="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
									<button onclick={() => setSort(key as keyof Lease)} class="flex items-center gap-1 hover:text-foreground transition-colors">
										{label}
										<ArrowUpDown class="w-3 h-3 opacity-50" />
									</button>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each filtered as lease, i}
							<tr class="border-b last:border-0 {i % 2 === 0 ? 'bg-background' : 'bg-muted/20'} hover:bg-muted/40 transition-colors">
								<td class="px-3 py-2 font-mono">{lease.ip}</td>
								<td class="px-3 py-2">{lease.hostname || <span class="text-muted-foreground italic">—</span>}</td>
								<td class="px-3 py-2 font-mono text-muted-foreground">{lease.mac}</td>
								<td class="px-3 py-2 text-muted-foreground">{lease.description || '—'}</td>
								<td class="px-3 py-2 font-mono text-muted-foreground">{lease.interface || '—'}</td>
								<td class="px-3 py-2">
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium
										{lease.state === 'active' || lease.state === 'bound' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}">
										{lease.state}
									</span>
								</td>
								<td class="px-3 py-2 text-muted-foreground text-xs">{lease.end || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="text-xs text-muted-foreground mt-2">{filtered.length} lease{filtered.length !== 1 ? 's' : ''}{search ? ` matching "${search}"` : ''}</p>
		{/if}
	</div>
</div>
