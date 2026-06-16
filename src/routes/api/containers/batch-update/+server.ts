import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { listContainers, pullImage, inspectContainer, recreateContainerFromInspect, getImageIdByTag } from '$lib/server/docker';
import { auditContainer } from '$lib/server/audit';
import { isUpdateDisabledByLabel } from '$lib/server/container-labels';

export interface BatchUpdateResult {
	containerId: string;
	containerName: string;
	success: boolean;
	error?: string;
}

/**
 * Batch update containers by recreating them with latest images.
 * Preserves ALL container settings including health checks, resource limits,
 * capabilities, DNS, security options, ulimits, and network connections.
 * Expects JSON body: { containerIds: string[] }
 */
export const POST: RequestHandler = async (event) => {
	const { url, cookies, request } = event;
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Need create permission to recreate containers
	if (auth.authEnabled && !await auth.can('containers', 'create', envIdNum)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const { containerIds } = body as { containerIds: string[] };

		if (!containerIds || !Array.isArray(containerIds) || containerIds.length === 0) {
			return json({ error: 'containerIds array is required' }, { status: 400 });
		}

		const results: BatchUpdateResult[] = [];

		// Process containers sequentially to avoid resource conflicts
		for (const containerId of containerIds) {
			try {
				const containers = await listContainers(true, envIdNum);
				const container = containers.find(c => c.id === containerId);

				if (!container) {
					results.push({
						containerId,
						containerName: 'unknown',
						success: false,
						error: 'Container not found'
					});
					continue;
				}

				// Get full container config
				const inspectData = await inspectContainer(containerId, envIdNum) as any;
				const config = inspectData.Config;
				const imageName = config.Image;
				const containerName = container.name;

				// Skip containers with dockhand.update=false label
				if (isUpdateDisabledByLabel(config.Labels)) {
					results.push({
						containerId,
						containerName,
						success: true,
						error: 'Skipped - dockhand.update=false label'
					});
					continue;
				}

				// Pull latest image first so Docker cache has the newest digest
				try {
					await pullImage(imageName, undefined, envIdNum);
				} catch (pullError: any) {
					results.push({
						containerId,
						containerName,
						success: false,
						error: `Pull failed: ${pullError.message}`
					});
					continue;
				}

				// Re-inspect AFTER pull so we have current state, then recreate
				// using recreateContainerFromInspect directly — this passes the image
				// name explicitly so Docker uses the freshly pulled digest, not the
				// stale image ID that was baked into the old container config.
				let newContainerId = containerId;
				try {
					const freshInspect = await inspectContainer(containerId, envIdNum) as any;
					const newContainer = await recreateContainerFromInspect(
						freshInspect,
						imageName,
						envIdNum,
						(msg: string) => console.log(`[batch-update] ${containerName}: ${msg}`)
					);
					newContainerId = newContainer.Id;
				} catch (recreateError: any) {
					results.push({
						containerId,
						containerName,
						success: false,
						error: `Recreate failed: ${recreateError.message}`
					});
					continue;
				}

				// Audit log
				await auditContainer(event, 'update', newContainerId, containerName, envIdNum, { batchUpdate: true });

				results.push({
					containerId: newContainerId,
					containerName,
					success: true
				});
			} catch (error: any) {
				results.push({
					containerId,
					containerName: 'unknown',
					success: false,
					error: error.message
				});
			}
		}

		const successCount = results.filter(r => r.success).length;
		const failCount = results.filter(r => !r.success).length;

		return json({
			success: failCount === 0,
			results,
			summary: {
				total: results.length,
				success: successCount,
				failed: failCount
			}
		});
	} catch (error: any) {
		console.error('Error in batch update:', error);
		return json({ error: 'Failed to batch update containers', details: error.message }, { status: 500 });
	}
};
