import prisma from '../../../db';
import logger from '../../../handlers/logger';

export interface LinkvertiseAnalytics {
  totalSessions: number;
  completedSessions: number;
  rewardedSessions: number;
  failedSessions: number;
  expiredSessions: number;
  completionRate: number;
  rewardRate: number;
  totalCoinsAwarded: number;
  avgCompletionTimeMs: number;
  campaignBreakdown: Record<string, { total: number; completed: number; rewarded: number; coins: number }>;
  placementBreakdown: Record<string, { total: number; completed: number; rewarded: number }>;
  recentSessions: Array<{
    id: number;
    userId: number;
    campaign: string;
    placement: string;
    status: string;
    rewardAmount: number;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}

export class AnalyticsService {
  /**
   * Compute full analytics from Prisma aggregates.
   */
  static async getAnalytics(hours: number = 24): Promise<LinkvertiseAnalytics> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [sessions, aggregates] = await Promise.all([
      prisma.linkvertiseSession.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.linkvertiseSession.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: true,
        _sum: { rewardAmount: true },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    let totalCoins = 0;
    for (const agg of aggregates) {
      statusCounts[agg.status] = agg._count;
      if (agg.status === 'REWARDED') {
        totalCoins = agg._sum.rewardAmount ?? 0;
      }
    }

    const total = sessions.length;
    const completed = (statusCounts['COMPLETED'] ?? 0) + (statusCounts['VERIFIED'] ?? 0) +
      (statusCounts['PENDING_REWARD'] ?? 0) + (statusCounts['REWARDED'] ?? 0);
    const rewarded = statusCounts['REWARDED'] ?? 0;
    const failed = statusCounts['FAILED'] ?? 0;
    const expired = statusCounts['EXPIRED'] ?? 0;

    // Avg completion time
    const completedSessions = sessions.filter(s => s.completedAt);
    const avgCompletionTimeMs = completedSessions.length > 0
      ? completedSessions.reduce((sum, s) => {
          return sum + (s.completedAt!.getTime() - s.createdAt.getTime());
        }, 0) / completedSessions.length
      : 0;

    // Campaign breakdown
    const campaignBreakdown: Record<string, { total: number; completed: number; rewarded: number; coins: number }> = {};
    for (const s of sessions) {
      if (!campaignBreakdown[s.campaign]) {
        campaignBreakdown[s.campaign] = { total: 0, completed: 0, rewarded: 0, coins: 0 };
      }
      campaignBreakdown[s.campaign].total++;
      if (['COMPLETED', 'VERIFIED', 'PENDING_REWARD', 'REWARDED'].includes(s.status)) {
        campaignBreakdown[s.campaign].completed++;
      }
      if (s.status === 'REWARDED') {
        campaignBreakdown[s.campaign].rewarded++;
        campaignBreakdown[s.campaign].coins += s.rewardAmount;
      }
    }

    // Placement breakdown
    const placementBreakdown: Record<string, { total: number; completed: number; rewarded: number }> = {};
    for (const s of sessions) {
      if (!placementBreakdown[s.placement]) {
        placementBreakdown[s.placement] = { total: 0, completed: 0, rewarded: 0 };
      }
      placementBreakdown[s.placement].total++;
      if (['COMPLETED', 'VERIFIED', 'PENDING_REWARD', 'REWARDED'].includes(s.status)) {
        placementBreakdown[s.placement].completed++;
      }
      if (s.status === 'REWARDED') {
        placementBreakdown[s.placement].rewarded++;
      }
    }

    return {
      totalSessions: total,
      completedSessions: completed,
      rewardedSessions: rewarded,
      failedSessions: failed,
      expiredSessions: expired,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
      rewardRate: total > 0 ? (rewarded / total) * 100 : 0,
      totalCoinsAwarded: totalCoins,
      avgCompletionTimeMs,
      campaignBreakdown,
      placementBreakdown,
      recentSessions: sessions.slice(0, 20).map(s => ({
        id: s.id,
        userId: s.userId,
        campaign: s.campaign,
        placement: s.placement,
        status: s.status,
        rewardAmount: s.rewardAmount,
        createdAt: s.createdAt,
        completedAt: s.completedAt,
      })),
    };
  }
}
