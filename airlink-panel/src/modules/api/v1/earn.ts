import { Router, Request, Response } from 'express';
import { Module } from '../../../handlers/moduleInit';
import prisma from '../../../db';
import { isAuthenticated } from '../../../handlers/utils/auth/authUtil';
import { ProviderRegistry } from '../../../services/monetization/providers/ProviderRegistry';
import { StreakService } from '../../../services/monetization/StreakService';
import { AfkService } from '../../../services/monetization/AfkService';
import { FraudService } from '../../../services/monetization/FraudService';
import { EconomyService } from '../../../services/monetization/EconomyService';
import { ConditionEvaluator } from '../../../services/monetization/ConditionEvaluator';
import { RateLimiterService } from '../../../services/monetization/RateLimiterService';
import { ProviderType, EarnType, EarnStatus, RewardType } from '@prisma/client';
import crypto from 'crypto';
import logger from '../../../handlers/logger';

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

// In-memory idempotency cache
const processedIdempotencyKeys = new Map<string, { timestamp: number; response: any }>();

const earnApiModule: Module = {
  info: {
    name: 'Versioned Earning REST API',
    description: 'Provides versioned user earn endpoints under /api/v1/earn.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    // Middleware to validate Idempotency-Key on POST requests
    const checkIdempotency = (req: Request, res: Response, next: any) => {
      if (req.method === 'POST') {
        const key = req.headers['idempotency-key'] as string;
        if (!key) {
          return res.status(400).json({ success: false, error: 'Idempotency-Key header is required for POST endpoints.' });
        }
        
        const cached = processedIdempotencyKeys.get(key);
        if (cached) {
          logger.info(`[Idempotency] Returning cached response for key: ${key}`);
          return res.status(200).json(cached.response);
        }
      }
      next();
    };

    const saveIdempotency = (req: Request, responseBody: any) => {
      const key = req.headers['idempotency-key'] as string;
      if (key) {
        processedIdempotencyKeys.set(key, {
          timestamp: Date.now(),
          response: responseBody
        });
      }
    };

    // ──────────────────────────────────────────
    // Endpoints
    // ──────────────────────────────────────────

    // GET /api/v1/earn - Status overview
    router.get('/api/v1/earn', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const streak = await StreakService.getStreak(userId);
        const afkMinutes = await AfkService.getDailyAfkMinutes(userId);

        res.json({
          success: true,
          streak: {
            current: streak.currentStreak,
            best: streak.bestStreak,
            lastClaimDate: streak.lastClaimDate
          },
          afk: {
            minutesEarnedToday: afkMinutes
          }
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // GET /api/v1/earn/offers - List dynamic offers
    router.get('/api/v1/earn/offers', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const offers = await prisma.offer.findMany({
          where: { enabled: true },
          include: { rewards: true },
          orderBy: { sortOrder: 'asc' }
        });

        // Filter offers based on evaluator conditions
        const evaluatedOffers = [];
        for (const offer of offers) {
          const evalResult = await ConditionEvaluator.evaluate(userId, offer.conditions, {
            ip: paramStr(req.ip)
          });
          if (evalResult.allowed) {
            evaluatedOffers.push(offer);
          }
        }

        res.json({ success: true, offers: evaluatedOffers });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // GET /api/v1/earn/offers/:id - Config for a specific offer
    router.get('/api/v1/earn/offers/:id', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const id = parseInt(paramStr(req.params.id), 10);
        const offer = await prisma.offer.findUnique({
          where: { id },
          include: { rewards: true }
        });

        if (!offer) {
          return res.status(404).json({ success: false, error: 'Offer not found.' });
        }

        res.json({ success: true, offer });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // GET /api/v1/earn/providers - Active providers status
    router.get('/api/v1/earn/providers', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const providers = ProviderRegistry.getAll().map((p) => ({
          id: p.id,
          name: p.name,
          version: p.version
        }));
        res.json({ success: true, providers });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // GET /api/v1/earn/history - Paginated user reward logs
    router.get('/api/v1/earn/history', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const page = Math.max(1, parseInt(paramStr(req.query.page as string), 10) || 1);
        const limit = 15;

        const [history, total] = await Promise.all([
          prisma.earnSession.findMany({
            where: { userId, status: EarnStatus.COMPLETED },
            include: { offer: true },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit
          }),
          prisma.earnSession.count({
            where: { userId, status: EarnStatus.COMPLETED }
          })
        ]);

        res.json({
          success: true,
          history,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // GET /api/v1/earn/leaderboard - Top earners
    router.get('/api/v1/earn/leaderboard', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        // Group by user id and sum reward coins
        const topEarners = await prisma.earnSession.groupBy({
          by: ['userId'],
          where: { status: EarnStatus.COMPLETED },
          _sum: { coinsAwarded: true },
          orderBy: { _sum: { coinsAwarded: 'desc' } },
          take: 10
        });

        const usersWithDetails = await Promise.all(
          topEarners.map(async (earner) => {
            const user = await prisma.users.findUnique({
              where: { id: earner.userId },
              select: { username: true, avatar: true }
            });
            return {
              userId: earner.userId,
              username: user?.username || `User #${earner.userId}`,
              avatar: user?.avatar,
              totalEarned: earner._sum.coinsAwarded || 0
            };
          })
        );

        res.json({ success: true, leaderboard: usersWithDetails });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // POST /api/v1/earn/link - Initialize link validation session
    router.post(
      '/api/v1/earn/link',
      isAuthenticated(),
      checkIdempotency,
      RateLimiterService.middleware({ windowMs: 60 * 1000, max: 5 }),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session!.user!.id;
          const { offerId } = req.body;

          const offer = await prisma.offer.findUnique({
            where: { id: Number(offerId) },
            include: { rewards: true }
          });

          if (!offer || !offer.enabled) {
            return res.status(404).json({ success: false, error: 'Offer not found or disabled.' });
          }

          // Evaluate conditions
          const evalResult = await ConditionEvaluator.evaluate(userId, offer.conditions, {
            ip: paramStr(req.ip)
          });
          if (!evalResult.allowed) {
            return res.status(400).json({ success: false, error: evalResult.reason || 'You do not meet the conditions for this offer.' });
          }

          // Fraud check
          const riskResult = await FraudService.evaluateRisk({
            userId,
            ipAddress: paramStr(req.ip),
            userAgent: req.headers['user-agent']
          });

          if (riskResult.verdict === 'BLOCKED') {
            return res.status(403).json({ success: false, error: 'Request flagged by fraud prevention. Action blocked.' });
          }

          const token = crypto.randomBytes(32).toString('hex');
          const nonce = crypto.randomBytes(16).toString('hex');

          // Create earn session
          const session = await prisma.earnSession.create({
            data: {
              userId,
              type: EarnType.OFFER,
              status: EarnStatus.PENDING,
              provider: offer.provider,
              offerId: offer.id,
              token,
              nonce,
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours expiration
              metadata: { correlationId: `link-${Date.now()}` } as any
            }
          });

          // Fetch provider from registry to construct redirect URL
          const provider = ProviderRegistry.get(offer.provider);
          const redirectUrl = await provider.generateLink(req.session!.user, offer, offer.targetUrl, {
            sessionToken: token
          });

          const resBody = { success: true, redirectUrl, sessionToken: token };
          saveIdempotency(req, resBody);
          res.json(resBody);
        } catch (err: any) {
          logger.error('Error generating link session:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /api/v1/earn/claim - Daily streak claim
    router.post(
      '/api/v1/earn/claim',
      isAuthenticated(),
      checkIdempotency,
      RateLimiterService.middleware({ windowMs: 10 * 1000, max: 2 }),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session!.user!.id;
          const { timezone } = req.body;

          const claimResult = await StreakService.claimDaily(userId, timezone || 'UTC');
          if (!claimResult.success) {
            return res.status(400).json({ success: false, error: claimResult.error });
          }

          const resBody = {
            success: true,
            coinsAwarded: claimResult.coinsAwarded,
            newStreak: claimResult.newStreak
          };
          saveIdempotency(req, resBody);
          res.json(resBody);
        } catch (err: any) {
          logger.error('Error claiming daily streak:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /api/v1/earn/afk/start - Initialize AFK session
    router.post(
      '/api/v1/earn/afk/start',
      isAuthenticated(),
      RateLimiterService.middleware({ windowMs: 10 * 1000, max: 3 }),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session!.user!.id;
          const { sessionToken } = req.body;

          if (!sessionToken) {
            return res.status(400).json({ success: false, error: 'Session token is required.' });
          }

          const startResult = await AfkService.startSession(
            userId,
            sessionToken,
            paramStr(req.ip),
            req.headers['user-agent']
          );

          if (!startResult.success) {
            return res.status(400).json({ success: false, error: startResult.error });
          }

          res.json({ success: true, sessionId: startResult.sessionId });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /api/v1/earn/afk/heartbeat - Handle AFK heartbeats
    router.post(
      '/api/v1/earn/afk/heartbeat',
      isAuthenticated(),
      RateLimiterService.middleware({ windowMs: 40 * 1000, max: 2 }), // Heartbeat rate limit
      async (req: Request, res: Response) => {
        try {
          const userId = req.session!.user!.id;
          const { sessionToken, visible, focused, mouseX, mouseY, keysPressed } = req.body;

          if (!sessionToken) {
            return res.status(400).json({ success: false, error: 'Session token is required.' });
          }

          // Evaluate potential fraud on heartbeat
          const riskResult = await FraudService.evaluateRisk({
            userId,
            ipAddress: paramStr(req.ip),
            userAgent: req.headers['user-agent']
          });

          if (riskResult.verdict === 'BLOCKED') {
            await AfkService.stopSession(userId, sessionToken);
            return res.status(403).json({ success: false, error: 'Heartbeat blocked by fraud scanning.' });
          }

          const beatResult = await AfkService.heartbeat(userId, sessionToken, {
            visible: visible === true || visible === 'true',
            focused: focused === true || focused === 'true',
            mouseX,
            mouseY,
            keysPressed,
            ipAddress: paramStr(req.ip)
          });

          if (!beatResult.success) {
            return res.status(400).json({ success: false, error: beatResult.error, status: beatResult.status });
          }

          res.json({
            success: true,
            coinsAwarded: beatResult.coinsAwarded,
            status: beatResult.status
          });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /api/v1/earn/afk/stop - Terminate AFK session cleanly
    router.post('/api/v1/earn/afk/stop', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const { sessionToken } = req.body;

        await AfkService.stopSession(userId, sessionToken);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // POST /api/v1/earn/reward/preview - Preview complex returns
    router.post('/api/v1/earn/reward/preview', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const { multiplier, baseValue } = req.body;
        const preview = (Number(baseValue) || 10) * (Number(multiplier) || 1);
        res.json({ success: true, preview });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ──────────────────────────────────────────
    // Webhook Routing & Callback Receiver
    // ──────────────────────────────────────────
    
    // GET /api/v1/earn/webhook/:provider
    router.get('/api/v1/earn/webhook/:provider', async (req: Request, res: Response) => {
      try {
        const providerSlug = paramStr(req.params.provider).toLowerCase();
        const provider = ProviderRegistry.get(providerSlug);
        
        if (!provider.supportsWebhook()) {
          return res.status(400).json({ success: false, error: 'Webhooks not supported for this provider.' });
        }

        const isValid = await provider.verifyCallback(req);
        if (!isValid) {
          return res.status(400).json({ success: false, error: 'Callback signature or parameters invalid.' });
        }

        // Get token and match session
        const token = paramStr(req.query.token as string);
        const session = await prisma.earnSession.findUnique({
          where: { token },
          include: { offer: { include: { rewards: true } } }
        });

        if (!session || session.status !== EarnStatus.PENDING) {
          return res.status(400).json({ success: false, error: 'Earning session is invalid, expired or already completed.' });
        }

        // Update session as completed inside transaction and dispatch rewards
        await prisma.$transaction(async (tx) => {
          await tx.earnSession.update({
            where: { id: session.id },
            data: { status: EarnStatus.COMPLETED, completedAt: new Date() }
          });

          const rewards = session.offer?.rewards || [];
          const rewardDefs = rewards.map((r) => ({
            rewardType: r.rewardType,
            amount: r.amount
          }));

          await EconomyService.awardRewards({
            userId: session.userId,
            rewards: rewardDefs,
            source: session.offer?.name || 'Monetization Offer',
            referenceId: session.token,
            ipAddress: paramStr(req.ip),
            tx
          });
        });

        res.json({ success: true, message: 'Webhook callback verified and rewards credited.' });
      } catch (err: any) {
        logger.error('[WebhookController] Webhook verification failed:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ────────────────────────────────────────────────────────────
    // GET /api/v1/earn/linkvertise-complete
    // Linkvertise Dynamic Link completion callback.
    //
    // When Linkvertise finishes showing ads, it redirects the user
    // to the URL encoded in the `r` parameter of the dynamic link.
    // Our LinkBuilder encodes our own callback URL as the `r` value,
    // with the token and original redirect embedded as query params.
    //
    // This endpoint:
    //   1. Verifies the signed token
    //   2. Looks up the LinkvertiseSession and transitions it
    //   3. Rewards the user
    //   4. Redirects to the original destination
    // ────────────────────────────────────────────────────────────
    router.get(
      '/api/v1/earn/linkvertise-complete',
      async (req: Request, res: Response) => {
        try {
          const token = String(req.query.token || '');
          const redirect = String(req.query.redirect || '');
          const campaign = String(req.query.campaign || 'earn');
          const placement = String(req.query.placement || 'offer_wall');

          if (!token) {
            return res.status(400).send('Missing completion token.');
          }

          // Look up the Linkvertise session
          const session = await prisma.linkvertiseSession.findUnique({
            where: { token },
          });

          if (!session) {
            logger.warn(`[LV_COMPLETE] Session not found for token=${token.substring(0, 20)}...`);
            return res.redirect(redirect || '/earn');
          }

          // Only transition from CREATED or VISITED
          if (session.status === 'CREATED' || session.status === 'VISITED') {
            const now = new Date();
            await prisma.linkvertiseSession.update({
              where: { id: session.id },
              data: {
                status: 'COMPLETED',
                ip: req.ip || req.socket?.remoteAddress || '',
                userAgent: req.headers['user-agent'] || '',
                completedAt: now,
              },
            });

            // Process reward via the provider
            try {
              const provider = ProviderRegistry.get('linkvertise');
              if (provider && typeof (provider as any).getRewardService === 'function') {
                const rewardService = (provider as any).getRewardService();
                if (rewardService) {
                  await rewardService.processReward(session.id);
                }
              }
            } catch (rewardErr: any) {
              logger.error(`[LV_COMPLETE] Reward processing failed for session=${session.id}: ${rewardErr.message}`);
            }

            logger.info(`[LV_COMPLETE] Session ${session.id} completed, redirecting to ${redirect || session.destination}`);
          }

          const destination = redirect || session.destination || '/earn';
          res.redirect(destination);
        } catch (err: any) {
          logger.error('[LV_COMPLETE] Error processing completion:', err);
          const fallback = String(req.query.redirect || '/earn');
          res.redirect(fallback);
        }
      }
    );

    return router;
  },
};

export default earnApiModule;
