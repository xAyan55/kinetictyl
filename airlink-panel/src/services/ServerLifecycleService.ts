import prisma from '../db';
import { Prisma, AllocationType, AllocationSource, WalletTransactionType } from '@prisma/client';
import { WalletService } from './WalletService';
import { ResourceService } from './ResourceService';
import { AuditService } from './AuditService';
import { NotificationService } from './NotificationService';
import { ConfigService } from './config/ConfigService';
import {
  ServerNotFoundError,
  ServerSuspendedError,
  ResourceLimitExceededError,
  InsufficientCoinsError,
  ConcurrentModificationError,
  PermissionDeniedError,
  InvalidResourceTargetError,
} from './errors';

export interface UpgradeResources {
  memory?: number;
  cpu?: number;
  disk?: number;
}

export class ServerLifecycleService {
  static async getServer(serverId: string, userId?: number) {
    const where: Prisma.ServerWhereUniqueInput = { UUID: serverId };
    const server = await prisma.server.findUnique({
      where,
      include: { node: true, owner: true, image: true },
    });
    if (!server) throw new ServerNotFoundError(serverId);
    if (userId && server.ownerId !== userId) {
      throw new PermissionDeniedError('server.owner');
    }
    return server;
  }

  static async upgrade(params: {
    userId: number;
    serverId: string;
    resources: UpgradeResources;
    ipAddress?: string | null;
  }) {
    const { userId, serverId, resources, ipAddress } = params;
    const { memory, cpu, disk } = resources;

    return prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({ where: { UUID: serverId } });
      if (!server) throw new ServerNotFoundError(serverId);
      if (server.ownerId !== userId) throw new PermissionDeniedError('server.owner');
      if (server.Suspended) throw new ServerSuspendedError(serverId);

      const storeConfig = await ConfigService.store();
      const limits = await ConfigService.limits();
      const newMemory = memory ?? server.Memory;
      const newCpu = cpu ?? server.Cpu;
      const newDisk = disk ?? server.Storage;

      if (newMemory < server.Memory || newCpu < server.Cpu || newDisk < server.Storage) {
        throw new InvalidResourceTargetError('Upgrade must not reduce resources. Use downgrade instead.');
      }
      if (newMemory > limits.maxRamUpgrade) throw new ResourceLimitExceededError('RAM', limits.maxRamUpgrade, newMemory);
      if (newCpu > limits.maxCpuUpgrade) throw new ResourceLimitExceededError('CPU', limits.maxCpuUpgrade, newCpu);
      if (newDisk > limits.maxDiskUpgrade) throw new ResourceLimitExceededError('Disk', limits.maxDiskUpgrade, newDisk);

      const memDiff = newMemory - server.Memory;
      const cpuDiff = newCpu - server.Cpu;
      const diskDiff = newDisk - server.Storage;

      if (memDiff > 0) {
        const available = await ResourceService.getAvailable(userId, AllocationType.RAM);
        if (memDiff > available) throw new ResourceLimitExceededError('RAM', available, memDiff);
      }
      if (cpuDiff > 0) {
        const available = await ResourceService.getAvailable(userId, AllocationType.CPU);
        if (cpuDiff > available) throw new ResourceLimitExceededError('CPU', available, cpuDiff);
      }
      if (diskDiff > 0) {
        const available = await ResourceService.getAvailable(userId, AllocationType.DISK);
        if (diskDiff > available) throw new ResourceLimitExceededError('Disk', available, diskDiff);
      }

      const coinCost = (memDiff * storeConfig.ramPricePerMb) + (cpuDiff * storeConfig.cpuPricePerPercent) + (diskDiff * storeConfig.diskPricePerMb);

      if (coinCost > 0) {
        await WalletService.debit({
          userId,
          amount: coinCost,
          type: WalletTransactionType.PURCHASE,
          reason: `Server upgrade: ${serverId}`,
          referenceId: serverId,
          tx,
        });
      }

      if (memDiff > 0) {
        await ResourceService.addAllocation({
          userId, type: AllocationType.RAM, amount: memDiff, source: AllocationSource.PURCHASE, referenceId: serverId, tx,
        });
      }
      if (cpuDiff > 0) {
        await ResourceService.addAllocation({
          userId, type: AllocationType.CPU, amount: cpuDiff, source: AllocationSource.PURCHASE, referenceId: serverId, tx,
        });
      }
      if (diskDiff > 0) {
        await ResourceService.addAllocation({
          userId, type: AllocationType.DISK, amount: diskDiff, source: AllocationSource.PURCHASE, referenceId: serverId, tx,
        });
      }

      const result = await tx.server.updateMany({
        where: { UUID: serverId, version: server.version },
        data: {
          Memory: newMemory,
          Cpu: newCpu,
          Storage: newDisk,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new ConcurrentModificationError('Server');
      }

      await AuditService.log({
        action: 'server.upgrade',
        userId,
        details: {
          before: { memory: server.Memory, cpu: server.Cpu, disk: server.Storage },
          after: { memory: newMemory, cpu: newCpu, disk: newDisk },
        },
        referenceId: serverId,
        ipAddress,
        tx,
      });

      await NotificationService.create({
        userId, type: 'server_upgrade',
        title: 'Server Upgraded',
        message: `Resources upgraded. Cost: ${coinCost} coins.`,
        referenceId: serverId,
        tx,
      });

      return { success: true, serverId, coinCost, memory: newMemory, cpu: newCpu, disk: newDisk };
    });
  }

  static async downgrade(params: {
    userId: number;
    serverId: string;
    resources: UpgradeResources;
    ipAddress?: string | null;
  }) {
    const { userId, serverId, resources, ipAddress } = params;
    const { memory, cpu, disk } = resources;

    return prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({ where: { UUID: serverId } });
      if (!server) throw new ServerNotFoundError(serverId);
      if (server.ownerId !== userId) throw new PermissionDeniedError('server.owner');
      if (server.Suspended) throw new ServerSuspendedError(serverId);

      const newMemory = memory ?? server.Memory;
      const newCpu = cpu ?? server.Cpu;
      const newDisk = disk ?? server.Storage;

      if (newMemory > server.Memory || newCpu > server.Cpu || newDisk > server.Storage) {
        throw new InvalidResourceTargetError('Downgrade must not increase resources. Use upgrade instead.');
      }
      if (newMemory < 64) throw new InvalidResourceTargetError('Minimum RAM is 64 MB');
      if (newCpu < 10) throw new InvalidResourceTargetError('Minimum CPU is 10%');
      if (newDisk < 512) throw new InvalidResourceTargetError('Minimum disk is 512 MB');

      const economy = await ConfigService.economy();
      const memDiff = server.Memory - newMemory;
      const cpuDiff = server.Cpu - newCpu;
      const diskDiff = server.Storage - newDisk;

      const storeConfig = await ConfigService.store();
      const refundAmount = Math.floor(
        ((memDiff * storeConfig.ramPricePerMb) + (cpuDiff * storeConfig.cpuPricePerPercent) + (diskDiff * storeConfig.diskPricePerMb))
        * (economy.downgradeRefundPercent / 100)
      );

      if (refundAmount > 0) {
        await WalletService.credit({
          userId,
          amount: refundAmount,
          type: WalletTransactionType.REFUND,
          reason: `Server downgrade refund: ${serverId}`,
          referenceId: serverId,
          tx,
        });
      }

      const result = await tx.server.updateMany({
        where: { UUID: serverId, version: server.version },
        data: {
          Memory: newMemory,
          Cpu: newCpu,
          Storage: newDisk,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new ConcurrentModificationError('Server');
      }

      await AuditService.log({
        action: 'server.downgrade',
        userId,
        details: {
          before: { memory: server.Memory, cpu: server.Cpu, disk: server.Storage },
          after: { memory: newMemory, cpu: newCpu, disk: newDisk },
        },
        referenceId: serverId,
        ipAddress,
        tx,
      });

      await NotificationService.create({
        userId, type: 'server_downgrade',
        title: 'Server Downgraded',
        message: `Resources reduced. Refund: ${refundAmount} coins.`,
        referenceId: serverId,
        tx,
      });

      return { success: true, serverId, refundAmount, memory: newMemory, cpu: newCpu, disk: newDisk };
    });
  }

  static async renew(params: {
    userId: number;
    serverId: string;
    days: number;
    ipAddress?: string | null;
  }) {
    const { userId, serverId, days, ipAddress } = params;

    const validDays = [7, 15, 30, 60, 90];
    if (!validDays.includes(days)) {
      throw new InvalidResourceTargetError(`Renewal period must be one of: ${validDays.join(', ')}`);
    }

    return prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({ where: { UUID: serverId } });
      if (!server) throw new ServerNotFoundError(serverId);
      if (server.ownerId !== userId) throw new PermissionDeniedError('server.owner');

      const renewals = await ConfigService.renewals();
      const costMap: Record<number, number> = {
        7: renewals.renew7DaysCost,
        15: renewals.renew15DaysCost,
        30: renewals.renew30DaysCost,
        60: renewals.renew60DaysCost,
        90: renewals.renew90DaysCost,
      };

      const coinCost = costMap[days];

      await WalletService.debit({
        userId,
        amount: coinCost,
        type: WalletTransactionType.RENEWAL,
        reason: `Server renewal: ${serverId} (${days} days)`,
        referenceId: serverId,
        tx,
      });

      const now = new Date();
      const currentExpiry = server.expiresAt && server.expiresAt > now ? server.expiresAt : now;
      const newExpiry = new Date(currentExpiry.getTime() + days * 86400000);

      await tx.server.update({
        where: { UUID: serverId },
        data: { expiresAt: newExpiry },
      });

      await AuditService.log({
        action: 'server.renew',
        userId,
        details: {
          before: { expiresAt: server.expiresAt },
          after: { expiresAt: newExpiry, days },
        },
        referenceId: serverId,
        ipAddress,
        tx,
      });

      await NotificationService.create({
        userId, type: 'server_renew',
        title: 'Server Renewed',
        message: `Renewed for ${days} days. Cost: ${coinCost} coins.`,
        referenceId: serverId,
        tx,
      });

      return { success: true, serverId, coinCost, expiresAt: newExpiry };
    });
  }

  static async suspend(params: {
    adminId: number;
    serverId: string;
    reason?: string;
    ipAddress?: string | null;
  }) {
    const { adminId, serverId, reason, ipAddress } = params;

    return prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({ where: { UUID: serverId } });
      if (!server) throw new ServerNotFoundError(serverId);

      await tx.server.update({
        where: { UUID: serverId },
        data: { Suspended: true },
      });

      await AuditService.log({
        action: 'server.suspend',
        userId: server.ownerId,
        adminId,
        details: { before: { Suspended: false }, after: { Suspended: true, reason } },
        referenceId: serverId,
        ipAddress,
        tx,
      });

      await NotificationService.create({
        userId: server.ownerId, type: 'server_suspended',
        title: 'Server Suspended',
        message: reason || 'Your server has been suspended.',
        referenceId: serverId,
        tx,
      });
    });
  }

  static async unsuspend(params: {
    adminId: number;
    serverId: string;
    ipAddress?: string | null;
  }) {
    const { adminId, serverId, ipAddress } = params;

    return prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({ where: { UUID: serverId } });
      if (!server) throw new ServerNotFoundError(serverId);

      await tx.server.update({
        where: { UUID: serverId },
        data: { Suspended: false },
      });

      await AuditService.log({
        action: 'server.unsuspend',
        userId: server.ownerId,
        adminId,
        details: { before: { Suspended: true }, after: { Suspended: false } },
        referenceId: serverId,
        ipAddress,
        tx,
      });

      await NotificationService.create({
        userId: server.ownerId, type: 'server_unsuspended',
        title: 'Server Unsuspended',
        message: 'Your server has been unsuspended.',
        referenceId: serverId,
        tx,
      });
    });
  }

  static async delete(params: {
    userId: number;
    serverId: string;
    ipAddress?: string | null;
  }) {
    const { userId, serverId, ipAddress } = params;

    return prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({ where: { UUID: serverId } });
      if (!server) throw new ServerNotFoundError(serverId);
      if (server.ownerId !== userId) throw new PermissionDeniedError('server.owner');

      await tx.server.delete({ where: { UUID: serverId } });

      await AuditService.log({
        action: 'server.delete',
        userId,
        details: { before: { name: server.name, memory: server.Memory, cpu: server.Cpu, disk: server.Storage }, after: null },
        referenceId: serverId,
        ipAddress,
        tx,
      });

      await NotificationService.create({
        userId, type: 'server_deleted',
        title: 'Server Deleted',
        message: `Server "${server.name}" has been deleted.`,
        referenceId: serverId,
        tx,
      });
    });
  }

  static async getExpiredServers() {
    const now = new Date();
    return prisma.server.findMany({
      where: {
        expiresAt: { lte: now },
        Suspended: false,
      },
    });
  }
}
