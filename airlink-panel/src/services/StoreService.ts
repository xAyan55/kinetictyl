import prisma from '../db';
import { Prisma, WalletTransactionType } from '@prisma/client';
import { WalletService } from './WalletService';
import { RewardPipeline } from './RewardPipeline';
import { AuditService } from './AuditService';
import { NotificationService } from './NotificationService';
import {
  StoreProductNotFoundError,
  ProductDisabledError,
  ProductLimitReachedError,
  InsufficientCoinsError,
} from './errors';

export class StoreService {
  static async getProducts(params?: {
    category?: string;
    includeHidden?: boolean;
  }) {
    const where: Prisma.StoreProductWhereInput = { enabled: true };
    if (!params?.includeHidden) where.hidden = false;

    return prisma.storeProduct.findMany({
      where,
      orderBy: { displayOrder: 'asc' },
    });
  }

  static async getProduct(productId: number) {
    const product = await prisma.storeProduct.findUnique({ where: { id: productId } });
    if (!product) throw new StoreProductNotFoundError(productId);
    if (!product.enabled) throw new ProductDisabledError(productId);
    return product;
  }

  static async purchase(params: {
    userId: number;
    productId: number;
    serverId?: string | null;
    ipAddress?: string | null;
  }) {
    const { userId, productId, serverId, ipAddress } = params;

    const product = await this.getProduct(productId);

    if (product.maxPurchasePerUser) {
      const count = await prisma.storePurchase.count({
        where: { userId, productId },
      });
      if (count >= product.maxPurchasePerUser) {
        throw new ProductLimitReachedError(productId);
      }
    }

    await prisma.$transaction(async (tx) => {
      await WalletService.debit({
        userId,
        amount: product.price,
        type: WalletTransactionType.STORE_PURCHASE,
        reason: `Purchase: ${product.name}`,
        referenceId: `product-${productId}`,
        tx,
      });

      await RewardPipeline.execute({
        userId,
        rewards: [{ actionType: product.actionType, amount: product.actionValue }],
        source: 'store_purchase',
        referenceId: `product-${productId}`,
        ipAddress,
      });

      await tx.storePurchase.create({
        data: {
          userId,
          productId,
          serverId: serverId ?? null,
          actionType: product.actionType,
          actionValue: product.actionValue,
          coinCost: product.price,
        },
      });

      await NotificationService.create({
        userId, type: 'store_purchase',
        title: 'Purchase Complete',
        message: `Purchased ${product.name} for ${product.price} coins.`,
        referenceId: `product-${productId}`,
        tx,
      });
    });

    return { success: true, product: product.name, coinCost: product.price };
  }

  static async getPurchaseHistory(userId: number, page = 1, limit = 50) {
    const [purchases, total] = await Promise.all([
      prisma.storePurchase.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { product: true },
      }),
      prisma.storePurchase.count({ where: { userId } }),
    ]);

    return { purchases, total, page, totalPages: Math.ceil(total / limit) };
  }
}
