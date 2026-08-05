import { ActionType, AllocationType, AllocationSource, WalletTransactionType, Prisma } from '@prisma/client';
import { WalletService } from '../WalletService';
import { ResourceService } from '../ResourceService';

export interface RewardContext {
  userId: number;
  amount: number;
  source: string;
  referenceId?: string | null;
  adminId?: number | null;
  tx?: Prisma.TransactionClient;
}

export type RewardHandler = (ctx: RewardContext) => Promise<void>;

const registry = new Map<ActionType, RewardHandler>();

export function registerRewardHandler(actionType: ActionType, handler: RewardHandler) {
  registry.set(actionType, handler);
}

export function getRewardHandler(actionType: ActionType): RewardHandler | undefined {
  return registry.get(actionType);
}

// Register built-in handlers
registerRewardHandler(ActionType.ADD_COINS, async (ctx) => {
  await WalletService.credit({
    userId: ctx.userId,
    amount: ctx.amount,
    type: WalletTransactionType.PURCHASE,
    reason: ctx.source,
    referenceId: ctx.referenceId,
    adminId: ctx.adminId,
    tx: ctx.tx,
  });
});

registerRewardHandler(ActionType.ADD_RAM, async (ctx) => {
  await ResourceService.addAllocation({
    userId: ctx.userId,
    type: AllocationType.RAM,
    amount: ctx.amount,
    source: AllocationSource.PURCHASE,
    referenceId: ctx.referenceId,
    tx: ctx.tx,
  });
});

registerRewardHandler(ActionType.ADD_CPU, async (ctx) => {
  await ResourceService.addAllocation({
    userId: ctx.userId,
    type: AllocationType.CPU,
    amount: ctx.amount,
    source: AllocationSource.PURCHASE,
    referenceId: ctx.referenceId,
    tx: ctx.tx,
  });
});

registerRewardHandler(ActionType.ADD_DISK, async (ctx) => {
  await ResourceService.addAllocation({
    userId: ctx.userId,
    type: AllocationType.DISK,
    amount: ctx.amount,
    source: AllocationSource.PURCHASE,
    referenceId: ctx.referenceId,
    tx: ctx.tx,
  });
});

registerRewardHandler(ActionType.ADD_BACKUP_SLOTS, async (ctx) => {
  await ResourceService.addAllocation({
    userId: ctx.userId,
    type: AllocationType.BACKUP_SLOTS,
    amount: ctx.amount,
    source: AllocationSource.PURCHASE,
    referenceId: ctx.referenceId,
    tx: ctx.tx,
  });
});

registerRewardHandler(ActionType.ADD_SERVER_SLOTS, async (ctx) => {
  await ResourceService.addAllocation({
    userId: ctx.userId,
    type: AllocationType.SERVER_SLOTS,
    amount: ctx.amount,
    source: AllocationSource.PURCHASE,
    referenceId: ctx.referenceId,
    tx: ctx.tx,
  });
});

registerRewardHandler(ActionType.ADD_PORTS, async (ctx) => {
  await ResourceService.addAllocation({
    userId: ctx.userId,
    type: AllocationType.PORTS,
    amount: ctx.amount,
    source: AllocationSource.PURCHASE,
    referenceId: ctx.referenceId,
    tx: ctx.tx,
  });
});

registerRewardHandler(ActionType.ADD_DATABASES, async (ctx) => {
  await ResourceService.addAllocation({
    userId: ctx.userId,
    type: AllocationType.DATABASE_SLOTS,
    amount: ctx.amount,
    source: AllocationSource.PURCHASE,
    referenceId: ctx.referenceId,
    tx: ctx.tx,
  });
});
