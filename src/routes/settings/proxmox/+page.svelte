<script lang="ts">
	import { onMount } from 'svelte';
	import { Save, TestTube2, CheckCircle2, XCircle, Loader2 } from 'lucide-svelte';

	let host = $state('');
	let tokenId = $state('');
	let tokenSecret = $state('');
	let node = $state('pve');

	let saving = $state(false);
	let testing = $state(false);
	let saveStatus = $state<'idle' | 'saved' | 'error'>('idle');
	let testStatus = $state<'idle' | 'ok' | 'fail'>('idle');
	let testMessage = $state('');

	onMount(async () => {
		try {
			const res = await fetch('/api/settings/proxmox');
			if (res.ok) {
				const data = await res.json();
				host = data.host ?? '';
				tokenId = data.tokenId ?? '';
				tokenSecret = data.tokenSecret ?? '';
				node = data.node ?? 'pve';
			}
		} catch {}
	});

	async function save() {
		saving = true;
		saveStatus = 'idle';
		try {
			const res = await fetch('/api/settings/proxmox', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ host, tokenId, tokenSecret, node })
			});
			saveStatus = res.ok ? 'saved' : 'error';
			setTimeout(() => { saveStatus = 'idle'; }, 2500);
		} catch {
			saveStatus = 'error';
		} finally {
			saving = false;
		}
	}

	async function testConnection() {
		testing = true;
		testStatus = 'idle';
		testMessage = '';
		try {
			const res = await fetch('/api/proxmox');
			const json = await res.json();
			if (json.error) {
				testStatus = 'fail';
				testMessage = json.error;
			} else {
				testStatus = 'ok';
				testMessage = `Connected to node "${json.node}" — ${json.vmsTotal} guest(s) found.`;
			}
		} catch (e: any) {
			testStatus = 'fail';
			testMessage = e.message;
		} finally {
			testing = false;
		}
	}
</script>

<div class="flex flex-col gap-6 max-w-2xl">
	<div>
		<h2 class="text-lg font-semibold">Proxmox</h2>
		<p class="text-sm text-muted-foreground mt-1">Connect to your Proxmox VE node using an API token.</p>
	</div>

	<div class="rounded-lg border bg-card p-5 space-y-5">
		<!-- Host -->
		<div class="space-y-1.5">
			<label for="pve-host" class="text-sm font-medium">Host URL</label>
			<input
				id="pve-host"
				bind:value={host}
				placeholder="https://192.168.1.100:8006"
				class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
			/>
			<p class="text-xs text-muted-foreground">Include the protocol and port, e.g. <code class="font-mono">https://192.168.1.100:8006</code></p>
		</div>

		<!-- Token ID -->
		<div class="space-y-1.5">
			<label for="pve-token-id" class="text-sm font-medium">API Token ID</label>
			<input
				id="pve-token-id"
				bind:value={tokenId}
				placeholder="root@pam!dockhand"
				class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
			/>
			<p class="text-xs text-muted-foreground">Format: <code class="font-mono">user@realm!tokenname</code> — create under Datacenter → Permissions → API Tokens in PVE.</p>
		</div>

		<!-- Token Secret -->
		<div class="space-y-1.5">
			<label for="pve-token-secret" class="text-sm font-medium">API Token Secret</label>
			<input
				id="pve-token-secret"
				type="password"
				bind:value={tokenSecret}
				placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
				class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
			/>
		</div>

		<!-- Node -->
		<div class="space-y-1.5">
			<label for="pve-node" class="text-sm font-medium">Node Name</label>
			<input
				id="pve-node"
				bind:value={node}
				placeholder="pve"
				class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
			/>
			<p class="text-xs text-muted-foreground">The node name as it appears in PVE (default: <code class="font-mono">pve</code>).</p>
		</div>

		<!-- Actions -->
		<div class="flex items-center gap-3 pt-1">
			<button
				onclick={save}
				disabled={saving}
				class="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-60"
			>
				{#if saving}
					<Loader2 class="w-4 h-4 animate-spin" />
				{:else}
					<Save class="w-4 h-4" />
				{/if}
				Save
			</button>

			<button
				onclick={testConnection}
				disabled={testing}
				class="inline-flex items-center gap-2 border text-sm px-4 py-2 rounded-md hover:bg-muted transition-colors disabled:opacity-60"
			>
				{#if testing}
					<Loader2 class="w-4 h-4 animate-spin" />
				{:else}
					<TestTube2 class="w-4 h-4" />
				{/if}
				Test connection
			</button>

			{#if saveStatus === 'saved'}
				<span class="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
					<CheckCircle2 class="w-4 h-4" />Saved
				</span>
			{:else if saveStatus === 'error'}
				<span class="inline-flex items-center gap-1.5 text-sm text-destructive">
					<XCircle class="w-4 h-4" />Save failed
				</span>
			{/if}
		</div>
	</div>

	<!-- Test result -->
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
		<p>Proxmox uses a self-signed certificate by default. If you see a TLS error, set the environment variable <code class="font-mono">NODE_TLS_REJECT_UNAUTHORIZED=0</code> in your Docker container and restart.</p>
	</div>
</div>
