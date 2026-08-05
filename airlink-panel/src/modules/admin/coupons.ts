import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import { AuditService } from '../../services/AuditService';
import { ActionType } from '@prisma/client';

const VALID_ACTION_TYPES = new Set(Object.values(ActionType).filter(
  (t) => !['SERVER_UPGRADE', 'SERVER_RENEW'].includes(t),
));

function paramStr(val: string | string[]): string { return Array.isArray(val) ? val[0] : val; }

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const adminModule: Module = {
  info: {
    name: 'Admin Coupons Module',
    description: 'Coupon management for the admin panel.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    // ── GET /admin/coupons ──────────────────────────────────────────────────
    router.get(
      '/admin/coupons',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          const page = parseInt(req.query.page as string, 10) || 1;
          const search = (req.query.search as string) || '';

          const where: Record<string, unknown> = {};
          if (search) {
            where.code = { contains: search };
          }

          const [coupons, total] = await Promise.all([
            prisma.coupon.findMany({
              where: where as any,
              orderBy: { createdAt: 'desc' },
              skip: (page - 1) * 20,
              take: 20,
            }),
            prisma.coupon.count({ where: where as any }),
          ]);

          const totalPages = Math.ceil(total / 20);

          res.render('admin/coupons/coupons', {
            user,
            req,
            settings,
            coupons,
            totalPages,
            page,
            total,
            search,
          });
        } catch (error) {
          logger.error('Error loading coupons:', error);
          return res.redirect('/login');
        }
      },
    );

    // ── GET /admin/coupons/create ───────────────────────────────────────────
    router.get(
      '/admin/coupons/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          const suggestedCode = generateCode();

          res.render('admin/coupons/create', {
            user,
            req,
            settings,
            suggestedCode,
          });
        } catch (error) {
          logger.error('Error loading coupon create page:', error);
          return res.redirect('/admin/coupons');
        }
      },
    );

    // ── POST /admin/coupons/create ──────────────────────────────────────────
    router.post(
      '/admin/coupons/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const { code, description, actionType, actionValue, maxUses, perUserLimit, startsAt, expiresAt, enabled } = req.body;

          if (!code || typeof code !== 'string' || code.trim().length < 3) {
            return res.status(400).json({ success: false, error: 'Code must be at least 3 characters.' });
          }

          if (!actionType || !VALID_ACTION_TYPES.has(actionType)) {
            return res.status(400).json({ success: false, error: 'Invalid action type.' });
          }

          const parsedValue = parseInt(actionValue, 10);
          if (isNaN(parsedValue) || parsedValue <= 0) {
            return res.status(400).json({ success: false, error: 'Action value must be a positive number.' });
          }

          const existingCoupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
          if (existingCoupon) {
            return res.status(400).json({ success: false, error: 'A coupon with this code already exists.' });
          }

          const coupon = await prisma.coupon.create({
            data: {
              code: code.trim().toUpperCase(),
              description: description || null,
              actionType: actionType as ActionType,
              actionValue: parsedValue,
              maxUses: parseInt(maxUses as string, 10) || 0,
              perUserLimit: parseInt(perUserLimit as string, 10) || 1,
              startsAt: startsAt ? new Date(startsAt) : null,
              expiresAt: expiresAt ? new Date(expiresAt) : null,
              enabled: enabled !== false && enabled !== 'false',
            },
          });

          await AuditService.log({
            action: 'COUPON_CREATED',
            adminId: user.id,
            details: { code: coupon.code, reward: `${coupon.actionType} x${coupon.actionValue}` } as any,
            referenceId: coupon.code,
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, coupon });
        } catch (error) {
          logger.error('Error creating coupon:', error);
          res.status(500).json({ success: false, error: 'Failed to create coupon.' });
        }
      },
    );

    // ── GET /admin/coupons/:id/edit ─────────────────────────────────────────
    router.get(
      '/admin/coupons/:id/edit',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          const couponId = parseInt(String(req.params.id), 10);
          const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
          if (!coupon) return res.redirect('/admin/coupons');

          res.render('admin/coupons/edit', {
            user,
            req,
            settings,
            coupon,
          });
        } catch (error) {
          logger.error('Error loading coupon edit page:', error);
          return res.redirect('/admin/coupons');
        }
      },
    );

    // ── POST /admin/coupons/:id/edit ────────────────────────────────────────
    router.post(
      '/admin/coupons/:id/edit',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponId = parseInt(paramStr(req.params.id), 10);
          const existing = await prisma.coupon.findUnique({ where: { id: couponId } });
          if (!existing) return res.status(404).json({ success: false, error: 'Coupon not found.' });

          const { code, description, actionType, actionValue, maxUses, perUserLimit, startsAt, expiresAt, enabled } = req.body;

          const couponIdParsed = couponId;

          if (code && typeof code === 'string') {
            const trimmed = code.trim().toUpperCase();
            if (trimmed.length < 3) {
              return res.status(400).json({ success: false, error: 'Code must be at least 3 characters.' });
            }
            if (trimmed !== existing.code) {
              const dup = await prisma.coupon.findUnique({ where: { code: trimmed } });
              if (dup) return res.status(400).json({ success: false, error: 'A coupon with this code already exists.' });
            }
          }

          if (actionType && !VALID_ACTION_TYPES.has(actionType)) {
            return res.status(400).json({ success: false, error: 'Invalid action type.' });
          }

          const updateData: Record<string, unknown> = {};
          if (code) updateData.code = code.trim().toUpperCase();
          if (description !== undefined) updateData.description = description || null;
          if (actionType) updateData.actionType = actionType;
          if (actionValue !== undefined) updateData.actionValue = parseInt(actionValue as string, 10);
          if (maxUses !== undefined) updateData.maxUses = parseInt(maxUses as string, 10) || 0;
          if (perUserLimit !== undefined) updateData.perUserLimit = parseInt(perUserLimit as string, 10) || 1;
          if (startsAt !== undefined) updateData.startsAt = startsAt ? new Date(startsAt as string) : null;
          if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt as string) : null;
          if (enabled !== undefined) updateData.enabled = enabled === true || enabled === 'true';

          const updated = await prisma.coupon.update({
            where: { id: couponId },
            data: updateData,
          });

          await AuditService.log({
            action: 'COUPON_UPDATED',
            adminId: user.id,
            details: { code: updated.code, changes: Object.keys(updateData) } as any,
            referenceId: updated.code,
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, coupon: updated });
        } catch (error) {
          logger.error('Error updating coupon:', error);
          res.status(500).json({ success: false, error: 'Failed to update coupon.' });
        }
      },
    );

    // ── POST /admin/coupons/:id/delete ──────────────────────────────────────
    router.post(
      '/admin/coupons/:id/delete',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponIdDel = parseInt(paramStr(req.params.id), 10);
          const coupon = await prisma.coupon.findUnique({ where: { id: couponIdDel } });
          if (!coupon) return res.status(404).json({ success: false, error: 'Coupon not found.' });

          await prisma.coupon.delete({ where: { id: couponIdDel } });

          await AuditService.log({
            action: 'COUPON_DELETED',
            adminId: user.id,
            details: { code: coupon.code } as any,
            referenceId: coupon.code,
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true });
        } catch (error) {
          logger.error('Error deleting coupon:', error);
          res.status(500).json({ success: false, error: 'Failed to delete coupon.' });
        }
      },
    );

    // ── POST /admin/coupons/:id/toggle ──────────────────────────────────────
    router.post(
      '/admin/coupons/:id/toggle',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponIdTog = parseInt(paramStr(req.params.id), 10);
          const coupon = await prisma.coupon.findUnique({ where: { id: couponIdTog } });
          if (!coupon) return res.status(404).json({ success: false, error: 'Coupon not found.' });

          const updated = await prisma.coupon.update({
            where: { id: couponIdTog },
            data: { enabled: !coupon.enabled },
          });

          await AuditService.log({
            action: 'COUPON_TOGGLED',
            adminId: user.id,
            details: { code: updated.code, enabled: updated.enabled } as any,
            referenceId: updated.code,
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, enabled: updated.enabled });
        } catch (error) {
          logger.error('Error toggling coupon:', error);
          res.status(500).json({ success: false, error: 'Failed to toggle coupon.' });
        }
      },
    );

    // ── POST /admin/coupons/:id/duplicate ───────────────────────────────────
    router.post(
      '/admin/coupons/:id/duplicate',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponIdDup = parseInt(paramStr(req.params.id), 10);
          const original = await prisma.coupon.findUnique({ where: { id: couponIdDup } });
          if (!original) return res.status(404).json({ success: false, error: 'Coupon not found.' });

          let newCode = original.code + '_COPY';
          let attempt = 1;
          while (await prisma.coupon.findUnique({ where: { code: newCode } })) {
            attempt++;
            newCode = original.code + '_COPY' + attempt;
          }

          const duplicate = await prisma.coupon.create({
            data: {
              code: newCode,
              description: original.description,
              actionType: original.actionType,
              actionValue: original.actionValue,
              maxUses: original.maxUses,
              perUserLimit: original.perUserLimit,
              startsAt: original.startsAt,
              expiresAt: original.expiresAt,
              enabled: false,
            },
          });

          await AuditService.log({
            action: 'COUPON_DUPLICATED',
            adminId: user.id,
            details: { originalCode: original.code, newCode: duplicate.code } as any,
            referenceId: duplicate.code,
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, coupon: duplicate });
        } catch (error) {
          logger.error('Error duplicating coupon:', error);
          res.status(500).json({ success: false, error: 'Failed to duplicate coupon.' });
        }
      },
    );

    return router;
  },
};

export default adminModule;
