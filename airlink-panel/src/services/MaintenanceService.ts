import prisma from '../db';
import logger from '../handlers/logger';
import { ServerLifecycleService } from './ServerLifecycleService';
import { AuditService } from './AuditService';

export class MaintenanceService {
  private interval: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 60000) {
    if (this.interval) return;
    logger.info('MaintenanceService started (interval: ' + intervalMs + 'ms)');
    this.interval = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('MaintenanceService stopped');
    }
  }

  private async tick() {
    try {
      await Promise.all([
        this.checkExpiredServers(),
        this.checkExpiringServers(),
      ]);
    } catch (error) {
      logger.error('MaintenanceService tick error:', error);
    }
  }

  private async checkExpiredServers() {
    try {
      const expired = await ServerLifecycleService.getExpiredServers();
      for (const server of expired) {
        try {
          await ServerLifecycleService.suspend({
            adminId: 1,
            serverId: server.UUID,
            reason: 'Server expired',
          });
          logger.info(`Auto-suspended expired server: ${server.UUID} (${server.name})`);
        } catch (err) {
          logger.error(`Failed to suspend expired server ${server.UUID}:`, err);
        }
      }
    } catch (err) {
      logger.error('MaintenanceService.checkExpiredServers error:', err);
    }
  }

  private async checkExpiringServers() {
    try {
      const now = new Date();
      const warningThreshold = 3 * 86400000;
      const warningDate = new Date(now.getTime() + warningThreshold);

      const expiringSoon = await prisma.server.findMany({
        where: {
          expiresAt: {
            not: null,
            lte: warningDate,
            gt: now,
          },
          Suspended: false,
        },
      });

      for (const server of expiringSoon) {
        await AuditService.log({
          action: 'server.expiry_warning',
          userId: server.ownerId,
          details: {
            expiresAt: server.expiresAt,
            daysRemaining: Math.ceil((server.expiresAt!.getTime() - now.getTime()) / 86400000),
          },
          referenceId: server.UUID,
        });
      }
    } catch (err) {
      logger.error('MaintenanceService.checkExpiringServers error:', err);
    }
  }
}
