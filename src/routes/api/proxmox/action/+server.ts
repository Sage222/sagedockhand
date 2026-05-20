import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

async function pvePost(host: string, tokenId: string, tokenSecret: string, path: string) {
	const res = await fetch(`${host}/api2/json${path}`, {
		method: 'POST',
		headers: { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`, 'Content-Type': 'application/json' },
		body: '{}'
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.errors ? Object.values(body.errors).join(', ') : `Proxmox error ${res.status}: ${res.statusText}`);
	}
	return res.json();
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	try {
		const { vmid, type, action } = await request.json();
		if (!vmid || !type || !action) return json({ error: 'Missing vmid, type, or action' }, { status: 400 });
		const validActions = ['start', 'stop', 'shutdown', 'reset', 'reboot', 'suspend', 'resume'];
		if (!validActions.includes(action)) return json({ error: 'Invalid action' }, { status: 400 });
		const [host, manageTokenId, manageTokenSecret, node] = await Promise.all([
			getSetting('proxmox_host'),
			getSetting('proxmox_manage_token_id'),
			getSetting('proxmox_manage_token_secret'),
			getSetting('proxmox_node')
		]);
		if (!host || !manageTokenId || !manageTokenSecret) {
			return json({ error: 'Manage token not configured. Add it in Settings → Proxmox.' }, { status: 400 });
		}
		const nodeName = node ?? 'pve';
		const guestType = type === 'qemu' ? 'qemu' : 'lxc';
		await pvePost(host, manageTokenId, manageTokenSecret, `/nodes/${nodeName}/${guestType}/${vmid}/status/${action}`);
		return json({ ok: true, vmid, action });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
