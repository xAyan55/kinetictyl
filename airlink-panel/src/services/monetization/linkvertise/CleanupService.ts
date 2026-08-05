import prisma from '../../../db';
import logger from '../../../handlers/logger';
import { CallbackService } from './CallbackService';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SESSION_EXPIRY_HOURS = 2;
const COMPLETION_RETENTION_DAYS = 30;

export class CleanupService {
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the periodic cleanup timer.
   */
  start(): void {
    if (this.intervalId) return;

    logger.info('[CLEANUP] Cleanup service started (interval: 1h)');
    this.intervalId = setInterval(() => {
      this.runCleanup().catch(err => {
        logger.error('[CLEANUP] Cleanup cycle failed:', err);
      });
    }, CLEANUP_INTERVAL_MS);

    // Run once immediately
    this.runCleanup().catch(err => {
      logger.error('[CLEANUP] Initial cleanup failed:', err);
    });
  }

  /**
   * Stop the periodic cleanup timer.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[CLEANUP] Cleanup service stopped');
    }
  }

  /**
   * Execute a single cleanup cycle:
   * 1. Expire stale CREATED/VISITED sessions (older than 2 hours)
   * 2. Purge old completion logs (older than 30 days)
   * 3. Clear in-memory nonce store
   * 4. Clean rate limit entries
   */
  async runCleanup(): Promise<{ expiredSessions: number; purgedCompletions: number }> {
    const now = new Date();

    // 1. Expire stale sessions
    const expiryCutoff = new Date(now.getTime() - SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
    const expiredResult = await prisma.linkvertiseSession.updateMany({
      where: {
        status: { in: ['CREATED', 'VISITED'] },
        createdAt: { lt: expiryCutoff },
      },
      data: { status: 'EXPIRED' },
    });

    // 2. Purge old completion logs
    const retentionCutoff = new Date(now.getTime() - COMPLETION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const purgedResult = await prisma.linkvertiseCompletion.deleteMany({
      where: {
        verifiedAt: { lt: retentionCutoff },
      },
    });

    // 3. Clear nonces
    CallbackService.clearNonces();

    // 4. Clean rate limits
    CallbackService.cleanupRateLimits();

    logger.info(
      `[CLEANUP] Cycle complete: expired=${expiredResult.count} sessions, purged=${purgedResult.count} completions`
    );

    return {
      expiredSessions: expiredResult.count,
      purgedCompletions: purgedResult.count,
    };
  }
}
