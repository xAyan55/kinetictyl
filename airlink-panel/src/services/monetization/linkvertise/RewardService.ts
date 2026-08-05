import prisma from '../../../db';
import logger from '../../../handlers/logger';
import { EconomyService, RewardDefinition } from '../EconomyService';
import { WebSocketService } from '../../WebSocketService';
import { EventBus, EVENTS } from '../EventBus';
import { LinkvertiseStatus } from '../providers/linkvertiseTypes';
import { RewardType } from '@prisma/client';

const REWARD_LOCK = new Set<number>(); // In-memory distributed lock by session ID

export class RewardService {
  private rewardRules: Record<string, number>;

  constructor(rewardRules: Record<string, number> = {}) {
    this.rewardRules = {
      earn: 20,
      bonus: 25,
      afk: 15,
      store: 10,
      ...rewardRules,
    };
  }

  /**
   * Look up reward amount for a given campaign. Falls back to session amount.
   */
  getRewardAmount(campaign: string, sessionAmount?: number): number {
    return this.rewardRules[campaign] ?? sessionAmount ?? 10;
  }

  /**
   * Process a verified callback into a coin reward.
   *
   * Uses an in-memory lock keyed by session ID to prevent double-claiming
   * across concurrent requests. The actual coin crediting is delegated
   * to EconomyService inside a Prisma transaction.
   */
  async processReward(sessionId: number): Promise<{ success: boolean; coins: number; error?: string }> {
    const correlationId = `rw-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // 1. Acquire lock
    if (REWARD_LOCK.has(sessionId)) {
      logger.warn(`[REWARD_LOCKED] correlationId=${correlationId} sessionId=${sessionId} already processing`);
      return { success: false, coins: 0, error: 'Reward already being processed' };
    }
    REWARD_LOCK.add(sessionId);

    try {
      // 2. Fetch session
      const session = await prisma.linkvertiseSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        logger.warn(`[REWARD_FAILED] correlationId=${correlationId} sessionId=${sessionId} session_not_found`);
        return { success: false, coins: 0, error: 'Session not found' };
      }

      // 3. Validate state (only COMPLETED sessions can be rewarded)
      if (session.status !== 'COMPLETED') {
        logger.warn(`[REWARD_FAILED] correlationId=${correlationId} sessionId=${sessionId} invalid_state=${session.status}`);
        return { success: false, coins: 0, error: `Invalid session state: ${session.status}` };
      }

      // 4. Determine reward amount
      const coins = this.getRewardAmount(session.campaign, session.rewardAmount);

      // 5. Transition to PENDING_REWARD
      await prisma.linkvertiseSession.update({
        where: { id: sessionId },
        data: { status: 'PENDING_REWARD' as string },
      });

      // 6. Award coins via EconomyService inside a transaction
      try {
        const rewards: RewardDefinition[] = [
          { rewardType: RewardType.COINS, amount: coins },
        ];

        await EconomyService.awardRewards({
          userId: session.userId,
          rewards,
          source: `linkvertise:${session.campaign}:${session.placement}`,
          referenceId: `lv-session-${sessionId}`,
        });

        // 7. Transition to REWARDED
        await prisma.linkvertiseSession.update({
          where: { id: sessionId },
          data: { status: 'REWARDED' as string },
        });

        logger.info(`[REWARD_SUCCESS] correlationId=${correlationId} sessionId=${sessionId} userId=${session.userId} coins=${coins}`);

        // 8. Notify user via WebSocket
        const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
        WebSocketService.sendToUser(session.userId, 'walletUpdated', {
          balance: wallet?.balance ?? 0,
        });
        WebSocketService.sendToUser(session.userId, 'offerCompleted', {
          coins,
          campaign: session.campaign,
          placement: session.placement,
        });

        // 9. Publish EventBus event
        await EventBus.publish(EVENTS.OFFER_COMPLETED, {
          userId: session.userId,
          coins,
          source: 'linkvertise',
          campaign: session.campaign,
        });

        return { success: true, coins };
      } catch (err: any) {
        // Reward failed — transition to FAILED with retry tracking
        const retryCount = session.retryCount + 1;
        await prisma.linkvertiseSession.update({
          where: { id: sessionId },
          data: {
            status: 'FAILED' as string,
            retryCount,
            errorMessage: err.message?.substring(0, 500),
          },
        });

        logger.error(`[REWARD_FAILED] correlationId=${correlationId} sessionId=${sessionId} error=${err.message} retryCount=${retryCount}`);
        return { success: false, coins: 0, error: err.message };
      }
    } finally {
      REWARD_LOCK.delete(sessionId);
    }
  }

  /**
   * Retry all FAILED sessions that haven't exceeded the retry limit.
   */
  async retryFailed(maxRetries: number = 3): Promise<number> {
    const failedSessions = await prisma.linkvertiseSession.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: maxRetries },
      },
      take: 50,
    });

    let retried = 0;
    for (const session of failedSessions) {
      // Reset to COMPLETED so processReward can pick it up again
      await prisma.linkvertiseSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED' as string },
      });
      const result = await this.processReward(session.id);
      if (result.success) retried++;
    }

    logger.info(`[REWARD_RETRY] Retried ${failedSessions.length} sessions, ${retried} succeeded`);
    return retried;
  }
}
