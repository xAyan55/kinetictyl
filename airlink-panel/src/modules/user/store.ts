import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { StoreService } from '../../services/StoreService';
import { WalletService } from '../../services/WalletService';
import { ResourceService } from '../../services/ResourceService';
import { ConfigService } from '../../services/config/ConfigService';
import { ServerLifecycleService } from '../../services/ServerLifecycleService';
import { AuditService } from '../../services/AuditService';
import { WalletTransactionType, AllocationType, AllocationSource } from '@prisma/client';
import logger from '../../handlers/logger';

function paramStr(val: string | string[]): string { return Array.isArray(val) ? val[0] : val; }

const RESOURCE_TYPES = ['RAM', 'CPU', 'DISK', 'BACKUP_SLOTS', 'DATABASE_SLOTS', 'PORTS', 'SERVER_SLOTS'] as const;

const storeModule: Module = {
  info: {
    name: 'Store Module',
    description: 'Complete store with resource, upgrade, and renewal purchases.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/store', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const user = await prisma.users.findUnique({ where: { id: userId } });
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        const [products, balance, resources, servers, storeConfig, renewalsConfig] = await Promise.all([
          StoreService.getProducts(),
          WalletService.getBalance(userId),
          ResourceService.getUserResources(userId),
          prisma.server.findMany({
            where: { ownerId: userId },
            include: { node: true },
          }),
          ConfigService.store(),
          ConfigService.renewals(),
        ]);

        res.render('user/store', {
          user, req, settings, products, balance, title: 'Store',
          ram: resources.ram, cpu: resources.cpu, disk: resources.disk,
          servers, storeConfig, renewalsConfig,
        });
      } catch (error) {
        logger.error('Store page error:', error);
        res.status(500).send('Error loading store.');
      }
    });

    router.post('/store/buy/:id', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const productId = parseInt(paramStr(req.params.id), 10);
        const result = await StoreService.purchase({ userId, productId, ipAddress: paramStr(req.ip) });
        res.json({ success: true, ...result });
      } catch (error: any) {
        res.json({ success: false, error: error.message || 'Purchase failed.' });
      }
    });

    router.post('/store/buy-resource', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const { type, amount } = req.body;
        const parsedAmount = parseInt(amount as string, 10);
        if (!type || !RESOURCE_TYPES.includes(type) || isNaN(parsedAmount) || parsedAmount <= 0) {
          return res.status(400).json({ success: false, error: 'Invalid resource type or amount.' });
        }

        const storeConfig = await ConfigService.store();
        const priceMap: Record<string, number> = {
          RAM: storeConfig.ramPricePerMb,
          CPU: storeConfig.cpuPricePerPercent,
          DISK: storeConfig.diskPricePerMb,
          BACKUP_SLOTS: storeConfig.backupSlotPrice,
          DATABASE_SLOTS: storeConfig.databaseSlotPrice,
          PORTS: storeConfig.portPrice,
          SERVER_SLOTS: storeConfig.databaseSlotPrice,
        };
        const unitPrice = priceMap[type];
        const totalCost = parsedAmount * unitPrice;

        const typeMap: Record<string, AllocationType> = {
          RAM: AllocationType.RAM, CPU: AllocationType.CPU, DISK: AllocationType.DISK,
          BACKUP_SLOTS: AllocationType.BACKUP_SLOTS, DATABASE_SLOTS: AllocationType.DATABASE_SLOTS,
          PORTS: AllocationType.PORTS, SERVER_SLOTS: AllocationType.SERVER_SLOTS,
        };
        const allocationType = typeMap[type];

        const balance = await WalletService.getBalance(userId);
        if (balance < totalCost) {
          return res.status(400).json({ success: false, error: `Insufficient coins. Need ${totalCost}, have ${balance}.` });
        }

        await prisma.$transaction(async (tx) => {
          await WalletService.debit({ userId, amount: totalCost, type: WalletTransactionType.STORE_PURCHASE, reason: `Purchased ${parsedAmount} ${type}`, tx });
          await ResourceService.addAllocation({ userId, type: allocationType, amount: parsedAmount, source: AllocationSource.PURCHASE, tx });
          await AuditService.log({ action: 'resource.purchase', userId, details: { type, amount: parsedAmount, cost: totalCost } as any, tx });
        });

        res.json({ success: true, type, amount: parsedAmount, cost: totalCost });
      } catch (error: any) {
        res.json({ success: false, error: error.message || 'Purchase failed.' });
      }
    });

    router.post('/store/upgrade', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const { serverId, memory, cpu, disk } = req.body;
        if (!serverId) return res.status(400).json({ success: false, error: 'Server ID required.' });

        const resources: Record<string, number> = {};
        if (memory) resources.memory = parseInt(memory as string, 10);
        if (cpu) resources.cpu = parseInt(cpu as string, 10);
        if (disk) resources.disk = parseInt(disk as string, 10);

        const result = await ServerLifecycleService.upgrade({ userId, serverId, resources: resources as any, ipAddress: paramStr(req.ip) });
        res.json({ success: true, ...result });
      } catch (error: any) {
        res.json({ success: false, error: error.message || 'Upgrade failed.' });
      }
    });

    router.post('/store/renew', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session!.user!.id;
        const { serverId, days } = req.body;
        if (!serverId || !days) return res.status(400).json({ success: false, error: 'Server ID and days required.' });

        const result = await ServerLifecycleService.renew({ userId, serverId, days: parseInt(days as string, 10), ipAddress: paramStr(req.ip) });
        res.json({ success: true, ...result });
      } catch (error: any) {
        res.json({ success: false, error: error.message || 'Renewal failed.' });
      }
    });

    router.post('/store/calculate-cost', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const { type, amount } = req.body;
        const storeConfig = await ConfigService.store();
        const priceMap: Record<string, number> = {
          RAM: storeConfig.ramPricePerMb, CPU: storeConfig.cpuPricePerPercent, DISK: storeConfig.diskPricePerMb,
          BACKUP_SLOTS: storeConfig.backupSlotPrice, DATABASE_SLOTS: storeConfig.databaseSlotPrice,
          PORTS: storeConfig.portPrice, SERVER_SLOTS: storeConfig.databaseSlotPrice,
        };
        res.json({ unitPrice: priceMap[type] || 0, totalCost: (parseInt(amount as string) || 0) * (priceMap[type] || 0) });
      } catch { res.json({ unitPrice: 0, totalCost: 0 }); }
    });

    return router;
  },
};

export default storeModule;