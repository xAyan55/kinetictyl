import prisma from '../../db';
import { RewardType, AllocationType, AllocationSource, WalletTransactionType, Prisma } from '@prisma/client';
import { WalletService } from '../WalletService';
import { ResourceService } from '../ResourceService';
import { EventBus, EVENTS } from './EventBus';
import { AuditService } from '../AuditService';

export interface RewardDefinition {
  rewardType: RewardType;
  amount: number;
}

export class EconomyService {
  /**
   * Distributes rewards to the user.
   * All mutations occur inside a single transaction and strictly delegate to services.
   */
  static async awardRewards(params: {
    userId: number;
    rewards: RewardDefinition[];
    source: string;
    referenceId?: string | null;
    ipAddress?: string | null;
    browser?: string | null;
    userAgent?: string | null;
    country?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { userId, rewards, source, referenceId, ipAddress, browser, userAgent, country, tx: externalTx } = params;

    const execute = async (tx: Prisma.TransactionClient) => {
      // 1. Process each reward
      for (const reward of rewards) {
        if (reward.amount <= 0) continue;

        switch (reward.rewardType) {
          case RewardType.COINS:
            await WalletService.credit({
              userId,
              amount: reward.amount,
              type: WalletTransactionType.REWARD,
              reason: source,
              referenceId,
              tx
            });
            break;

          case RewardType.RAM:
            await ResourceService.addAllocation({
              userId,
              type: AllocationType.RAM,
              amount: reward.amount,
              source: AllocationSource.COUPON, // Reward maps closest to promo/coupon allocation
              referenceId,
              tx
            });
            break;

          case RewardType.CPU:
            await ResourceService.addAllocation({
              userId,
              type: AllocationType.CPU,
              amount: reward.amount,
              source: AllocationSource.COUPON,
              referenceId,
              tx
            });
            break;

          case RewardType.DISK:
            await ResourceService.addAllocation({
              userId,
              type: AllocationType.DISK,
              amount: reward.amount,
              source: AllocationSource.COUPON,
              referenceId,
              tx
            });
            break;

          case RewardType.BACKUPS:
            await ResourceService.addAllocation({
              userId,
              type: AllocationType.BACKUP_SLOTS,
              amount: reward.amount,
              source: AllocationSource.COUPON,
              referenceId,
              tx
            });
            break;

          case RewardType.SERVER_SLOT:
            await ResourceService.addAllocation({
              userId,
              type: AllocationType.SERVER_SLOTS,
              amount: reward.amount,
              source: AllocationSource.COUPON,
              referenceId,
              tx
            });
            break;

          case RewardType.CUSTOM:
            // Custom reward logic or logs
            await AuditService.log({
              action: 'monetization.custom_reward',
              userId,
              details: { amount: reward.amount, source, referenceId } as any,
              referenceId,
              ipAddress,
              tx
            });
            break;
        }
      }

      // 2. Publish completion events via EventBus
      // EventBus is async, but we can await it if listeners handle database locks.
      // Since EventBus handles subscriber queues, we publish after transaction or inside.
      // We pass the details of transaction context as metadata.
      await EventBus.publish(
        EVENTS.COINS_AWARDED,
        { userId, rewards, source, referenceId },
        { ipAddress, browser, userAgent, country }
      );
    };

    if (externalTx) {
      await execute(externalTx);
    } else {
      await prisma.$transaction(async (tx) => {
        await execute(tx);
      });
    }
  }
}
