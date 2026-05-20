<script lang="ts">
	import { onMount } from 'svelte';
	import { Save, TestTube2, CheckCircle2, XCircle, Loader2, ShieldCheck } from 'lucide-svelte';

	let host = $state('');
	let apiKey = $state('');
	let apiSecret = $state('');

	let saving = $state(false);
	let testing = $state(false);
	let saveStatus = $state<'idle' | 'saved' | 'error'>('idle');
	let testStatus = $state<'idle' | 'ok' | 'fail'>('idle');
	let testMessage = $state('');

	onMount(async () => {
		try {
			const res = await fetch('/api/settings/opnsense');
			if (res.ok) {
				const data = await res.json();
				host = data.host ?? '';
				apiKey = data.apiKey ?? '';
				apiSecret = data.apiSecret ?? '';
			}
		} catch {}
	});

	async function save() {
		saving = true; saveStatus = 'idle';
		try {
			const res = await fetch('/api/settings/opnsense', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ host, apiKey, apiSecret })
			});
			saveStatus = res.ok ? 'saved' : 'error';
			setTimeout(() => { saveStatus = 'idle'; }, 2500);
		} catch { saveStatus = 'error'; } finally { saving = false; }
	}

	async function testConnection() {
		testing = true; testStatus = 'idle'; testMessage = '';
		try {
			const res = await fetch('/api/opnsense');
			const json = await res.json();
			if (json.error) { testStatus = 'fail'; testMessage = json.error; }
			else { testStatus = 'ok'; testMessage = `Connected to "${json.hostname}" — OPNsense ${json.version}, uptime ${json.uptime}.`; }
		} catch (e: any) { testStatus = 'fail'; testMessage = e.message; } finally { testing = false; }
	}
</script>

<div class="flex flex-col gap-6 max-w-2xl">
	<div>
		<h2 class="text-lg font-semibold">OPNsense</h2>
		<p class="text-sm text-muted-foreground mt-1">Connect to your OPNsense firewall using an API key and secret.</p>
	</div>

	<div class="rounded-lg border bg-card p-5 space-y-5">
		<div>
			<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">API Credentials</p>
			<p class="text-xs text-muted-foreground mt-1">
				Create an API key in OPNsense under <code class="font-mono">System → Access → Users</code>.
				The user needs <code class="font-mono">Diagnostics: CPU Usage</code>, <code class="font-mono">Diagnostics: Traffic</code>,
				<code class="font-mono">Core: Service list</code>, and <code class="font-mono">DHCPv4: Leases</code> permissions.
			</p>
		</div>

		<div class="space-y-1.5">
			<label for="opn-host" class="text-sm font-medium">Host URL</label>
			<input id="opn-host" bind:value={host} placeholder="https://192.168.1.1"
				class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
			<p class="text-xs text-muted-foreground">Include protocol — e.g. <code class="font-mono">https://192.168.1.1</code></p>
		</div>

		<div class="space-y-1.5">
			<label for="opn-key" class="text-sm font-medium">API Key</label>
			<input id="opn-key" bind:value={apiKey} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
				class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono" />
		</div>

		<div class="space-y-1.5">
			<label for="opn-secret" class="text-sm font-medium">API Secret</label>
			<input id="opn-secret" type="password" bind:value={apiSecret} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
				class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono" />
		</div>
	</div>

	<div class="flex items-center gap-3">
		<button onclick={save} disabled={saving}
			class="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-60">
			{#if saving}<Loader2 class="w-4 h-4 animate-spin" />{:else}<Save class="w-4 h-4" />{/if}
			Save
		</button>
		<button onclick={testConnection} disabled={testing}
			class="inline-flex items-center gap-2 border text-sm px-4 py-2 rounded-md hover:bg-muted transition-colors disabled:opacity-60">
			{#if testing}<Loader2 class="w-4 h-4 animate-spin" />{:else}<TestTube2 class="w-4 h-4" />{/if}
			Test connection
		</button>
		{#if saveStatus === 'saved'}
			<span class="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"><CheckCircle2 class="w-4 h-4" />Saved</span>
		{:else if saveStatus === 'error'}
			<span class="inline-flex items-center gap-1.5 text-sm text-destructive"><XCircle class="w-4 h-4" />Save failed</span>
		{/if}
	</div>

	{#if testStatus !== 'idle'}
		<div class="rounded-md border p-3 flex items-start gap-2.5 text-sm {testStatus === 'ok' ? 'border-green-500/30 bg-green-500/5' : 'border-destructive/30 bg-destructive/5'}">
			{#if testStatus === 'ok'}
				<CheckCircle2 class="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
				<span class="text-green-700 dark:text-green-300">{testMessage}</span>
			{:else}
				<XCircle class="w-4 h-4 text-destructive shrink-0 mt-0.5" />
				<span class="text-destructive">{testMessage}</span>
			{/if}
		</div>
	{/if}

	<div class="rounded-md border bg-muted/30 p-4 space-y-1.5 text-xs text-muted-foreground">
		<p class="font-medium text-foreground text-sm">TLS / Self-signed certificates</p>
		<p>OPNsense uses a self-signed certificate by default. If you see a TLS error, set <code class="font-mono">NODE_TLS_REJECT_UNAUTHORIZED=0</code> in your Docker environment and restart.</p>
	</div>
</div>
