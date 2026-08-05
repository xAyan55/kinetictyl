import prisma from '../db';
import { AllocationType, AllocationSource, Prisma } from '@prisma/client';

export interface ResourceTotals {
  allocated: number;
  used: number;
  available: number;
}

export class ResourceService {
  static async getAllocated(userId: number, type: AllocationType): Promise<number> {
    const rows = await prisma.userAllocation.findMany({
      where: { userId, type },
    });
    return rows.reduce((sum, r) => sum + r.amount, 0);
  }

  static async getUsed(userId: number, type: AllocationType): Promise<number> {
    const fieldMap: Record<string, string> = {
      [AllocationType.RAM]: 'Memory',
      [AllocationType.CPU]: 'Cpu',
      [AllocationType.DISK]: 'Storage',
    };

    const field = fieldMap[type];
    if (!field) return 0;

    const servers = await prisma.server.findMany({
      where: { ownerId: userId, Suspended: false },
      select: { [field]: true },
    }) as unknown as Record<string, number>[];

    const total = servers.reduce((sum, s) => sum + (s[field] || 0), 0);
    return total;
  }

  static async getAvailable(userId: number, type: AllocationType): Promise<number> {
    const allocated = await this.getAllocated(userId, type);
    const used = await this.getUsed(userId, type);
    return Math.max(0, allocated - used);
  }

  static async getUserResources(userId: number): Promise<Record<string, ResourceTotals>> {
    const types = [AllocationType.RAM, AllocationType.CPU, AllocationType.DISK];
    const results: Record<string, ResourceTotals> = {};

    for (const type of types) {
      const allocated = await this.getAllocated(userId, type);
      const used = await this.getUsed(userId, type);
      results[type.toLowerCase()] = {
        allocated,
        used,
        available: Math.max(0, allocated - used),
      };
    }

    return results;
  }

  static async addAllocation(params: {
    userId: number;
    type: AllocationType;
    amount: number;
    source: AllocationSource;
    referenceId?: string | null;
    tx?: Prisma.TransactionClient;
  }) {
    const db = params.tx || prisma;
    return db.userAllocation.create({
      data: {
        userId: params.userId,
        type: params.type,
        amount: params.amount,
        source: params.source,
        referenceId: params.referenceId ?? null,
      },
    });
  }

  static async validateAllocation(
    userId: number,
    type: AllocationType,
    requested: number,
  ): Promise<boolean> {
    const available = await this.getAvailable(userId, type);
    return requested <= available;
  }

  static async getServerResourceUsage(serverId: string) {
    const server = await prisma.server.findUnique({
      where: { UUID: serverId },
      select: { Memory: true, Cpu: true, Storage: true },
    });
    return server
      ? { memory: server.Memory, cpu: server.Cpu, disk: server.Storage }
      : null;
  }
}
