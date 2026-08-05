import prisma from '../db';
import { RewardPipeline } from './RewardPipeline';
import { AuditService } from './AuditService';
import { NotificationService } from './NotificationService';
import {
  CouponNotFoundError,
  CouponExpiredError,
  CouponNotYetActiveError,
  CouponDisabledError,
  CouponFullyRedeemedError,
  CouponPerUserLimitReachedError,
} from './errors';

export class CouponService {
  static async validate(code: string, userId: number) {
    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon) throw new CouponNotFoundError(code);
    if (!coupon.enabled) throw new CouponDisabledError(code);

    const now = new Date();

    if (coupon.startsAt && now < coupon.startsAt) {
      throw new CouponNotYetActiveError(code);
    }

    if (coupon.expiresAt && now > coupon.expiresAt) {
      throw new CouponExpiredError(code);
    }

    if (coupon.maxUses > 0) {
      const redemptionCount = await prisma.couponRedemption.count({
        where: { couponId: coupon.id },
      });
      if (redemptionCount >= coupon.maxUses) {
        throw new CouponFullyRedeemedError(code);
      }
    }

    if (coupon.perUserLimit > 0) {
      const userRedemptionCount = await prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId },
      });
      if (userRedemptionCount >= coupon.perUserLimit) {
        throw new CouponPerUserLimitReachedError(code);
      }
    }

    return coupon;
  }

  static async redeem(params: {
    code: string;
    userId: number;
    ipAddress?: string | null;
  }) {
    const { code, userId, ipAddress } = params;

    const coupon = await this.validate(code, userId);

    await prisma.$transaction(async (tx) => {
      await RewardPipeline.execute({
        userId,
        rewards: [{ actionType: coupon.actionType, amount: coupon.actionValue }],
        source: 'coupon',
        referenceId: code,
        ipAddress,
      });

      await tx.couponRedemption.create({
        data: { couponId: coupon.id, userId },
      });

      await NotificationService.create({
        userId, type: 'coupon_redeemed',
        title: 'Coupon Redeemed',
        message: `Coupon "${code}" redeemed for ${coupon.actionValue} ${coupon.actionType}.`,
        referenceId: code,
        tx,
      });
    });

    return { success: true, code, rewardType: coupon.actionType, rewardAmount: coupon.actionValue };
  }

  static async getCoupons(params?: {
    page?: number;
    limit?: number;
    includeDisabled?: boolean;
  }) {
    const { page = 1, limit = 50, includeDisabled } = params || {};
    const where: Record<string, unknown> = {};
    if (!includeDisabled) where.enabled = true;

    const [coupons, total] = await Promise.all([
      prisma.coupon.findMany({
        where: where as Record<string, unknown>,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.coupon.count({ where: where as Record<string, unknown> }),
    ]);

    return { coupons, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async getRedemptionHistory(couponId: number, page = 1, limit = 50) {
    const [redemptions, total] = await Promise.all([
      prisma.couponRedemption.findMany({
        where: { couponId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.couponRedemption.count({ where: { couponId } }),
    ]);

    return { redemptions, total, page, totalPages: Math.ceil(total / limit) };
  }
}
