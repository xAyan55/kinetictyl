import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import { ConfigService } from '../../services/config/ConfigService';
import { WalletService } from '../../services/WalletService';
import { StreakService } from '../../services/monetization/StreakService';
import { ConditionEvaluator } from '../../services/monetization/ConditionEvaluator';
import { EarnStatus } from '@prisma/client';

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

const earnModule: Module = {
  info: {
    name: 'User Earning Module',
    description: 'Renders the main earn page with Overview, Offers, AFK, Streaks, History, and Leaderboard.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    // GET /earn
    router.get('/earn', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const user = await prisma.users.findUnique({ where: { id: userId } });
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });

        // Load configs
        const [monetizationConfig, balance, streak, allOffers, leaderboardRaw] = await Promise.all([
          ConfigService.monetization(),
          WalletService.getBalance(userId),
          StreakService.getStreak(userId),
          prisma.offer.findMany({ where: { enabled: true }, include: { rewards: true }, orderBy: { sortOrder: 'asc' } }),
          // Group by user id and sum completed rewards
          prisma.earnSession.groupBy({
            by: ['userId'],
            where: { status: EarnStatus.COMPLETED },
            _sum: { coinsAwarded: true },
            orderBy: { _sum: { coinsAwarded: 'desc' } },
            take: 10
          })
        ]);

        // Evaluate conditions for offers
        const offers = [];
        for (const offer of allOffers) {
          const evalResult = await ConditionEvaluator.evaluate(userId, offer.conditions, {
            ip: paramStr(req.ip)
          });
          if (evalResult.allowed) {
            offers.push(offer);
          }
        }

        // Leaderboard user mapping
        const leaderboard = await Promise.all(
          leaderboardRaw.map(async (row) => {
            const rowUser = await prisma.users.findUnique({
              where: { id: row.userId },
              select: { username: true, avatar: true }
            });
            return {
              userId: row.userId,
              username: rowUser?.username || `User #${row.userId}`,
              avatar: rowUser?.avatar,
              totalEarned: row._sum.coinsAwarded || 0
            };
          })
        );

        // Calculate User Overview metrics from DB
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - 7);

        const [todayEarnedRaw, weekEarnedRaw, lifetimeEarnedRaw, recentActivity] = await Promise.all([
          prisma.earnSession.aggregate({
            where: { userId, status: EarnStatus.COMPLETED, createdAt: { gte: startOfToday } },
            _sum: { coinsAwarded: true }
          }),
          prisma.earnSession.aggregate({
            where: { userId, status: EarnStatus.COMPLETED, createdAt: { gte: startOfWeek } },
            _sum: { coinsAwarded: true }
          }),
          prisma.earnSession.aggregate({
            where: { userId, status: EarnStatus.COMPLETED },
            _sum: { coinsAwarded: true }
          }),
          prisma.earnSession.findMany({
            where: { userId, status: EarnStatus.COMPLETED },
            include: { offer: true },
            orderBy: { createdAt: 'desc' },
            take: 5
          })
        ]);

        const todayEarned = todayEarnedRaw._sum.coinsAwarded || 0;
        const weekEarned = weekEarnedRaw._sum.coinsAwarded || 0;
        const lifetimeEarned = lifetimeEarnedRaw._sum.coinsAwarded || 0;

        res.render('user/earn', {
          user,
          req,
          settings,
          balance,
          streak,
          offers,
          leaderboard,
          monetization: monetizationConfig,
          title: 'Earn Rewards',
          stats: {
            todayEarned,
            weekEarned,
            lifetimeEarned
          },
          recentActivity
        });
      } catch (error) {
        logger.error('Error loading earn page:', error);
        res.status(500).send('Error loading rewards page.');
      }
    });

    return router;
  },
};

export default earnModule;
