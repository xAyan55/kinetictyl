import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import { ConfigService } from '../../services/config/ConfigService';
import { ConfigCategory, ProviderType, RewardType, EarnType, EarnStatus, FraudStatus, FraudSeverity } from '@prisma/client';
import { AuditService } from '../../services/AuditService';
import { ProviderRegistry } from '../../services/monetization/providers/ProviderRegistry';
import { invalidateMonetizationConfigCache } from '../../services/monetization/MonetizationConfigCache';

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

const monetizationAdminModule: Module = {
  info: {
    name: 'Admin Monetization Module',
    description: 'Admin configuration, offer management, diagnostics and fraud settings.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    // GET /admin/monetization
    router.get(
      '/admin/monetization',
      isAuthenticated(true, 'monetization.view'),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) return res.redirect('/login');

          const settings = await prisma.settings.findUnique({ where: { id: 1 } });

          // Load config structures
          const [monetizationConfig, offers, fraudLogs, healthRecords, allUsers] = await Promise.all([
            ConfigService.monetization(),
            prisma.offer.findMany({ include: { rewards: true }, orderBy: { sortOrder: 'asc' } }),
            prisma.monetizationFraudLog.findMany({
              where: { status: FraudStatus.FLAGGED },
              include: { user: true },
              orderBy: { createdAt: 'desc' },
              take: 50
            }),
            prisma.providerHealthRecord.findMany({
              orderBy: { createdAt: 'desc' },
              take: 20
            }),
            prisma.users.findMany({ select: { id: true, username: true } })
          ]);

          // Calculate Economy Dashboard stats from DB
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);

          const [coinsGeneratedTodayRaw, coinsSpentTodayRaw, totalOutstandingRaw, completedOffersCount, activeEarnerCount] = await Promise.all([
            // Coins generated today
            prisma.walletTransaction.aggregate({
              where: {
                createdAt: { gte: startOfToday },
                type: 'REWARD',
                amount: { gt: 0 }
              },
              _sum: { amount: true }
            }),
            // Coins spent today (negative transactions)
            prisma.walletTransaction.aggregate({
              where: {
                createdAt: { gte: startOfToday },
                amount: { lt: 0 }
              },
              _sum: { amount: true }
            }),
            // Total coins balance cached
            prisma.wallet.aggregate({
              _sum: { balance: true }
            }),
            // Completed offers today
            prisma.earnSession.count({
              where: {
                createdAt: { gte: startOfToday },
                status: EarnStatus.COMPLETED
              }
            }),
            // Unique earning users today
            prisma.earnSession.groupBy({
              by: ['userId'],
              where: {
                createdAt: { gte: startOfToday },
                status: EarnStatus.COMPLETED
              }
            })
          ]);

          const coinsGeneratedToday = coinsGeneratedTodayRaw._sum.amount || 0;
          const coinsSpentToday = Math.abs(coinsSpentTodayRaw._sum.amount || 0);
          const totalOutstanding = totalOutstandingRaw._sum.balance || 0;
          const activeEarners = activeEarnerCount.length;

          // Inflation Rate calculation
          const inflationRate = totalOutstanding > 0 ? Number(((coinsGeneratedToday / totalOutstanding) * 100).toFixed(2)) : 0;

          // Build Providers list mapped with dynamic registry data
          const registeredProviders = ProviderRegistry.getAll().map((p) => {
            const health = healthRecords.find((r) => r.provider.toLowerCase() === p.id.toLowerCase());
            return {
              id: p.id,
              name: p.name,
              version: p.version,
              status: health ? health.status : 'UNKNOWN',
              responseTime: health ? health.responseTime : 0,
              lastSuccess: health ? health.lastSuccess : null,
              lastFailure: health ? health.lastFailure : null,
              errorMessage: health ? health.errorMessage : null,
              fields: p.renderConfigurationFields()
            };
          });

          res.render('admin/monetization/monetization', {
            user,
            req,
            settings,
            monetization: monetizationConfig,
            offers,
            fraudLogs,
            providers: registeredProviders,
            users: allUsers,
            stats: {
              coinsGeneratedToday,
              coinsSpentToday,
              totalOutstanding,
              activeEarners,
              completedOffersCount,
              inflationRate
            }
          });
        } catch (err) {
          logger.error('Error loading admin monetization page:', err);
          res.redirect('/admin/overview');
        }
      }
    );

    // POST /admin/monetization/config/:category
    router.post(
      '/admin/monetization/config/:category',
      isAuthenticated(true, 'monetization.config'),
      async (req: Request, res: Response) => {
        try {
          const category = paramStr(req.params.category).toUpperCase();
          if (category !== 'MONETIZATION') {
            return res.status(400).json({ success: false, error: 'Invalid config category.' });
          }

          const sanitized: Record<string, any> = {};
          for (const [key, value] of Object.entries(req.body)) {
            if (value === 'true') sanitized[key] = true;
            else if (value === 'false') sanitized[key] = false;
            else if (value === '' || value === null || value === undefined) sanitized[key] = '';
            else if (!isNaN(Number(value))) sanitized[key] = Number(value);
            else sanitized[key] = value;
          }

          await ConfigService.updateCategory(ConfigCategory.MONETIZATION, sanitized);

          // Trigger configuration reload for registry providers with full configuration
          const fullConfig = await ConfigService.monetization();
          for (const provider of ProviderRegistry.getAll()) {
            // Strip the provider prefix from keys (e.g. linkvertisePublisherId -> publisherId)
            const providerConfig: Record<string, any> = {};
            const prefix = provider.id;
            for (const [key, value] of Object.entries(fullConfig)) {
              if (key.toLowerCase().startsWith(prefix)) {
                const stripped = key.slice(prefix.length);
                const unprefixed = stripped.charAt(0).toLowerCase() + stripped.slice(1);
                providerConfig[unprefixed] = value;
              }
            }
            await provider.reloadConfiguration(providerConfig);
          }

          invalidateMonetizationConfigCache();

          await AuditService.log({
            action: 'monetization.config_updated',
            adminId: req.session.user?.id,
            details: { updatedKeys: Object.keys(sanitized) } as any,
            ipAddress: req.ip || '0.0.0.0'
          });

          res.json({ success: true });
        } catch (err: any) {
          logger.error('Error saving monetization config:', err);
          res.status(500).json({ success: false, error: err.message || 'Failed to update config.' });
        }
      }
    );

    // POST /admin/monetization/offers - Create new Offer
    router.post(
      '/admin/monetization/offers',
      isAuthenticated(true, 'monetization.offers'),
      async (req: Request, res: Response) => {
        try {
          const { name, type, provider, targetUrl, cooldown, sortOrder, icon, description, conditions, rewards } = req.body;

          if (!name || !provider || !targetUrl) {
            return res.status(400).json({ success: false, error: 'Name, Provider and Target URL are required.' });
          }

          let parsedConditions = {};
          try {
            parsedConditions = typeof conditions === 'string' ? JSON.parse(conditions) : conditions || {};
          } catch {
            return res.status(400).json({ success: false, error: 'Invalid conditions JSON schema.' });
          }

          // Create offer and dynamic reward definitions
          const offer = await prisma.offer.create({
            data: {
              name,
              type: type as EarnType,
              provider: provider as ProviderType,
              targetUrl,
              cooldown: Number(cooldown) || 0,
              sortOrder: Number(sortOrder) || 0,
              icon,
              description,
              conditions: parsedConditions
            }
          });

          // Insert rewards
          const parsedRewards = Array.isArray(rewards) ? rewards : [];
          for (const reward of parsedRewards) {
            if (Number(reward.amount) > 0) {
              await prisma.offerReward.create({
                data: {
                  offerId: offer.id,
                  rewardType: reward.type as RewardType,
                  amount: Number(reward.amount)
                }
              });
            }
          }

          await AuditService.log({
            action: 'monetization.offer_created',
            adminId: req.session.user?.id,
            details: { offerId: offer.id, name: offer.name } as any,
            referenceId: String(offer.id),
            ipAddress: req.ip || '0.0.0.0'
          });

          res.json({ success: true, offer });
        } catch (err: any) {
          logger.error('Error creating offer:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /admin/monetization/offers/:id/update
    router.post(
      '/admin/monetization/offers/:id/update',
      isAuthenticated(true, 'monetization.offers'),
      async (req: Request, res: Response) => {
        try {
          const id = parseInt(paramStr(req.params.id), 10);
          const { name, type, provider, targetUrl, cooldown, sortOrder, icon, description, conditions, rewards } = req.body;

          const existing = await prisma.offer.findUnique({ where: { id } });
          if (!existing) {
            return res.status(404).json({ success: false, error: 'Offer not found.' });
          }

          let parsedConditions = {};
          try {
            parsedConditions = typeof conditions === 'string' ? JSON.parse(conditions) : conditions || {};
          } catch {
            return res.status(400).json({ success: false, error: 'Invalid conditions JSON schema.' });
          }

          // Update offer details
          await prisma.offer.update({
            where: { id },
            data: {
              name,
              type: type as EarnType,
              provider: provider as ProviderType,
              targetUrl,
              cooldown: Number(cooldown) || 0,
              sortOrder: Number(sortOrder) || 0,
              icon,
              description,
              conditions: parsedConditions
            }
          });

          // Sync rewards (delete old, insert new)
          await prisma.offerReward.deleteMany({ where: { offerId: id } });
          const parsedRewards = Array.isArray(rewards) ? rewards : [];
          for (const reward of parsedRewards) {
            if (Number(reward.amount) > 0) {
              await prisma.offerReward.create({
                data: {
                  offerId: id,
                  rewardType: reward.type as RewardType,
                  amount: Number(reward.amount)
                }
              });
            }
          }

          await AuditService.log({
            action: 'monetization.offer_updated',
            adminId: req.session.user?.id,
            details: { offerId: id, name } as any,
            referenceId: String(id),
            ipAddress: req.ip || '0.0.0.0'
          });

          res.json({ success: true });
        } catch (err: any) {
          logger.error('Error updating offer:', err);
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /admin/monetization/offers/:id/delete
    router.post(
      '/admin/monetization/offers/:id/delete',
      isAuthenticated(true, 'monetization.offers'),
      async (req: Request, res: Response) => {
        try {
          const id = parseInt(paramStr(req.params.id), 10);
          const existing = await prisma.offer.findUnique({ where: { id } });
          if (!existing) {
            return res.status(404).json({ success: false, error: 'Offer not found.' });
          }

          await prisma.offer.delete({ where: { id } });

          await AuditService.log({
            action: 'monetization.offer_deleted',
            adminId: req.session.user?.id,
            details: { offerId: id, name: existing.name } as any,
            referenceId: String(id),
            ipAddress: req.ip || '0.0.0.0'
          });

          res.json({ success: true });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /admin/monetization/test/:provider
    router.post(
      '/admin/monetization/test/:provider',
      isAuthenticated(true, 'monetization.providers'),
      async (req: Request, res: Response) => {
        try {
          const providerSlug = paramStr(req.params.provider).toLowerCase();
          const provider = ProviderRegistry.get(providerSlug);

          // Load monetization config and pass provider-specific keys (strip provider prefix)
          const monConfig = await ConfigService.monetization();
          const providerConfig: Record<string, any> = {};
          const prefix = providerSlug;
          for (const [key, value] of Object.entries(monConfig)) {
            if (key.toLowerCase().startsWith(prefix)) {
              // Strip the provider prefix: e.g. "adsterraPublisherId" -> "publisherId"
              const stripped = key.slice(prefix.length);
              const unprefixed = stripped.charAt(0).toLowerCase() + stripped.slice(1);
              providerConfig[unprefixed] = value;
            }
          }
          await provider.reloadConfiguration(providerConfig);

          const health = await provider.healthCheck();

          // Create a health check log entry
          await prisma.providerHealthRecord.create({
            data: {
              provider: providerSlug.toUpperCase() as ProviderType,
              status: health.status,
              responseTime: health.responseTime,
              errorMessage: health.error,
              lastSuccess: health.status === 'HEALTHY' ? new Date() : null,
              lastFailure: health.status !== 'HEALTHY' ? new Date() : null
            }
          });

          res.json({ success: true, health });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    // POST /admin/monetization/fraud/:id/resolve
    router.post(
      '/admin/monetization/fraud/:id/resolve',
      isAuthenticated(true, 'monetization.fraud' as any), // Fallback permission checking
      async (req: Request, res: Response) => {
        try {
          const id = parseInt(paramStr(req.params.id), 10);
          const { status } = req.body;

          const log = await prisma.monetizationFraudLog.findUnique({ where: { id } });
          if (!log) {
            return res.status(404).json({ success: false, error: 'Fraud log entry not found.' });
          }

          await prisma.monetizationFraudLog.update({
            where: { id },
            data: { status: status as any }
          });

          await AuditService.log({
            action: 'monetization.fraud_resolved',
            adminId: req.session.user?.id,
            details: { logId: id, resolvedStatus: status } as any,
            referenceId: String(id),
            ipAddress: req.ip || '0.0.0.0'
          });

          res.json({ success: true });
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
        }
      }
    );

    return router;
  },
};

export default monetizationAdminModule;
