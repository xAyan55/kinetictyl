import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { getUser } from '../../handlers/utils/user/user';
import logger from '../../handlers/logger';
import axios from 'axios';
import { daemonSchemeSync } from '../../handlers/utils/core/daemonRequest';
import { WalletService } from '../../services/WalletService';
import { ResourceService } from '../../services/ResourceService';
import { StoreService } from '../../services/StoreService';
interface ErrorMessage {
  message?: string;
}

const dashboardModule: Module = {
  info: {
    name: 'Dashboard Module',
    description: 'This file is for dashboard functionality.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/', async (req: Request, res: Response) => {
      try {
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        const userId = req.session?.user?.id;
        let user = null;
        if (userId) {
          user = await prisma.users.findUnique({ where: { id: userId } });
        }
        res.render('landing', { user, req, settings, title: 'Home' });
      } catch (error) {
        logger.error('Error rendering landing page:', error);
        res.status(500).send('Error loading page');
      }
    });

    router.get('/dashboard', isAuthenticated(), async (req: Request, res: Response) => {
      const errorMessage: ErrorMessage = {};
      const userId = req.session?.user?.id;
      try {
        const [user, settings] = await Promise.all([
          prisma.users.findUnique({ where: { id: userId } }),
          prisma.settings.findUnique({ where: { id: 1 } }),
        ]);
        if (!user) {
          errorMessage.message = 'User not found.';
          res.render('user/dashboard', { errorMessage, user, req, walletBalance: 0, resourceTotals: { ram: { allocated: 0, used: 0, available: 0 }, cpu: { allocated: 0, used: 0, available: 0 }, disk: { allocated: 0, used: 0, available: 0 } }, recentPurchases: [], recentTransactions: [] });
          return;
        }

        const servers = await prisma.server.findMany({
          where: { ownerId: user.id },
          include: { node: true, owner: true },
        });

        let page: number = 1;

        if (typeof req.query.page === 'string') {
          page = parseInt(req.query.page, 10);
        }

        if (isNaN(page)) {
          page = 1;
        }

        const perPage = 8;
        const startIndex = (page - 1) * perPage;
        const endIndex = page * perPage;

        let anyNodeOffline = false;
        const nodeStatuses: Record<number, { online: boolean }> = {};

        for (const server of servers) {
          if (!nodeStatuses[server.node.id]) {
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
              // Silently handle node offline errors - don't log to console
              // Just mark the node as offline in our status tracking
              nodeStatuses[server.node.id] = { online: false };
              anyNodeOffline = true;
            }
          }
        }

        if (anyNodeOffline) {
          const folders = await prisma.serverFolder.findMany({
            where: { ownerId: user.id },
            include: { members: true },
            orderBy: { createdAt: 'asc' },
          });
          const canCreateServer = !user.isAdmin && (settings?.allowUserCreateServer ?? false);

          const [walletBalance, resourceTotals, purchaseHistory, transactionHistory] = await Promise.all([
            WalletService.getBalance(userId).catch(() => 0),
            ResourceService.getUserResources(userId).catch(() => ({ ram: { allocated: 0, used: 0, available: 0 }, cpu: { allocated: 0, used: 0, available: 0 }, disk: { allocated: 0, used: 0, available: 0 } })),
            StoreService.getPurchaseHistory(userId, 1, 5).catch(() => ({ purchases: [], total: 0, page: 1, totalPages: 0 })),
            WalletService.getHistory(userId, 1, 5).catch(() => ({ transactions: [], total: 0, page: 1, totalPages: 0 })),
          ]);

          return res.render('user/dashboard', {
            errorMessage: {
              message:
                'One or more nodes are offline. Some server information may be unavailable.',
            },
            user,
            req,
            settings,
            servers,
            allServers: servers,
            folders,
            canCreateServer,
            currentPage: 1,
            totalPages: 1,
            daemonOffline: true,
            nodeStatuses,
            walletBalance,
            resourceTotals,
            recentPurchases: purchaseHistory.purchases,
            recentTransactions: transactionHistory.transactions,
          });
        }

        const serversWithStats = await Promise.all(
          servers.map(async (server) => {
            try {
              if (
                nodeStatuses[server.node.id] &&
                !nodeStatuses[server.node.id].online
              ) {
                return {
                  ...server,
                  status: 'unknown',
                  ramUsage: '0',
                  cpuUsage: '0',
                  ramUsed: '0MB',
                  nodeOffline: true,
                };
              }

              const statusResponse = await axios({
                method: 'GET',
                url: `${daemonSchemeSync()}://${server.node.address}:${server.node.port}/container/status`,
                auth: {
                  username: 'CynexGP',
                  password: server.node.key,
                },
                params: { id: server.UUID },
                timeout: 2000,
              });

              const isRunning = statusResponse.data?.running === true;
              let ramUsage = '0';
              let cpuUsage = '0';
              let ramUsed = '0MB';

              if (isRunning) {
                try {
                  const statsResponse = await axios({
                    method: 'GET',
                    url: `${daemonSchemeSync()}://${server.node.address}:${server.node.port}/container/stats`,
                    auth: {
                      username: 'CynexGP',
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
                  }
                } catch (statsError) {
                  if (axios.isAxiosError(statsError)) {
                    if (
                      statsError.code !== 'ECONNREFUSED' &&
                      statsError.code !== 'ETIMEDOUT' &&
                      statsError.code !== 'ENOTFOUND'
                    ) {
                      logger.error(
                        `Error fetching stats for server ${server.UUID}:`,
                        statsError,
                      );
                    }
                  } else {
                    logger.error(
                      `Error fetching stats for server ${server.UUID}:`,
                      statsError,
                    );
                  }
                }
              }

              return {
                ...server,
                status: isRunning ? 'running' : 'stopped',
                ramUsage,
                cpuUsage,
                ramUsed,
                nodeOffline: false,
              };
            } catch (error) {
              logger.error(
                `Error fetching status for server ${server.UUID}:`,
                error,
              );
              return {
                ...server,
                status: 'unknown',
                ramUsage: '0',
                cpuUsage: '0',
                ramUsed: '0MB',
                nodeOffline: true,
              };
            }
          }),
        );

        const paginatedServers = serversWithStats.slice(startIndex, endIndex);

        const folders = await prisma.serverFolder.findMany({
          where: { ownerId: user.id },
          include: { members: true },
          orderBy: { createdAt: 'asc' },
        });

        const canCreateServer = !user.isAdmin && (settings?.allowUserCreateServer ?? false);

        const [walletBalance, resourceTotals, purchaseHistory, transactionHistory] = await Promise.all([
          WalletService.getBalance(userId).catch(() => 0),
          ResourceService.getUserResources(userId).catch(() => ({ ram: { allocated: 0, used: 0, available: 0 }, cpu: { allocated: 0, used: 0, available: 0 }, disk: { allocated: 0, used: 0, available: 0 } })),
          StoreService.getPurchaseHistory(userId, 1, 5).catch(() => ({ purchases: [], total: 0, page: 1, totalPages: 0 })),
          WalletService.getHistory(userId, 1, 5).catch(() => ({ transactions: [], total: 0, page: 1, totalPages: 0 })),
        ]);

        res.render('user/dashboard', {
          errorMessage,
          user,
          req,
          settings,
          servers: paginatedServers,
          allServers: serversWithStats,
          folders,
          canCreateServer,
          currentPage: page,
          totalPages: Math.ceil(servers.length / perPage),
          title: 'Servers',
          walletBalance,
          resourceTotals,
          recentPurchases: purchaseHistory.purchases,
          recentTransactions: transactionHistory.transactions,
        });
      } catch (error) {
        logger.error('Error fetching user:', error);
        errorMessage.message = 'Error fetching user data.';
        res.render('user/dashboard', {
          errorMessage,
          user: getUser(req),
          req,
          settings: null,
          walletBalance: 0,
          resourceTotals: { ram: { allocated: 0, used: 0, available: 0 }, cpu: { allocated: 0, used: 0, available: 0 }, disk: { allocated: 0, used: 0, available: 0 } },
          recentPurchases: [],
          recentTransactions: [],
        });
      }
    });

    return router;
  },
};


export default dashboardModule;
