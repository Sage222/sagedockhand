import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting, setSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

export interface ProxmoxSettings {
	host: string;
	tokenId: string;
	tokenSecret: string;
	node: string;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		const [host, tokenId, tokenSecret, node] = await Promise.all([
			getSetting('proxmox_host'),
			getSetting('proxmox_token_id'),
			getSetting('proxmox_token_secret'),
			getSetting('proxmox_node')
		]);

		return json({
			host: host ?? '',
			tokenId: tokenId ?? '',
			tokenSecret: tokenSecret ?? '',
			node: node ?? 'pve'
		} satisfies ProxmoxSettings);
	} catch (err) {
		console.error('Failed to get Proxmox settings:', err);
		return json({ error: 'Failed to get Proxmox settings' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const { host, tokenId, tokenSecret, node } = body;

		if (host !== undefined && typeof host === 'string') {
			await setSetting('proxmox_host', host.trim());
		}
		if (tokenId !== undefined && typeof tokenId === 'string') {
			await setSetting('proxmox_token_id', tokenId.trim());
		}
		if (tokenSecret !== undefined && typeof tokenSecret === 'string') {
			await setSetting('proxmox_token_secret', tokenSecret.trim());
		}
		if (node !== undefined && typeof node === 'string') {
			await setSetting('proxmox_node', node.trim() || 'pve');
		}

		const [savedHost, savedTokenId, savedTokenSecret, savedNode] = await Promise.all([
			getSetting('proxmox_host'),
			getSetting('proxmox_token_id'),
			getSetting('proxmox_token_secret'),
			getSetting('proxmox_node')
		]);

		return json({
			host: savedHost ?? '',
			tokenId: savedTokenId ?? '',
			tokenSecret: savedTokenSecret ?? '',
			node: savedNode ?? 'pve'
		} satisfies ProxmoxSettings);
	} catch (err) {
		console.error('Failed to save Proxmox settings:', err);
		return json({ error: 'Failed to save Proxmox settings' }, { status: 500 });
	}
};
