import prisma from '../../db';
import { EconomyService } from './EconomyService';
import { ConfigService } from '../config/ConfigService';
import { RewardType } from '@prisma/client';
import { EventBus, EVENTS } from './EventBus';
import logger from '../../handlers/logger';

export class StreakService {
  /**
   * Retrieves or creates a user's streak status.
   */
  static async getStreak(userId: number) {
    let streak = await prisma.userStreak.findUnique({
      where: { userId }
    });

    if (!streak) {
      streak = await prisma.userStreak.create({
        data: {
          userId,
          currentStreak: 0,
          bestStreak: 0,
          lastClaimDate: null
        }
      });
    }

    // Check if streak was broken (last claim was more than 48 hours ago)
    const isBroken = this.checkIfStreakBroken(streak.lastClaimDate);
    if (isBroken && streak.currentStreak > 0) {
      streak = await prisma.userStreak.update({
        where: { userId },
        data: {
          currentStreak: 0
        }
      });
    }

    return streak;
  }

  /**
   * Claims the streak reward for today.
   */
  static async claimDaily(userId: number, timezone = 'UTC'): Promise<{ success: boolean; coinsAwarded: number; newStreak: number; error?: string }> {
    const now = new Date();
    
    return prisma.$transaction(async (tx) => {
      const streak = await tx.userStreak.findUnique({ where: { userId } });
      if (!streak) {
        throw new Error('Streak record not found.');
      }

      // Check reset rules and breaks
      if (streak.lastClaimDate) {
        const lastClaimLocal = new Date(streak.lastClaimDate);
        const nowLocal = new Date();

        // Standard 24h reset validation based on Date strings (same calendar day block)
        const formatLocalDate = (d: Date) => {
          return d.toLocaleDateString('en-US', { timeZone: timezone });
        };

        if (formatLocalDate(lastClaimLocal) === formatLocalDate(nowLocal)) {
          return { success: false, coinsAwarded: 0, newStreak: streak.currentStreak, error: 'You have already claimed your daily reward today.' };
        }

        // Check if streak was broken before incrementing
        const isBroken = this.checkIfStreakBroken(streak.lastClaimDate);
        if (isBroken) {
          streak.currentStreak = 0;
        }
      }

      const nextStreakValue = streak.currentStreak + 1;
      const bestStreakValue = Math.max(streak.bestStreak, nextStreakValue);

      // Load config to calculate milestone rewards
      const config = await ConfigService.getAll();
      const monetizationConfig = config.monetization || {};
      const baseReward = Number(monetizationConfig.coinsPerLinkCompletion || 10); // default fallback

      // Calculate streak bonus
      let rewardCoins = baseReward;
      const milestoneRewards: Record<number, number> = {
        1: Number(monetizationConfig.streakDay1Reward || 10),
        3: Number(monetizationConfig.streakDay3Reward || 30),
        7: Number(monetizationConfig.streakDay7Reward || 100),
        14: Number(monetizationConfig.streakDay14Reward || 250),
        30: Number(monetizationConfig.streakDay30Reward || 600),
      };

      if (milestoneRewards[nextStreakValue]) {
        rewardCoins = milestoneRewards[nextStreakValue];
      }

      // Update UserStreak status
      await tx.userStreak.update({
        where: { userId },
        data: {
          currentStreak: nextStreakValue,
          bestStreak: bestStreakValue,
          lastClaimDate: now
        }
      });

      // Award the coins through the EconomyService transaction boundary
      await EconomyService.awardRewards({
        userId,
        rewards: [{ rewardType: RewardType.COINS, amount: rewardCoins }],
        source: `Daily Streak Day ${nextStreakValue}`,
        referenceId: `streak-claim-${userId}-${Date.now()}`,
        tx
      });

      // Emit event
      await EventBus.publish(EVENTS.STREAK_CLAIMED, {
        userId,
        streakDays: nextStreakValue,
        coins: rewardCoins
      });

      return {
        success: true,
        coinsAwarded: rewardCoins,
        newStreak: nextStreakValue
      };
    });
  }

  private static checkIfStreakBroken(lastClaimDate: Date | null): boolean {
    if (!lastClaimDate) return false;
    const diffTime = Math.abs(Date.now() - lastClaimDate.getTime());
    const diffHours = diffTime / (1000 * 60 * 60);
    // If it's more than 48 hours, the streak is definitely broken
    return diffHours > 48;
  }
}
