import prisma from '../db';
import { ActionType, Prisma } from '@prisma/client';
import { getRewardHandler, RewardContext } from './rewards/registry';
import { AuditService } from './AuditService';

export interface RewardAction {
  actionType: ActionType;
  amount: number;
}

export class RewardPipeline {
  static async execute(params: {
    userId: number;
    rewards: RewardAction[];
    source: string;
    referenceId?: string | null;
    adminId?: number | null;
    ipAddress?: string | null;
  }) {
    const { userId, rewards, source, referenceId, adminId, ipAddress } = params;

    await prisma.$transaction(async (tx) => {
      for (const reward of rewards) {
        const handler = getRewardHandler(reward.actionType);
        if (!handler) {
          throw new Error(`No handler registered for action type: ${reward.actionType}`);
        }

        const ctx: RewardContext = {
          userId,
          amount: reward.amount,
          source,
          referenceId,
          adminId,
          tx,
        };

        await handler(ctx);
      }

      await AuditService.log({
        action: 'reward_pipeline.execute',
        userId,
        adminId,
        details: {
          before: null,
          after: {
            rewards: rewards.map((r) => ({ actionType: r.actionType, amount: r.amount })),
            source,
          },
        },
        referenceId,
        ipAddress,
        tx,
      });
    });
  }
}
