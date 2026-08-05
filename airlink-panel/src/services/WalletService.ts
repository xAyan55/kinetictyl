import prisma from '../db';
import { Prisma, WalletTransactionType } from '@prisma/client';
import { InsufficientCoinsError, ConcurrentModificationError, WalletNotFoundError } from './errors';
import { AuditService } from './AuditService';

export interface WalletBalance {
  balance: number;
  version: number;
}

export class WalletService {
  static async getOrCreate(userId: number, tx?: Prisma.TransactionClient): Promise<WalletBalance> {
    const db = tx || prisma;
    let wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await db.wallet.create({
        data: { userId, balance: 0 },
      });
    }
    return { balance: wallet.balance, version: wallet.version };
  }

  static async getBalance(userId: number): Promise<number> {
    const { balance } = await this.getOrCreate(userId);
    return balance;
  }

  static async credit(params: {
    userId: number;
    amount: number;
    type: WalletTransactionType;
    reason: string;
    referenceId?: string | null;
    adminId?: number | null;
    tx?: Prisma.TransactionClient;
  }) {
    const { userId, amount, type, reason, referenceId, adminId, tx: externalTx } = params;
    if (amount <= 0) throw new Error('Credit amount must be positive');

    const execute = async (tx: Prisma.TransactionClient) => {
      const { balance, version } = await this.getOrCreate(userId, tx);

      const result = await tx.wallet.updateMany({
        where: { userId, version },
        data: {
          balance: { increment: amount },
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new ConcurrentModificationError('Wallet');
      }

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: (await tx.wallet.findUnique({ where: { userId } }))!.id,
          amount,
          type,
          reason,
          referenceId: referenceId ?? null,
          adminId: adminId ?? null,
        },
      });

      await AuditService.log({
        action: 'wallet.credit',
        userId,
        adminId,
        details: { before: { balance }, after: { balance: balance + amount } },
        referenceId,
        tx,
      });

      return transaction;
    };

    if (externalTx) return execute(externalTx);
    return prisma.$transaction(execute);
  }

  static async debit(params: {
    userId: number;
    amount: number;
    type: WalletTransactionType;
    reason: string;
    referenceId?: string | null;
    tx?: Prisma.TransactionClient;
  }) {
    const { userId, amount, type, reason, referenceId, tx: externalTx } = params;
    if (amount <= 0) throw new Error('Debit amount must be positive');

    const execute = async (tx: Prisma.TransactionClient) => {
      const { balance, version } = await this.getOrCreate(userId, tx);

      if (balance < amount) {
        throw new InsufficientCoinsError(balance, amount);
      }

      const result = await tx.wallet.updateMany({
        where: { userId, version },
        data: {
          balance: { increment: -amount },
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new ConcurrentModificationError('Wallet');
      }

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: (await tx.wallet.findUnique({ where: { userId } }))!.id,
          amount: -amount,
          type,
          reason,
          referenceId: referenceId ?? null,
        },
      });

      await AuditService.log({
        action: 'wallet.debit',
        userId,
        details: { before: { balance }, after: { balance: balance - amount } },
        referenceId,
        tx,
      });

      return transaction;
    };

    if (externalTx) return execute(externalTx);
    return prisma.$transaction(execute);
  }

  static async getHistory(userId: number, page = 1, limit = 50) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return { transactions: [], total: 0, page, totalPages: 0 };

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    return { transactions, total, page, totalPages: Math.ceil(total / limit) };
  }
}
