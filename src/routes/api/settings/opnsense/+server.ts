import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetting, setSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

export interface OPNsenseSettings {
	host: string;
	apiKey: string;
	apiSecret: string;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	try {
		const [host, apiKey, apiSecret] = await Promise.all([
			getSetting('opnsense_host'),
			getSetting('opnsense_api_key'),
			getSetting('opnsense_api_secret')
		]);
		return json({
			host: host ?? '',
			apiKey: apiKey ?? '',
			apiSecret: apiSecret ?? ''
		} satisfies OPNsenseSettings);
	} catch {
		return json({ error: 'Failed to get OPNsense settings' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		const { host, apiKey, apiSecret } = body;
		if (host !== undefined && typeof host === 'string') await setSetting('opnsense_host', host.trim());
		if (apiKey !== undefined && typeof apiKey === 'string') await setSetting('opnsense_api_key', apiKey.trim());
		if (apiSecret !== undefined && typeof apiSecret === 'string') await setSetting('opnsense_api_secret', apiSecret.trim());
		const [sh, sk, ss] = await Promise.all([
			getSetting('opnsense_host'),
			getSetting('opnsense_api_key'),
			getSetting('opnsense_api_secret')
		]);
		return json({ host: sh ?? '', apiKey: sk ?? '', apiSecret: ss ?? '' } satisfies OPNsenseSettings);
	} catch {
		return json({ error: 'Failed to save OPNsense settings' }, { status: 500 });
	}
};
