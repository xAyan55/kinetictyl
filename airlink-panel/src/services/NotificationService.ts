import prisma from '../db';
import type { Prisma } from '@prisma/client';

export interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
  read: boolean;
  createdAt: Date;
}

export class NotificationService {
  static async create(params: {
    userId: number;
    type: string;
    title: string;
    message: string;
    referenceId?: string | null;
    tx?: Prisma.TransactionClient;
  }) {
    const db = params.tx || prisma;
    return db.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        referenceId: params.referenceId ?? null,
      },
    });
  }

  static async getNotifications(userId: number, page = 1, limit = 50) {
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
    ]);
    return { notifications, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async markRead(id: number, userId: number) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  static async markAllRead(userId: number) {
    return prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  static async getUnreadCount(userId: number) {
    return prisma.notification.count({ where: { userId, read: false } });
  }
}