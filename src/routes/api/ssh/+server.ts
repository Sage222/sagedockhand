/**
 * SSH Terminal WebSocket Endpoint
 * Spawns an SSH session to a remote host and bridges it to the browser via WebSocket.
 * Used by the Proxmox and OPNsense Shell buttons.
 *
 * WebSocket URL: /api/ssh?host=<ip>&user=<user>&port=<port>
 */

import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { json } from '@sveltejs/kit';

// HTTP GET — used for WebSocket upgrade (handled by server.ts ws handler)
// This endpoint also serves as a REST health-check
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const host = url.searchParams.get('host');
	if (!host) return json({ error: 'Missing host parameter' }, { status: 400 });

	return json({ ready: true, host });
};
