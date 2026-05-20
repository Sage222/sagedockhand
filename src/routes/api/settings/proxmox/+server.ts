import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting, setSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

export interface ProxmoxSettings {
	host: string;
	tokenId: string;
	tokenSecret: string;
	node: string;
	manageTokenId: string;
	manageTokenSecret: string;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	try {
		const [host, tokenId, tokenSecret, node, manageTokenId, manageTokenSecret] = await Promise.all([
			getSetting('proxmox_host'),
			getSetting('proxmox_token_id'),
			getSetting('proxmox_token_secret'),
			getSetting('proxmox_node'),
			getSetting('proxmox_manage_token_id'),
			getSetting('proxmox_manage_token_secret')
		]);
		return json({
			host: host ?? '',
			tokenId: tokenId ?? '',
			tokenSecret: tokenSecret ?? '',
			node: node ?? 'pve',
			manageTokenId: manageTokenId ?? '',
			manageTokenSecret: manageTokenSecret ?? ''
		} satisfies ProxmoxSettings);
	} catch (err) {
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
		const { host, tokenId, tokenSecret, node, manageTokenId, manageTokenSecret } = body;
		if (host !== undefined && typeof host === 'string') await setSetting('proxmox_host', host.trim());
		if (tokenId !== undefined && typeof tokenId === 'string') await setSetting('proxmox_token_id', tokenId.trim());
		if (tokenSecret !== undefined && typeof tokenSecret === 'string') await setSetting('proxmox_token_secret', tokenSecret.trim());
		if (node !== undefined && typeof node === 'string') await setSetting('proxmox_node', node.trim() || 'pve');
		if (manageTokenId !== undefined && typeof manageTokenId === 'string') await setSetting('proxmox_manage_token_id', manageTokenId.trim());
		if (manageTokenSecret !== undefined && typeof manageTokenSecret === 'string') await setSetting('proxmox_manage_token_secret', manageTokenSecret.trim());
		const [sh, sti, sts, sn, smti, smts] = await Promise.all([
			getSetting('proxmox_host'), getSetting('proxmox_token_id'), getSetting('proxmox_token_secret'),
			getSetting('proxmox_node'), getSetting('proxmox_manage_token_id'), getSetting('proxmox_manage_token_secret')
		]);
		return json({ host: sh ?? '', tokenId: sti ?? '', tokenSecret: sts ?? '', node: sn ?? 'pve', manageTokenId: smti ?? '', manageTokenSecret: smts ?? '' } satisfies ProxmoxSettings);
	} catch (err) {
		return json({ error: 'Failed to save Proxmox settings' }, { status: 500 });
	}
};
