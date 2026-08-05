import { Router, Request, Response } from 'express';
import { WebSocket } from 'ws';
import { Module } from '../../../handlers/moduleInit';
import { isAuthenticatedForServer } from '../../../handlers/utils/auth/serverAuthUtil';
import { isAuthenticatedForServerWS } from '../../../handlers/utils/auth/serverAuthUtil';
import { isPluginServer, detectPluginLoader, resolveMinecraftVersion } from '../../../handlers/utils/server/pluginServer';
import logger from '../../../handlers/logger';
import prisma from '../../../db';
import { TwoTierCacheStore } from './services/cache-store';
import { ModrinthClient } from './services/modrinth-client';
import { PluginDaemonClient } from './services/daemon-client';
import { DependencyResolver } from './services/dependency-resolver';
import { CompatibilityChecker } from './services/compatibility-checker';
import { UpdateChecker } from './services/update-checker';
import { PluginBackupService } from './services/backup-service';
import { PluginScanner } from './services/plugin-scanner';
import { PluginInstaller } from './services/installer';
import { pluginProgressTracker } from './services/progress-tracker';
import { createSearchRoutes } from './routes/api/search';
import { createProjectRoutes } from './routes/api/project';
import { createInstallRoutes } from './routes/api/install';
import { createManageRoutes } from './routes/api/manage';
import { loadPluginServerContext, setupPluginManagerDatabase } from './utils/context';

let databaseReady: Promise<void> | null = null;

function ensureDatabaseReady(): Promise<void> {
  if (!databaseReady) {
    databaseReady = setupPluginManagerDatabase();
  }
  return databaseReady;
}

const pluginManagerModule: Module = {
  info: {
    name: 'Plugin Manager',
    description: 'Browse, install, and manage Minecraft plugins from Modrinth.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: (applyWs) => {
    const router = Router();

    const cache = new TwoTierCacheStore(prisma);
    const modrinthClient = new ModrinthClient(cache, logger);
    const daemonClient = new PluginDaemonClient(logger);
    const dependencyResolver = new DependencyResolver(modrinthClient, logger);
    const compatibilityChecker = new CompatibilityChecker();
    const updateChecker = new UpdateChecker(modrinthClient);
    const backupService = new PluginBackupService(daemonClient, prisma);
    const scanner = new PluginScanner(daemonClient, updateChecker, prisma);
    const installer = new PluginInstaller(
      prisma,
      modrinthClient,
      daemonClient,
      dependencyResolver,
      compatibilityChecker,
      backupService,
      logger,
    );

    void ensureDatabaseReady();
    setInterval(() => {
      cache.clearExpired().catch(() => undefined);
    }, 24 * 60 * 60 * 1000);

    router.get(
      '/server/:id/plugins',
      isAuthenticatedForServer('id'),
      async (req: Request, res: Response) => {
        try {
          await ensureDatabaseReady();
          const context = await loadPluginServerContext(req, req.params.id);
          if (context.status === 'missing-user') {
            return res.redirect('/login');
          }
          if (context.status !== 'ready') {
            return res.status(context.status === 'unsupported' ? 403 : 404).render('errors/error', {
              errorMessage: { message: context.message },
              user: req.session?.user,
              req,
            });
          }

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          const loader = detectPluginLoader(context.server.image);
          const minecraftVersion = resolveMinecraftVersion(context.server.image, context.server.Variables);
          if (!minecraftVersion) {
            logger.warn(`[PM] Could not determine Minecraft version for server ${context.server.UUID}`);
          }
          const daemonOnline = await daemonClient.isDaemonOnline(context.server);

          const rawInfo = typeof context.server.image?.info === 'string'
            ? JSON.parse(context.server.image.info)
            : (context.server.image?.info || {});
          const imageFeatures = Array.isArray(rawInfo.features) ? [...rawInfo.features] : [];
          for (const f of ['plugins', 'players', 'worlds']) {
            if (!imageFeatures.includes(f)) imageFeatures.push(f);
          }

          return res.render('user/server/plugins', {
            user: req.session?.user,
            req,
            server: context.server,
            settings,
            features: imageFeatures,
            loader,
            minecraftVersion,
            daemonOnline,
            csrfToken: req.csrfToken?.(),
          });
        } catch (error) {
          logger.error('Plugin Manager page error:', error);
          return res.status(500).render('errors/error', {
            errorMessage: { message: 'Failed to load Plugin Manager.' },
            user: req.session?.user,
            req,
          });
        }
      },
    );

    console.log('[PM MODULE] Registering API routes...');
    router.use('/server/:id/plugins/api/search', isAuthenticatedForServer('id'), createSearchRoutes(modrinthClient));
    router.use('/server/:id/plugins/api/project', isAuthenticatedForServer('id'), createProjectRoutes(modrinthClient));
    router.use('/server/:id/plugins/api/install', isAuthenticatedForServer('id'), createInstallRoutes(installer, modrinthClient, compatibilityChecker, dependencyResolver));
    router.use('/server/:id/plugins/api', isAuthenticatedForServer('id'), createManageRoutes(scanner, installer, prisma));
    console.log('[PM MODULE] API routes registered');

    if (applyWs) {
      applyWs(router);
      router.ws('/server/:id/plugins/ws/progress/:operationId', isAuthenticatedForServerWS('id'), (ws, req) => {
        const serverId = String(req.params.id);
        const operationId = String(req.params.operationId);

        const sendProgress = () => {
          const progress = pluginProgressTracker.getProgress(serverId, operationId);
          if (progress && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'progress', ...pluginProgressTracker.serialize(progress) }));
          }
        };

        sendProgress();
        const unsubscribe = pluginProgressTracker.subscribe(serverId, operationId, () => {
          sendProgress();
        });

        ws.on('close', unsubscribe);
      });
    }

    return router;
  },
};

export default pluginManagerModule;
