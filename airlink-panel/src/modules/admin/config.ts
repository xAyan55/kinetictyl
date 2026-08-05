import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import { ConfigService } from '../../services/config/ConfigService';
import { ConfigCategory, ActionType, Prisma } from '@prisma/client';
import { AuditService } from '../../services/AuditService';

const VALID_CATEGORIES = new Set(Object.values(ConfigCategory));
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
    name: 'Admin Config Module',
    description: 'Configuration and coupon management for the admin panel.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    async function resolveUser(req: Request) {
      const userId = req.session?.user?.id;
      if (!userId) return null;
      return prisma.users.findUnique({ where: { id: userId } });
    }

    // -- GET /admin/config ---------------------------------------------------
    router.get(
      '/admin/config',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          const page = parseInt(paramStr(req.query.page as string), 10) || 1;
          const search = (req.query.search as string) || '';
          const actionFilter = (req.query.action as string) || '';
          const dateFrom = (req.query.dateFrom as string) || '';
          const dateTo = (req.query.dateTo as string) || '';
          const adminFilter = (req.query.adminId as string) || '';

          const [economy, store, defaultsConfig, renewals, limits, ui, notifications, allProducts, allCoupons, serverCount, walletAgg] =
            await Promise.all([
              ConfigService.economy(),
              ConfigService.store(),
              ConfigService.defaults(),
              ConfigService.renewals(),
              ConfigService.limits(),
              ConfigService.ui(),
              ConfigService.notifications(),
              prisma.storeProduct.findMany({ orderBy: { displayOrder: 'asc' } }),
              prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
              prisma.server.count(),
              prisma.wallet.aggregate({ _sum: { balance: true } }),
            ]);

          const totalCoins = walletAgg._sum.balance ?? 0;

          const logWhere: Prisma.AuditLogWhereInput = {};
          if (actionFilter) logWhere.action = actionFilter;
          if (adminFilter && parseInt(adminFilter, 10)) logWhere.adminId = parseInt(adminFilter, 10);
          if (dateFrom || dateTo) {
            (logWhere as Record<string, unknown>).createdAt = {};
            if (dateFrom) (logWhere.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
            if (dateTo) (logWhere.createdAt as Record<string, unknown>).lte = new Date(dateTo + 'T23:59:59.999Z');
          }
          if (search) {
            logWhere.OR = [
              { action: { contains: search } },
              { referenceId: { contains: search } },
              { ipAddress: { contains: search } },
            ] as Prisma.AuditLogWhereInput[];
          }

          const [logs, logsTotal] = await Promise.all([
            prisma.auditLog.findMany({
              where: logWhere,
              orderBy: { createdAt: 'desc' },
              skip: (page - 1) * 50,
              take: 50,
            }),
            prisma.auditLog.count({ where: logWhere }),
          ]);

          const distinctActions = await prisma.auditLog.groupBy({ by: ['action'], _count: { action: true } });
          const adminIdGroups = await prisma.auditLog.groupBy({ by: ['adminId'], _count: { adminId: true } });
          const adminUsers = adminIdGroups.length > 0
            ? await prisma.users.findMany({
                where: { id: { in: adminIdGroups.map(a => a.adminId).filter(Boolean) as number[] } },
                select: { id: true, username: true },
              })
            : [];

          const productPage = parseInt(paramStr(req.query.productPage as string), 10) || 1;
          const productSearch = (req.query.productSearch as string) || '';
          const productFilter = (req.query.productFilter as string) || '';

          const productWhere: Prisma.StoreProductWhereInput = {};
          if (productSearch) productWhere.name = { contains: productSearch };
          if (productFilter === 'enabled') productWhere.enabled = true;
          if (productFilter === 'disabled') productWhere.enabled = false;
          if (productFilter === 'featured') productWhere.featured = true;
          if (productFilter === 'hidden') productWhere.hidden = true;

          const [filteredProducts, productTotal] = await Promise.all([
            prisma.storeProduct.findMany({
              where: productWhere,
              orderBy: { displayOrder: 'asc' },
              skip: (productPage - 1) * 20,
              take: 20,
            }),
            prisma.storeProduct.count({ where: productWhere }),
          ]);

          const couponPage = parseInt(paramStr(req.query.couponPage as string), 10) || 1;
          const couponSearch = (req.query.couponSearch as string) || '';

          const couponWhere: Prisma.CouponWhereInput = {};
          if (couponSearch) couponWhere.code = { contains: couponSearch };

          const [couponsPaged, couponTotal] = await Promise.all([
            prisma.coupon.findMany({
              where: couponWhere,
              orderBy: { createdAt: 'desc' },
              skip: (couponPage - 1) * 20,
              take: 20,
            }),
            prisma.coupon.count({ where: couponWhere }),
          ]);

          const transactionCount = await prisma.storePurchase.count();

          const qs = (k: string, v: string) => v ? `&${k}=${encodeURIComponent(v)}` : '';
          const logExportUrl = `/admin/config/logs/export?${qs('search', search)}${qs('action', actionFilter)}${qs('adminId', adminFilter)}${qs('dateFrom', dateFrom)}${qs('dateTo', dateTo)}`;

          res.render('admin/config/config', {
            user, req, settings,
            economy, store, defaults: defaultsConfig, renewals, limits, ui, notifications,
            products: filteredProducts,
            productTotalPages: Math.ceil(productTotal / 20),
            productPage, productSearch, productFilter,
            coupons: couponsPaged,
            couponTotalPages: Math.ceil(couponTotal / 20),
            couponPage, couponSearch, couponTotal,
            distinctActions: distinctActions.map(a => a.action),
            adminUsers,
            auditLogs: { logs, total: logsTotal, page, totalPages: Math.ceil(logsTotal / 50) },
            serverCount, totalCoins,
            transactions: transactionCount,
            logSearch: search, logAction: actionFilter, logAdminId: adminFilter,
            logDateFrom: dateFrom, logDateTo: dateTo,
            logExportUrl,
          });
        } catch (error) {
          logger.error('Error loading admin config:', error);
          return res.redirect('/login');
        }
      },
    );
    // -- POST /admin/config/:category ----------------------------------------
    router.post(
      '/admin/config/:category',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const category = String(req.params.category || '').toUpperCase();
          if (!VALID_CATEGORIES.has(category as ConfigCategory)) {
            return res.status(400).json({ success: false, error: 'Invalid config category.' });
          }

          const sanitized: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(req.body)) {
            if (value === 'true') sanitized[key] = true;
            else if (value === 'false') sanitized[key] = false;
            else if (value === '' || value === null || value === undefined) continue;
            else if (!isNaN(Number(value))) sanitized[key] = Number(value);
            else sanitized[key] = value;
          }

          await ConfigService.updateCategory(category as ConfigCategory, sanitized);

          await AuditService.log({
            action: 'CONFIG_UPDATED',
            adminId: user.id,
            details: { category, keys: Object.keys(sanitized).join(', ') } as any,
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true });
        } catch (error) {
          logger.error('Error saving config:', error);
          res.status(500).json({ success: false, error: 'Failed to save configuration.' });
        }
      },
    );

    // -- POST /admin/config/products/create ----------------------------------
    router.post(
      '/admin/config/products/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const { name, description, actionType, actionValue, price, icon, displayOrder, featured, enabled, maxPurchasePerUser, hidden } = req.body;

          if (!name || typeof name !== 'string' || name.trim().length < 1) {
            return res.status(400).json({ success: false, error: 'Product name is required.' });
          }
          if (!actionType || !VALID_ACTION_TYPES.has(actionType)) {
            return res.status(400).json({ success: false, error: 'Invalid action type.' });
          }
          const val = parseInt(actionValue, 10);
          if (isNaN(val) || val <= 0) return res.status(400).json({ success: false, error: 'Action value must be positive.' });
          const priceVal = parseInt(price, 10);
          if (isNaN(priceVal) || priceVal < 0) return res.status(400).json({ success: false, error: 'Price must be non-negative.' });

          const product = await prisma.storeProduct.create({
            data: {
              name: name.trim(),
              description: description || null,
              actionType: actionType as ActionType,
              actionValue: val,
              price: priceVal,
              icon: icon || null,
              displayOrder: parseInt(displayOrder as string, 10) || 0,
              featured: featured === true || featured === 'true',
              hidden: hidden === true || hidden === 'true',
              enabled: enabled !== false && enabled !== 'false',
              maxPurchasePerUser: maxPurchasePerUser ? parseInt(maxPurchasePerUser as string, 10) : null,
            },
          });

          await AuditService.log({
            action: 'PRODUCT_CREATED',
            adminId: user.id,
            details: { name: product.name, price: product.price } as any,
            referenceId: String(product.id),
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, product });
        } catch (error) {
          logger.error('Error creating product:', error);
          res.status(500).json({ success: false, error: 'Failed to create product.' });
        }
      },
    );

    // -- POST /admin/config/products/:id/update ------------------------------
    router.post(
      '/admin/config/products/:id/update',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const productId = parseInt(paramStr(req.params.id), 10);
          const existing = await prisma.storeProduct.findUnique({ where: { id: productId } });
          if (!existing) return res.status(404).json({ success: false, error: 'Product not found.' });

          const { name, description, actionType, actionValue, price, icon, displayOrder, featured, enabled, maxPurchasePerUser, hidden } = req.body;

          const updateData: Record<string, unknown> = {};
          if (name !== undefined) {
            if (typeof name !== 'string' || name.trim().length < 1) return res.status(400).json({ success: false, error: 'Product name is required.' });
            updateData.name = name.trim();
          }
          if (description !== undefined) updateData.description = description || null;
          if (actionType !== undefined) {
            if (!VALID_ACTION_TYPES.has(actionType)) return res.status(400).json({ success: false, error: 'Invalid action type.' });
            updateData.actionType = actionType;
          }
          if (actionValue !== undefined) {
            const av = parseInt(actionValue, 10);
            if (isNaN(av) || av <= 0) return res.status(400).json({ success: false, error: 'Action value must be positive.' });
            updateData.actionValue = av;
          }
          if (price !== undefined) {
            const pv = parseInt(price, 10);
            if (isNaN(pv) || pv < 0) return res.status(400).json({ success: false, error: 'Price must be non-negative.' });
            updateData.price = pv;
          }
          if (icon !== undefined) updateData.icon = icon || null;
          if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder, 10) || 0;
          if (featured !== undefined) updateData.featured = featured === true || featured === 'true';
          if (enabled !== undefined) updateData.enabled = enabled !== false && enabled !== 'false';
          if (hidden !== undefined) updateData.hidden = hidden === true || hidden === 'true';
          if (maxPurchasePerUser !== undefined) updateData.maxPurchasePerUser = maxPurchasePerUser ? parseInt(maxPurchasePerUser, 10) : null;

          const updated = await prisma.storeProduct.update({ where: { id: productId }, data: updateData });

          await AuditService.log({
            action: 'PRODUCT_UPDATED',
            adminId: user.id,
            details: { name: updated.name, changes: Object.keys(updateData) } as any,
            referenceId: String(productId),
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, product: updated });
        } catch (error) {
          logger.error('Error updating product:', error);
          res.status(500).json({ success: false, error: 'Failed to update product.' });
        }
      },
    );

    // -- POST /admin/config/products/:id/toggle ------------------------------
    router.post(
      '/admin/config/products/:id/toggle',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const productId = parseInt(paramStr(req.params.id), 10);
          const product = await prisma.storeProduct.findUnique({ where: { id: productId } });
          if (!product) return res.status(404).json({ success: false, error: 'Product not found.' });

          const updated = await prisma.storeProduct.update({ where: { id: productId }, data: { enabled: !product.enabled } });

          await AuditService.log({
            action: 'PRODUCT_TOGGLED',
            adminId: user.id,
            details: { name: updated.name, enabled: updated.enabled } as any,
            referenceId: String(productId),
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, enabled: updated.enabled });
        } catch (error) {
          logger.error('Error toggling product:', error);
          res.status(500).json({ success: false, error: 'Failed to toggle product.' });
        }
      },
    );

    // -- POST /admin/config/products/:id/delete ------------------------------
    router.post(
      '/admin/config/products/:id/delete',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const productId = parseInt(paramStr(req.params.id), 10);
          const product = await prisma.storeProduct.findUnique({ where: { id: productId } });
          if (!product) return res.status(404).json({ success: false, error: 'Product not found.' });

          await prisma.storeProduct.delete({ where: { id: productId } });

          await AuditService.log({
            action: 'PRODUCT_DELETED',
            adminId: user.id,
            details: { name: product.name } as any,
            referenceId: String(productId),
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true });
        } catch (error) {
          logger.error('Error deleting product:', error);
          res.status(500).json({ success: false, error: 'Failed to delete product.' });
        }
      },
    );

    // -- POST /admin/config/products/:id/order -------------------------------
    router.post(
      '/admin/config/products/:id/order',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const productId = parseInt(paramStr(req.params.id), 10);
          const { displayOrder } = req.body;

          await prisma.storeProduct.update({
            where: { id: productId },
            data: { displayOrder: parseInt(displayOrder as string, 10) || 0 },
          });

          res.json({ success: true });
        } catch (error) {
          logger.error('Error reordering product:', error);
          res.status(500).json({ success: false, error: 'Failed to update order.' });
        }
      },
    );

    // -- POST /admin/config/products/:id/duplicate ---------------------------
    router.post(
      '/admin/config/products/:id/duplicate',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const productId = parseInt(paramStr(req.params.id), 10);
          const original = await prisma.storeProduct.findUnique({ where: { id: productId } });
          if (!original) return res.status(404).json({ success: false, error: 'Product not found.' });

          const duplicate = await prisma.storeProduct.create({
            data: {
              name: original.name + ' (Copy)',
              description: original.description,
              actionType: original.actionType,
              actionValue: original.actionValue,
              price: original.price,
              icon: original.icon,
              displayOrder: original.displayOrder + 1,
              featured: false,
              hidden: true,
              enabled: false,
              maxPurchasePerUser: original.maxPurchasePerUser,
            },
          });

          await AuditService.log({
            action: 'PRODUCT_DUPLICATED',
            adminId: user.id,
            details: { originalName: original.name, newName: duplicate.name } as any,
            referenceId: String(duplicate.id),
            ipAddress: paramStr(req.ip),
          });

          res.json({ success: true, product: duplicate });
        } catch (error) {
          logger.error('Error duplicating product:', error);
          res.status(500).json({ success: false, error: 'Failed to duplicate product.' });
        }
      },
    );
    // -- POST /admin/config/coupons/create -----------------------------------
    router.post(
      '/admin/config/coupons/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const { code, description, actionType, actionValue, maxUses, perUserLimit, startsAt, expiresAt, enabled } = req.body;

          if (!code || typeof code !== 'string' || code.trim().length < 3) {
            return res.status(400).json({ success: false, error: 'Code must be at least 3 characters.' });
          }
          if (!actionType || !VALID_ACTION_TYPES.has(actionType)) {
            return res.status(400).json({ success: false, error: 'Invalid action type.' });
          }
          const val = parseInt(actionValue, 10);
          if (isNaN(val) || val <= 0) return res.status(400).json({ success: false, error: 'Action value must be positive.' });

          const existingCoupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
          if (existingCoupon) return res.status(400).json({ success: false, error: 'A coupon with this code already exists.' });

          const coupon = await prisma.coupon.create({
            data: {
              code: code.trim().toUpperCase(),
              description: description || null,
              actionType: actionType as ActionType,
              actionValue: val,
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

    // -- POST /admin/config/coupons/:id/update -------------------------------
    router.post(
      '/admin/config/coupons/:id/update',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponId = parseInt(paramStr(req.params.id), 10);
          const existing = await prisma.coupon.findUnique({ where: { id: couponId } });
          if (!existing) return res.status(404).json({ success: false, error: 'Coupon not found.' });

          const { code, description, actionType, actionValue, maxUses, perUserLimit, startsAt, expiresAt, enabled } = req.body;

          if (code && typeof code === 'string') {
            const trimmed = code.trim().toUpperCase();
            if (trimmed.length < 3) return res.status(400).json({ success: false, error: 'Code must be at least 3 characters.' });
            if (trimmed !== existing.code) {
              const dup = await prisma.coupon.findUnique({ where: { code: trimmed } });
              if (dup) return res.status(400).json({ success: false, error: 'A coupon with this code already exists.' });
            }
          }

          const updateData: Record<string, unknown> = {};
          if (code) updateData.code = code.trim().toUpperCase();
          if (description !== undefined) updateData.description = description || null;
          if (actionType) {
            if (!VALID_ACTION_TYPES.has(actionType)) return res.status(400).json({ success: false, error: 'Invalid action type.' });
            updateData.actionType = actionType;
          }
          if (actionValue !== undefined) {
            const av = parseInt(actionValue, 10);
            if (isNaN(av) || av <= 0) return res.status(400).json({ success: false, error: 'Action value must be positive.' });
            updateData.actionValue = av;
          }
          if (maxUses !== undefined) updateData.maxUses = parseInt(maxUses as string, 10) || 0;
          if (perUserLimit !== undefined) updateData.perUserLimit = parseInt(perUserLimit as string, 10) || 1;
          if (startsAt !== undefined) updateData.startsAt = startsAt ? new Date(startsAt as string) : null;
          if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt as string) : null;
          if (enabled !== undefined) updateData.enabled = enabled === true || enabled === 'true';

          const updated = await prisma.coupon.update({ where: { id: couponId }, data: updateData });

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

    // -- POST /admin/config/coupons/:id/delete -------------------------------
    router.post(
      '/admin/config/coupons/:id/delete',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponId = parseInt(paramStr(req.params.id), 10);
          const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
          if (!coupon) return res.status(404).json({ success: false, error: 'Coupon not found.' });

          await prisma.coupon.delete({ where: { id: couponId } });

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

    // -- POST /admin/config/coupons/:id/toggle -------------------------------
    router.post(
      '/admin/config/coupons/:id/toggle',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponId = parseInt(paramStr(req.params.id), 10);
          const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
          if (!coupon) return res.status(404).json({ success: false, error: 'Coupon not found.' });

          const updated = await prisma.coupon.update({ where: { id: couponId }, data: { enabled: !coupon.enabled } });

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

    // -- POST /admin/config/coupons/:id/duplicate ----------------------------
    router.post(
      '/admin/config/coupons/:id/duplicate',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const couponId = parseInt(paramStr(req.params.id), 10);
          const original = await prisma.coupon.findUnique({ where: { id: couponId } });
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

    // -- GET /admin/config/logs/export ---------------------------------------
    router.get(
      '/admin/config/logs/export',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const user = await resolveUser(req);
          if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

          const actionFilter = (req.query.action as string) || '';
          const adminFilter = (req.query.adminId as string) || '';
          const dateFrom = (req.query.dateFrom as string) || '';
          const dateTo = (req.query.dateTo as string) || '';
          const search = (req.query.search as string) || '';

          const where: Prisma.AuditLogWhereInput = {};
          if (actionFilter) where.action = actionFilter;
          if (adminFilter && parseInt(adminFilter, 10)) where.adminId = parseInt(adminFilter, 10);
          if (dateFrom || dateTo) {
            (where as Record<string, unknown>).createdAt = {};
            if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
            if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo + 'T23:59:59.999Z');
          }
          if (search) {
            where.OR = [
              { action: { contains: search } },
              { referenceId: { contains: search } },
              { ipAddress: { contains: search } },
            ] as Prisma.AuditLogWhereInput[];
          }

          const logs = await prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 10000,
          });

          const header = 'ID,Time,Action,AdminID,ReferenceID,IP,Details\n';
          const rows = logs.map(l => {
            const time = l.createdAt.toISOString();
            const details = l.details ? JSON.stringify(l.details).replace(/"/g, '""') : '';
            return `${l.id},"${time}","${l.action}","${l.adminId ?? ''}","${l.referenceId ?? ''}","${l.ipAddress ?? ''}","${details}"`;
          }).join('\n');

          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
          res.send(header + rows);
        } catch (error) {
          logger.error('Error exporting logs:', error);
          res.status(500).json({ success: false, error: 'Failed to export logs.' });
        }
      },
    );

    return router;
  },
};

export default adminModule;