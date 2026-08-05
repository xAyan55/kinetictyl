import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import axios from 'axios';
import { daemonSchemeSync } from '../../handlers/utils/core/daemonRequest';

const instancesModule: Module = {
  info: {
    name: 'Instances Module',
    description: 'Server instances management page.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/instances', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });

        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (!user) {
          res.redirect('/dashboard');
          return;
        }

        const servers = await prisma.server.findMany({
          where: { ownerId: user.id },
          include: { node: true, owner: true, image: true },
        });

        const nodeStatuses: Record<number, { online: boolean }> = {};

        for (const server of servers) {
          if (server.node && !nodeStatuses[server.node.id]) {
            try {
              await axios({
                method: 'GET',
                url: `${daemonSchemeSync()}://${server.node.address}:${server.node.port}`,
                auth: {
                  username: 'CynexGP',
                  password: server.node.key,
                },
                timeout: 2000,
              });
              nodeStatuses[server.node.id] = { online: true };
            } catch {
              nodeStatuses[server.node.id] = { online: false };
            }
          }
        }

        const serversWithStats = await Promise.all(
          servers.map(async (server) => {
            try {
              if (!server.node) {
                return {
                  ...server,
                  status: 'unknown',
                  ramUsage: '0',
                  cpuUsage: '0',
                  ramUsed: '0MB',
                  diskUsed: '0MB',
                  nodeOffline: true,
                };
              }

              if (nodeStatuses[server.node.id] && !nodeStatuses[server.node.id].online) {
                return {
                  ...server,
                  status: 'unknown',
                  ramUsage: '0',
                  cpuUsage: '0',
                  ramUsed: '0MB',
                  diskUsed: '0MB',
                  nodeOffline: true,
                };
              }

              const statusResponse = await axios({
                method: 'GET',
                url: `${daemonSchemeSync()}://${server.node.address}:${server.node.port}/servers/status`,
                auth: {
                  username: 'Kinetictyl',
                  password: server.node.key,
                },
                params: { id: server.UUID },
                timeout: 2000,
              });

              const isRunning = statusResponse.data?.running === true;
              let ramUsage = '0';
              let cpuUsage = '0';
              let ramUsed = '0MB';
              let diskUsed = '0MB';

              if (isRunning) {
                try {
                  const statsResponse = await axios({
                    method: 'GET',
                    url: `${daemonSchemeSync()}://${server.node.address}:${server.node.port}/servers/stats`,
                    auth: {
                      username: 'Kinetictyl',
                      password: server.node.key,
                    },
                    params: { id: server.UUID },
                    timeout: 2000,
                  });

                  if (statsResponse.data) {
                    const rawRam = Number(statsResponse.data.memory?.percentage) || 0;
                    const rawCpu = Number(statsResponse.data.cpu?.percentage) || 0;
                    ramUsage = String(Math.round(rawRam * 100) / 100);
                    cpuUsage = String(Math.round(rawCpu * 100) / 100);

                    const memUsageBytes = statsResponse.data.memory?.usage || 0;
                    const memUsageMB = memUsageBytes / (1024 * 1024);
                    ramUsed = memUsageMB >= 1024
                      ? `${(memUsageMB / 1024).toFixed(1)}GB`
                      : `${memUsageMB.toFixed(0)}MB`;

                    const diskUsageBytes = statsResponse.data.disk?.usage || 0;
                    const diskUsageMB = diskUsageBytes / (1024 * 1024);
                    diskUsed = diskUsageMB >= 1024
                      ? `${(diskUsageMB / 1024).toFixed(1)}GB`
                      : `${diskUsageMB.toFixed(0)}MB`;
                  }
                } catch {
                  // Stats unavailable
                }
              }

              return {
                ...server,
                status: server.Suspended ? 'suspended' : (isRunning ? 'running' : 'stopped'),
                ramUsage,
                cpuUsage,
                ramUsed,
                diskUsed,
                nodeOffline: false,
              };
            } catch (error) {
              logger.error(`Error fetching status for server ${server.UUID}:`, error);
              return {
                ...server,
                status: server.Suspended ? 'suspended' : 'unknown',
                ramUsage: '0',
                cpuUsage: '0',
                ramUsed: '0MB',
                diskUsed: '0MB',
                nodeOffline: true,
              };
            }
          }),
        );

        res.render('user/instances', {
          user,
          req,
          servers: serversWithStats,
          settings,
          title: 'Instances',
        });
      } catch (error) {
        logger.error('Error fetching instances:', error);
        res.status(500).send('Error loading instances.');
      }
    });

    return router;
  },
};

export default instancesModule;
