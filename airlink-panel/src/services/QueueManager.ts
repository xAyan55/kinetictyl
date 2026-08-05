import prisma from '../db';
import logger from '../handlers/logger';
import axios from 'axios';
import { daemonSchemeSync } from '../handlers/utils/core/daemonRequest';

export class QueueManager {
  private static activeJobs = new Map<string, boolean>();

  static triggerDeployment(serverUuid: string, assignedPorts: number[] = []) {
    if (this.activeJobs.has(serverUuid)) return;
    this.activeJobs.set(serverUuid, true);

    (async () => {
      try {
        const server = await prisma.server.findUnique({
          where: { UUID: serverUuid },
          include: { image: true, node: true },
        });

        if (!server || !server.Queued) return;

        const daemonUrl = `${daemonSchemeSync()}://${server.node.address}:${server.node.port}`;
        const primaryPort = assignedPorts[0] || 25565;

        // Trigger Agent installation via MCJars / process manager
        await axios.post(
          `${daemonUrl}/servers/install`,
          {
            id: server.UUID,
            softwareType: server.softwareType || 'paper',
            softwareVersion: server.softwareVersion || 'latest',
            javaVersion: server.javaVersion || '17',
            port: primaryPort,
            memory: server.Memory,
          },
          {
            auth: { username: 'Kinetictyl', password: server.node.key },
            headers: { 'Content-Type': 'application/json' },
            timeout: 600000,
          },
        );

        await prisma.server.update({
          where: { id: server.id },
          data: { Queued: false, Installing: false },
        });

        logger.info(`QueueManager: Successfully deployed server ${server.UUID}`);
      } catch (err) {
        logger.error(`QueueManager: Error deploying server ${serverUuid}:`, err);
        try {
          await prisma.server.update({
            where: { UUID: serverUuid },
            data: { Queued: false, Installing: false },
          });
        } catch {}
      } finally {
        this.activeJobs.delete(serverUuid);
      }
    })();
  }
}
