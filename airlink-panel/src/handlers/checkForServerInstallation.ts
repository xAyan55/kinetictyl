import axios from 'axios';
import prisma from '../db';
import { checkNodeStatus } from './utils/node/nodeStatus';
import { daemonSchemeSync } from './utils/core/daemonRequest';

type CheckInstallationResult = {
  installed: boolean;
  state?: string;
  failed?: boolean;
  error?: string;
};

// In-memory cache so repeated calls within the same request cycle or across
// rapid page navigations don't all hit the daemon independently.
const cache = new Map<string, { data: string; timestamp: number }>();
const CACHE_TTL_MS = 8000;

export async function checkForServerInstallation(
  serverId: string,
): Promise<CheckInstallationResult> {
  try {
    const server = await prisma.server.findUnique({
      where: { UUID: serverId },
      include: { node: true },
    });

    if (!server) {
      return { installed: false, error: 'Server not found.' };
    }

    // If the DB says it's installing or queued, return state: 'installing'
    if (server.Installing || server.Queued) {
      return { installed: false, state: 'installing' };
    }

    const now = Date.now();
    const cached = cache.get(serverId);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return {
        installed: cached.data === 'installed',
        state: cached.data,
        failed: cached.data === 'failed',
      };
    }

    const nodeStatus = await checkNodeStatus(server.node);
    if (nodeStatus.status === 'Offline') {
      return { installed: false, state: 'offline' };
    }

    const response = await axios.get(
      `${daemonSchemeSync()}://${server.node.address}:${server.node.port}/servers/status/${server.UUID}`,
      { auth: { username: 'Kinetictyl', password: server.node.key }, timeout: 4000 },
    );

    const state = response.data.state as string;
    const isInstalled = state === 'installed' || state === 'offline';

    if (state === 'installing') {
      return { installed: false, state: 'installing' };
    }

    cache.set(serverId, { data: state, timestamp: now });

    // Keep the DB in sync so next page load hits the fast path above.
    await prisma.server.update({
      where: { UUID: serverId },
      data: { Installing: false, Queued: false },
    });

    return { installed: isInstalled, state, failed: state === 'failed' };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { installed: false, state: 'not_found' };
    }
    return { installed: false, error: 'Could not reach daemon.' };
  }
}
