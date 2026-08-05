import prisma from '../db';
import { Prisma } from '@prisma/client';

export interface AuditDetails {
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  days?: number;
  expiresAt?: Date | null;
  daysRemaining?: number;
  name?: string;
  memory?: number;
  cpu?: number;
  disk?: number;
}

export class AuditService {
  static async log(params: {
    action: string;
    userId?: number | null;
    adminId?: number | null;
    details?: AuditDetails | null;
    referenceId?: string | null;
    ipAddress?: string | null;
    tx?: Prisma.TransactionClient;
  }) {
    const db = params.tx || prisma;
    await db.auditLog.create({
      data: {
        userId: params.userId ?? null,
        adminId: params.adminId ?? null,
        action: params.action,
        details: params.details as Prisma.InputJsonValue ?? Prisma.DbNull,
        referenceId: params.referenceId ?? null,
        ipAddress: params.ipAddress ?? null,
      },
    });
  }

  static async getLogs(params: {
    action?: string;
    userId?: number;
    adminId?: number;
    page?: number;
    limit?: number;
  }) {
    const { action, userId, adminId, page = 1, limit = 50 } = params;
    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (adminId) where.adminId = adminId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as Prisma.AuditLogWhereInput,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where: where as Prisma.AuditLogWhereInput }),
    ]);

    return { logs, total, page, totalPages: Math.ceil(total / limit) };
  }
}
