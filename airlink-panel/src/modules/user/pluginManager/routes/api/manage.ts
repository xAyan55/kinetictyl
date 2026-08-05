import { Router, Request, Response } from 'express';
import multer from 'multer';
import { PluginInstaller } from '../../services/installer';
import { PluginScanner } from '../../services/plugin-scanner';
import { pluginProgressTracker } from '../../services/progress-tracker';
import { sanitizeFilename } from '../../utils/validation';
import { loadPluginServerContext } from '../../utils/context';
import { PLUGIN_MANAGER_CONFIG } from '../../config';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PLUGIN_MANAGER_CONFIG.MAX_FILE_SIZE },
});

export function createManageRoutes(
  scanner: PluginScanner,
  installer: PluginInstaller,
  prisma: { $executeRaw: Function; $queryRaw: Function },
): Router {
  const router = Router({ mergeParams: true });

  router.get('/installed', async (req: Request, res: Response) => {
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      if (context.status !== 'ready') {
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      const query = typeof req.query.q === 'string' ? req.query.q : undefined;
      const plugins = await scanner.listInstalled(context.server, query);
      res.json({ success: true, data: plugins });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list installed plugins';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/upload', upload.single('plugin'), async (req: Request, res: Response) => {
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      if (context.status !== 'ready') {
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      if (!req.file?.buffer?.length) {
        res.status(400).json({ success: false, error: 'No plugin file uploaded' });
        return;
      }

      const filename = sanitizeFilename(req.file.originalname || 'plugin.jar');
      const operationId = installer.createOperationId('upload');
      await installer.uploadJar(context.server, filename, req.file.buffer, operationId);
      res.json({ success: true, data: { operationId, filename } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      res.status(400).json({ success: false, error: message });
    }
  });

  router.delete('/:filename', async (req: Request, res: Response) => {
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      if (context.status !== 'ready') {
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      await installer.deletePlugin(context.server, String(req.params.filename));
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/toggle', async (req: Request, res: Response) => {
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      if (context.status !== 'ready') {
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      const filename = sanitizeFilename(String(req.body.filename || ''));
      const enabled = Boolean(req.body.enabled);
      const newFilename = await installer.togglePlugin(context.server, filename, enabled);
      res.json({ success: true, data: { filename: newFilename, enabled } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Toggle failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/ignore-update', async (req: Request, res: Response) => {
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      if (context.status !== 'ready') {
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      const projectId = String(req.body.projectId || '');
      const versionId = String(req.body.versionId || '');
      await prisma.$executeRaw`
        INSERT OR REPLACE INTO PluginManagerIgnoredUpdate (serverId, projectId, versionId)
        VALUES (${context.server.UUID}, ${projectId}, ${versionId})
      `;
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to ignore update';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.post('/update-all', async (req: Request, res: Response) => {
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      if (context.status !== 'ready') {
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      const plugins = await scanner.listInstalled(context.server);
      const pending = plugins.filter((plugin) => plugin.updateAvailable && plugin.projectId && plugin.latestVersionId);
      const operations: Array<{ projectId: string; operationId: string }> = [];

      for (const plugin of pending) {
        const operationId = installer.createOperationId(plugin.projectId!);
        operations.push({ projectId: plugin.projectId!, operationId });
        await installer.installFromModrinth(
          context.server,
          plugin.projectId!,
          plugin.latestVersionId!,
          operationId,
          {
            force: false,
            isAdmin: Boolean(req.session?.user?.isAdmin),
            installDependencies: true,
          },
        );
      }

      res.json({ success: true, data: { updated: operations.length, operations } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bulk update failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  router.get('/progress/:operationId', async (req: Request, res: Response) => {
    const progress = pluginProgressTracker.getProgress(String(req.params.id), String(req.params.operationId));
    if (!progress) {
      res.status(404).json({ success: false, error: 'Progress not found' });
      return;
    }
    res.json({ success: true, data: pluginProgressTracker.serialize(progress) });
  });

  router.get('/config-files/:filename', async (req: Request, res: Response) => {
    try {
      const context = await loadPluginServerContext(req, req.params.id);
      if (context.status !== 'ready') {
        res.status(context.status === 'unsupported' ? 403 : 404).json({ success: false, error: context.message });
        return;
      }

      const pluginName = sanitizeFilename(String(req.params.filename)).replace(/\.jar(\.disabled)?$/i, '');
      const commonFiles = ['config.yml', 'settings.yml', 'messages.yml'];
      const files = commonFiles.map((file) => ({
        label: file,
        path: `plugins/${pluginName}/${file}`,
        editUrl: `/server/${context.server.UUID}/files/edit/plugins/${encodeURIComponent(pluginName)}/${encodeURIComponent(file)}`,
      }));

      res.json({ success: true, data: files });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve config files';
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
