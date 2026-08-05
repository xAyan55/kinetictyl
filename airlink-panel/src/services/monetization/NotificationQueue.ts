import { NotificationService } from '../NotificationService';
import { EventBus, EVENTS, EventPayload } from './EventBus';
import logger from '../../handlers/logger';
import prisma from '../../db';

export class NotificationQueue {
  static initialize(): void {
    // 1. Subscribe to coins awarded events
    EventBus.subscribe(EVENTS.COINS_AWARDED, {
      priority: 10,
      handle: async (event: EventPayload) => {
        const { userId, rewards, source } = event.data;
        
        // Check user notification preferences first
        const prefs = await prisma.userEarnPreferences.findUnique({ where: { userId } });
        if (prefs && !prefs.rewardNotifications) {
          return;
        }

        const coinReward = rewards.find((r: any) => r.rewardType === 'COINS');
        if (coinReward) {
          await NotificationService.create({
            userId,
            type: 'monetization_reward',
            title: 'Reward Credited!',
            message: `You earned ${coinReward.amount} coins from completing: ${source}.`
          });
        }
      }
    });

    // 2. Subscribe to offer completed
    EventBus.subscribe(EVENTS.OFFER_COMPLETED, {
      priority: 10,
      handle: async (event: EventPayload) => {
        const { userId, offerName } = event.data;
        
        const prefs = await prisma.userEarnPreferences.findUnique({ where: { userId } });
        if (prefs && !prefs.offerNotifications) {
          return;
        }

        await NotificationService.create({
          userId,
          type: 'offer_completion',
          title: 'Offer Completed',
          message: `Congratulations! You successfully completed the offer "${offerName}".`
        });
      }
    });

    // 3. Subscribe to streak claimed
    EventBus.subscribe(EVENTS.STREAK_CLAIMED, {
      priority: 10,
      handle: async (event: EventPayload) => {
        const { userId, streakDays, coins } = event.data;

        const prefs = await prisma.userEarnPreferences.findUnique({ where: { userId } });
        if (prefs && !prefs.streakNotifications) {
          return;
        }

        await NotificationService.create({
          userId,
          type: 'streak_claim',
          title: 'Streak Claimed!',
          message: `Claimed streak day ${streakDays}! Added ${coins} coins to your wallet.`
        });
      }
    });

    // 4. Subscribe to fraud detection triggers
    EventBus.subscribe(EVENTS.FRAUD_DETECTION_TRIGGERED, {
      priority: 100, // High priority to alert immediately
      handle: async (event: EventPayload) => {
        const { userId, type, severity } = event.data;
        logger.warn(`[NotificationQueue] Fraud trigger logged for user ID ${userId}. Type: ${type}, Severity: ${severity}`);
        
        // Notify admin panel or specific user limits
        await NotificationService.create({
          userId,
          type: 'fraud_alert',
          title: 'Security Notice',
          message: 'Suspicious activity has been flagged on your monetization account. Verification required.'
        });
      }
    });

    logger.info('NotificationQueue initialized and listening to EventBus.');
  }

  static async sendExternalNotification(channel: 'email' | 'discord' | 'webhook', payload: any): Promise<void> {
    // Placeholder hooks for production scaling
    logger.info(`[NotificationQueue] Simulating external dispatch via ${channel}:`, payload);
  }
}
