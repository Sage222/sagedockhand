<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { Terminal as TerminalIcon, RefreshCw } from 'lucide-svelte';

	let Terminal: any;
	let FitAddon: any;
	let xtermLoaded = $state(false);

	let terminalRef: HTMLDivElement | undefined;
	let terminal: any = null;
	let fitAddon: any = null;
	let ws: WebSocket | null = null;
	let connected = $state(false);
	let error = $state<string | null>(null);

	let host   = $derived($page.url.searchParams.get('host') || '');
	let user   = $derived($page.url.searchParams.get('user') || 'root');
	let port   = $derived($page.url.searchParams.get('port') || '22');
	let label  = $derived($page.url.searchParams.get('label') || host);

	function connect() {
		if (!terminal) return;
		error = null;
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = `${protocol}//${window.location.host}/api/ssh?host=${encodeURIComponent(host)}&user=${encodeURIComponent(user)}&port=${encodeURIComponent(port)}`;

		terminal.writeln(`\x1b[90mConnecting to ${user}@${host}...\x1b[0m`);
		terminal.writeln('');

		ws = new WebSocket(wsUrl);
		ws.binaryType = 'arraybuffer';

		ws.onopen = () => { connected = true; };

		ws.onmessage = (e) => {
			if (typeof e.data === 'string') {
				try {
					const msg = JSON.parse(e.data);
					if (msg.type === 'error') {
						error = msg.message;
						terminal?.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
					}
				} catch {
					terminal?.write(e.data);
				}
			} else {
				const bytes = new Uint8Array(e.data);
				terminal?.write(bytes);
			}
		};

		ws.onclose = (e) => {
			connected = false;
			terminal?.writeln(`\r\n\x1b[90mConnection closed (${e.code})\x1b[0m`);
		};

		ws.onerror = () => {
			connected = false;
			error = `Could not connect to ${user}@${host}`;
			terminal?.writeln(`\r\n\x1b[31mWebSocket error\x1b[0m`);
		};
	}

	function disconnect() {
		ws?.close();
		ws = null;
		connected = false;
	}

	async function initTerminal() {
		if (!terminalRef || terminal || !xtermLoaded) return;
		terminal = new Terminal({
			cursorBlink: true,
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 14,
			theme: {
				background: '#0c0c0c',
				foreground: '#cccccc',
				cursor: '#ffffff',
				selectionBackground: '#264f78',
			}
		});

		fitAddon = new FitAddon.FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(terminalRef);
		fitAddon.fit();

		terminal.onData((data: string) => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'input', data }));
			}
		});

		terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'resize', cols, rows }));
			}
		});

		connect();
	}

	const resizeObserver = typeof ResizeObserver !== 'undefined'
		? new ResizeObserver(() => fitAddon?.fit())
		: null;

	onMount(async () => {
		const [XTerm, Fit] = await Promise.all([
			import('@xterm/xterm'),
			import('@xterm/addon-fit')
		]);
		Terminal = XTerm.Terminal;
		FitAddon = Fit;
		xtermLoaded = true;
		await new Promise(r => setTimeout(r, 50));
		initTerminal();
		if (terminalRef) resizeObserver?.observe(terminalRef);
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		disconnect();
		terminal?.dispose();
	});
</script>

<svelte:head>
	<title>SageDockHand</title>
</svelte:head>

<div class="flex flex-col h-full bg-[#0c0c0c] text-white">
	<!-- Toolbar -->
	<div class="flex items-center justify-between px-3 py-1.5 bg-[#1a1a1a] border-b border-white/10 shrink-0">
		<div class="flex items-center gap-2 text-xs text-gray-400">
			<TerminalIcon class="w-3.5 h-3.5" />
			<span>{user}@{host}</span>
			{#if connected}
				<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
			{:else}
				<span class="w-1.5 h-1.5 rounded-full bg-gray-500 inline-block"></span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if !connected}
				<button
					onclick={connect}
					class="text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded border border-white/10 hover:border-white/30 transition-colors flex items-center gap-1"
				>
					<RefreshCw class="w-3 h-3" /> Reconnect
				</button>
			{:else}
				<button
					onclick={disconnect}
					class="text-xs text-gray-400 hover:text-red-400 px-2 py-0.5 rounded border border-white/10 hover:border-red-400/30 transition-colors"
				>
					Disconnect
				</button>
			{/if}
		</div>
	</div>

	{#if error}
		<div class="px-4 py-2 bg-red-950/50 border-b border-red-800/50 text-xs text-red-400 shrink-0">
			{error}
		</div>
	{/if}

	<!-- Terminal -->
	<div bind:this={terminalRef} class="flex-1 min-h-0 p-1"></div>
</div>

<style>
	:global(.xterm) { height: 100%; }
	:global(.xterm-viewport) { overflow-y: auto !important; }
</style>
