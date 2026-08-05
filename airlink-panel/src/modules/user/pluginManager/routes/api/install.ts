import { Router, Request, Response } from 'express';
import { PluginInstaller } from '../../services/installer';
import { ModrinthClient } from '../../services/modrinth-client';
import { CompatibilityChecker } from '../../services/compatibility-checker';
import { DependencyResolver } from '../../services/dependency-resolver';
import { pluginProgressTracker } from '../../services/progress-tracker';
import { validateProjectId, validateVersionId } from '../../utils/validation';
import { loadPluginServerContext } from '../../utils/context';

export function createInstallRoutes(
  installer: PluginInstaller,
  modrinthClient: ModrinthClient,
  compatibilityChecker: CompatibilityChecker,
  dependencyResolver: DependencyResolver,
): Router {
  const router = Router({ mergeParams: true });
  const activeInstallations = new Map<string, boolean>();

  router.post('/check', async (req: Request, res: Response) => {
    console.log(`[INSTALL-ROUTE] === POST /check ===`);
    console.log(`[INSTALL-ROUTE] serverId=${req.params.id}`);
    console.log(`[INSTALL-ROUTE] versionId=${req.body.versionId}`);
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      console.log(`[INSTALL-ROUTE] Context status=${context.status}`);
      if (context.status !== 'ready') {
        console.log(`[INSTALL-ROUTE] Context not ready: ${context.status} - ${context.message}`);
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      console.log(`[INSTALL-ROUTE] Server UUID=${context.server.UUID}`);
      console.log(`[INSTALL-ROUTE] Server image=${context.server.image?.name}`);

      console.log(`[INSTALL-ROUTE] Fetching version ${req.body.versionId}...`);
      const version = await modrinthClient.getVersion(req.body.versionId);
      console.log(`[INSTALL-ROUTE] Version: ${version.version_number} (${version.name})`);
      console.log(`[INSTALL-ROUTE]   loaders=[${version.loaders.join(', ')}]`);
      console.log(`[INSTALL-ROUTE]   game_versions=[${version.game_versions.join(', ')}]`);

      const isAdmin = Boolean(req.session?.user?.isAdmin);
      console.log(`[INSTALL-ROUTE] isAdmin=${isAdmin}`);

      const compatibility = compatibilityChecker.check(
        context.server.image,
        context.server.Variables,
        version,
        isAdmin,
      );
      console.log(`[INSTALL-ROUTE] Compatibility: compatible=${compatibility.compatible}`);
      console.log(`[INSTALL-ROUTE]   loader=${compatibility.loader}`);
      console.log(`[INSTALL-ROUTE]   minecraftVersion=${compatibility.minecraftVersion}`);
      console.log(`[INSTALL-ROUTE]   errors=[${compatibility.errors.join('; ')}]`);
      console.log(`[INSTALL-ROUTE]   warnings=[${compatibility.warnings.join('; ')}]`);

      const dependencies = await dependencyResolver.resolve(
        version,
        compatibility.minecraftVersion,
        compatibility.loader,
      );
      console.log(`[INSTALL-ROUTE] Dependencies: ${dependencies.length} resolved`);
      for (const dep of dependencies) {
        console.log(`[INSTALL-ROUTE]   dep: ${dep.projectName} v${dep.versionNumber} required=${dep.required}`);
      }

      console.log(`[INSTALL-ROUTE] === /check response sent ===`);
      res.json({ success: true, data: { compatibility, dependencies } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Compatibility check failed';
      console.log(`[INSTALL-ROUTE] /check ERROR: ${message}`);
      if (error instanceof Error) console.log(`[INSTALL-ROUTE] Stack: ${error.stack}`);
      res.status(400).json({ success: false, error: message });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    console.log(`[INSTALL-ROUTE] === POST /install ===`);
    console.log(`[INSTALL-ROUTE] serverId=${req.params.id}`);
    console.log(`[INSTALL-ROUTE] body=`, JSON.stringify(req.body));
    try {
      const projectValidation = validateProjectId(req.body.projectId);
      const versionValidation = validateVersionId(req.body.versionId);
      console.log(`[INSTALL-ROUTE] Validation: project=${projectValidation.valid} version=${versionValidation.valid}`);
      if (!projectValidation.valid || !versionValidation.valid) {
        console.log(`[INSTALL-ROUTE] Validation failed: ${projectValidation.error || versionValidation.error}`);
        res.status(400).json({
          success: false,
          error: projectValidation.error || versionValidation.error,
        });
        return;
      }

      const context = await loadPluginServerContext(req, req.params.id);
      console.log(`[INSTALL-ROUTE] Context status=${context.status}`);
      if (context.status !== 'ready') {
        console.log(`[INSTALL-ROUTE] Context not ready: ${context.status}`);
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      console.log(`[INSTALL-ROUTE] Server UUID=${context.server.UUID}`);
      console.log(`[INSTALL-ROUTE] Server image=${context.server.image?.name}`);
      console.log(`[INSTALL-ROUTE] Daemon=${context.server.node.address}:${context.server.node.port}`);

      const operationId = installer.createOperationId(req.body.projectId);
      console.log(`[INSTALL-ROUTE] operationId=${operationId}`);
      const installKey = `${req.params.id}:${operationId}`;
      if (activeInstallations.has(installKey)) {
        console.log(`[INSTALL-ROUTE] Duplicate installation detected`);
        res.status(409).json({ success: false, error: 'Installation already in progress' });
        return;
      }

      activeInstallations.set(installKey, true);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const sendEvent = (data: Record<string, unknown>) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Client disconnected.
        }
      };

      sendEvent({ type: 'started', operationId, message: 'Starting installation...' });
      console.log(`[INSTALL-ROUTE] SSE started`);

      const unsubscribe = pluginProgressTracker.subscribe(
        String(req.params.id),
        operationId,
        (progress) => {
          sendEvent({ type: 'progress', ...pluginProgressTracker.serialize(progress) });
        },
      );

      const cleanup = () => {
        unsubscribe();
        activeInstallations.delete(installKey);
        try {
          res.end();
        } catch {
          // Client disconnected.
        }
      };

      req.on('close', () => {
        console.log(`[INSTALL-ROUTE] Client disconnected`);
        activeInstallations.delete(installKey);
        unsubscribe();
      });

      console.log(`[INSTALL-ROUTE] Starting installFromModrinth...`);
      installer.installFromModrinth(
        context.server,
        req.body.projectId,
        req.body.versionId,
        operationId,
        {
          force: Boolean(req.body.force),
          isAdmin: Boolean(req.session?.user?.isAdmin),
          installDependencies: Boolean(req.body.installDependencies),
          dependencyIds: Array.isArray(req.body.dependencyIds) ? req.body.dependencyIds : [],
        },
      )
        .then(() => {
          console.log(`[INSTALL-ROUTE] Installation completed successfully`);
          sendEvent({ type: 'complete', operationId, message: 'Installation completed successfully' });
          cleanup();
        })
        .catch((error: Error) => {
          console.log(`[INSTALL-ROUTE] Installation failed: ${error.message}`);
          console.log(`[INSTALL-ROUTE] Stack: ${error.stack}`);
          sendEvent({ type: 'error', operationId, message: error.message || 'Installation failed' });
          cleanup();
        });
    } catch (error) {
      console.log(`[INSTALL-ROUTE] POST /install top-level error: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : 'Failed to start installation';
        res.status(500).json({ success: false, error: message });
      }
    }
  });

  return router;
}
