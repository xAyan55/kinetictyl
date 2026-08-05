import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import { ProviderRegistry } from '../../services/monetization/providers/ProviderRegistry';
import { LinkvertiseProvider } from '../../services/monetization/providers/LinkvertiseProvider';
import { AnalyticsService } from '../../services/monetization/linkvertise/AnalyticsService';

const linkvertiseAdminModule: Module = {
  info: {
    name: 'Admin Linkvertise Module',
    description: 'Linkvertise diagnostics, analytics, session inspector and configuration.',
    version: '1.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    function getProvider(): LinkvertiseProvider {
      const provider = ProviderRegistry.get('linkvertise');
      if (!provider) {
        throw new Error('Linkvertise provider not registered');
      }
      return provider as LinkvertiseProvider;
    }

    // ──────────────────────────────────────────
    // GET /admin/monetization/linkvertise
    // ──────────────────────────────────────────
    router.get(
      '/admin/monetization/linkvertise',
      isAuthenticated(true, 'monetization.view'),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          const provider = getProvider();
          const diagnostics = await provider.getDiagnostics();
          const config = provider.getConfig();

          res.render('desktop/admin/monetization/linkvertise', {
            user,
            settings,
            name: process.env.NAME || 'CynexGP',
            diagnostics,
            config,
            req,
          });
        } catch (err: any) {
          logger.error('[Admin Linkvertise] Error loading dashboard:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // ──────────────────────────────────────────
    // POST /admin/monetization/linkvertise/mock
    // Create a mock session for testing
    // ──────────────────────────────────────────
    router.post(
      '/admin/monetization/linkvertise/mock',
      isAuthenticated(true, 'monetization.manage'),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

          const provider = getProvider();
          const sessionId = await provider.createMockSession(userId);

          if (sessionId === null) {
            return res.status(400).json({ success: false, error: 'Test mode is disabled' });
          }

          res.json({ success: true, sessionId });
        } catch (err: any) {
          logger.error('[Admin Linkvertise] Mock session error:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // ──────────────────────────────────────────
    // GET /admin/monetization/linkvertise/sessions
    // Session inspector API (JSON)
    // ──────────────────────────────────────────
    router.get(
      '/admin/monetization/linkvertise/sessions',
      isAuthenticated(true, 'monetization.view'),
      async (req: Request, res: Response) => {
        try {
          const page = Math.max(1, parseInt(req.query.page as string) || 1);
          const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
          const status = req.query.status as string | undefined;

          const where: any = {};
          if (status) where.status = status;

          const [sessions, total] = await Promise.all([
            prisma.linkvertiseSession.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              skip: (page - 1) * limit,
              take: limit,
              include: {
                user: { select: { id: true, username: true } },
                completions: true,
              },
            }),
            prisma.linkvertiseSession.count({ where }),
          ]);

          res.json({
            success: true,
            sessions,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          });
        } catch (err: any) {
          logger.error('[Admin Linkvertise] Sessions fetch error:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // ──────────────────────────────────────────
    // GET /admin/monetization/linkvertise/analytics
    // Analytics API (JSON)
    // ──────────────────────────────────────────
    router.get(
      '/admin/monetization/linkvertise/analytics',
      isAuthenticated(true, 'monetization.view'),
      async (req: Request, res: Response) => {
        try {
          const hours = Math.min(168, parseInt(req.query.hours as string) || 24);
          const analytics = await AnalyticsService.getAnalytics(hours);
          res.json({ success: true, analytics });
        } catch (err: any) {
          logger.error('[Admin Linkvertise] Analytics error:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // ──────────────────────────────────────────
    // POST /admin/monetization/linkvertise/retry-failed
    // Retry failed reward sessions
    // ──────────────────────────────────────────
    router.post(
      '/admin/monetization/linkvertise/retry-failed',
      isAuthenticated(true, 'monetization.manage'),
      async (req: Request, res: Response) => {
        try {
          const provider = getProvider();
          const rewardService = provider.getRewardService();
          if (!rewardService) {
            return res.status(400).json({ success: false, error: 'Reward service not initialized' });
          }
          const retried = await rewardService.retryFailed();
          res.json({ success: true, retried });
        } catch (err: any) {
          logger.error('[Admin Linkvertise] Retry failed error:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // ──────────────────────────────────────────
    // POST /admin/monetization/linkvertise/test-link
    // Generate a test Linkvertise link and validate it
    // ──────────────────────────────────────────
    router.post(
      '/admin/monetization/linkvertise/test-link',
      isAuthenticated(true, 'monetization.manage'),
      async (req: Request, res: Response) => {
        try {
          const provider = getProvider();
          const testTarget = req.body.targetUrl || (provider.getConfig() as any).defaultDestination || 'https://example.com';

          if (typeof (provider as any).generateTestLink === 'function') {
            const result = await (provider as any).generateTestLink(testTarget);
            res.json({ success: true, ...result });
          } else {
            res.status(400).json({ success: false, error: 'generateTestLink not available on this provider version' });
          }
        } catch (err: any) {
          logger.error('[Admin Linkvertise] Test link error:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // ──────────────────────────────────────────
    // GET /admin/monetization/linkvertise/test-link
    // Render test link page
    // ──────────────────────────────────────────
    router.get(
      '/admin/monetization/linkvertise/test-link',
      isAuthenticated(true, 'monetization.view'),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          const provider = getProvider();
          const config = provider.getConfig();

          res.render('desktop/admin/monetization/linkvertise', {
            user,
            settings,
            name: process.env.NAME || 'CynexGP',
            diagnostics: null,
            config,
            testMode: true,
            req,
          });
        } catch (err: any) {
          logger.error('[Admin Linkvertise] Test link page error:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    return router;
  },
};

export default linkvertiseAdminModule;
