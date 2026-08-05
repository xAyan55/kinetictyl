import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';

async function saveSettings(data: Record<string, any>) {
  return prisma.settings.upsert({
    where: { id: 1 },
    update: data,
    create: {
      title: 'CynexGP Cloud',
      ...data,
    },
  });
}

const cynexgpCloudModule: Module = {
  info: {
    name: 'CynexGP Cloud Module',
    description: 'CynexGP Cloud integration settings.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get(
      '/admin/cynexgp-cloud',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });

          res.render('admin/cynexgp-cloud/settings', { user, req, settings });
        } catch (error) {
          logger.error('Error loading CynexGP Cloud settings page:', error);
          res.redirect('/admin/overview');
        }
      },
    );

    router.post(
      '/admin/cynexgp-cloud',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const { airlinkCloudApiKey, airlinkCloudBackupEnabled } = req.body;

          const data: Record<string, any> = {
            airlinkCloudApiKey: airlinkCloudApiKey || null,
            airlinkCloudBackupEnabled: airlinkCloudBackupEnabled === true || airlinkCloudBackupEnabled === 'true',
          };

          await saveSettings(data);
          res.json({ success: true });
        } catch (error) {
          logger.error('Error saving CynexGP Cloud settings:', error);
          res.status(500).json({ success: false, error: 'Failed to save settings.' });
        }
      },
    );

    return router;
  },
};

export default cynexgpCloudModule;
