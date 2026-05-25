import { json, type RequestHandler } from '@sveltejs/kit';

/**
 * The OPNsense DHCP lease API (dhcpv4/leases/searchLease) is only available
 * when OPNsense is using the Kea DHCP backend. The legacy ISC DHCP backend
 * (used by most installations) returns 404 for this endpoint.
 *
 * Rather than showing a persistent error, this route now returns an empty
 * lease list with a flag so the UI can gracefully hide the feature.
 */
export const GET: RequestHandler = async () => {
	return json({ leases: [], total: 0, unavailable: true });
};
