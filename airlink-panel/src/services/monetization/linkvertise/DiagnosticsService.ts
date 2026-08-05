import prisma from '../../../db';
import logger from '../../../handlers/logger';
import { LinkvertiseConfig } from '../providers/linkvertiseTypes';
import { AnalyticsService } from './AnalyticsService';
import { LinkBuilder } from './LinkBuilder';

export interface DiagnosticReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: DiagnosticCheck[];
  config: Partial<LinkvertiseConfig>;
  analytics: Awaited<ReturnType<typeof AnalyticsService.getAnalytics>> | null;
  timestamp: Date;
}

export interface DiagnosticCheck {
  name: string;
  passed: boolean;
  message: string;
}

export class DiagnosticsService {
  static async runDiagnostics(config: LinkvertiseConfig): Promise<DiagnosticReport> {
    const checks: DiagnosticCheck[] = [];

    // Check 1: Publisher ID present and valid format
    const pubId = (config.publisherId || '').trim();
    checks.push({
      name: 'Publisher ID',
      passed: pubId.length > 0 && /^\d+$/.test(pubId),
      message: pubId
        ? (/^\d+$/.test(pubId) ? `Numeric ID: ${pubId}` : `Non-numeric value: "${pubId}" — must be digits only`)
        : 'Missing publisher ID',
    });

    // Check 2: Callback secret strength
    checks.push({
      name: 'Callback Secret',
      passed: !!config.callbackSecret && config.callbackSecret.length >= 32,
      message: config.callbackSecret
        ? (config.callbackSecret.length >= 32 ? `Strong (${config.callbackSecret.length} chars)` : `Weak (${config.callbackSecret.length} chars, need 32+)`)
        : 'Not configured',
    });

    // Check 3: Default destination is HTTPS (if set)
    checks.push({
      name: 'Default Destination',
      passed: !config.defaultDestination || config.defaultDestination.startsWith('https://'),
      message: config.defaultDestination
        ? (config.defaultDestination.startsWith('https://') ? 'Using HTTPS' : 'WARNING: Not using HTTPS')
        : 'Not configured (optional)',
    });

    // Check 4: Dynamic links enabled
    checks.push({
      name: 'Dynamic Links',
      passed: config.enableDynamicLinks,
      message: config.enableDynamicLinks ? 'Enabled' : 'Disabled — links cannot be generated',
    });

    // Check 5: Provider enabled
    checks.push({
      name: 'Provider Enabled',
      passed: config.enabled,
      message: config.enabled ? 'Enabled' : 'Disabled — link generation is blocked',
    });

    // Check 6: Base URL configured (needed for callback flow)
    checks.push({
      name: 'Base URL',
      passed: !!config.baseUrl,
      message: config.baseUrl
        ? `Set to: ${config.baseUrl}`
        : 'Not configured — callback flow will not work, tokens will be appended directly to target URLs',
    });

    // Check 7: Rewards enabled
    checks.push({
      name: 'Reward Processing',
      passed: config.enableRewards,
      message: config.enableRewards ? 'Enabled' : 'Disabled',
    });

    // Check 8: Database connectivity
    let dbCheck = false;
    try {
      await prisma.linkvertiseSession.count();
      dbCheck = true;
    } catch {
      dbCheck = false;
    }
    checks.push({
      name: 'Database Connection',
      passed: dbCheck,
      message: dbCheck ? 'Connected' : 'Failed to query LinkvertiseSession table',
    });

    // Check 9: Generated URL format validation
    if (pubId && /^\d+$/.test(pubId) && config.enableDynamicLinks) {
      try {
        const builder = new LinkBuilder(pubId);
        builder.setTargetUrl(config.defaultDestination || 'https://example.com')
          .setToken('diagnostics.test.token')
          .setCampaign('test')
          .setPlacement('diagnostics');
        if (config.baseUrl) {
          builder.setCallbackUrl(config.baseUrl);
        }
        const testUrl = builder.build();
        const urlValidation = builder.validateGeneratedUrl(testUrl);

        checks.push({
          name: 'URL Generation',
          passed: urlValidation.valid,
          message: urlValidation.valid
            ? `Generated valid test URL: ${testUrl.substring(0, 80)}...`
            : `Validation failed: ${urlValidation.errors.join('; ')}`,
        });
      } catch (err: any) {
        checks.push({
          name: 'URL Generation',
          passed: false,
          message: `Exception during generation: ${err.message}`,
        });
      }
    } else {
      checks.push({
        name: 'URL Generation',
        passed: false,
        message: 'Skipped — publisher ID is missing, non-numeric, or dynamic links disabled',
      });
    }

    // Check 10: Recent session activity (last hour)
    try {
      const recentCount = await prisma.linkvertiseSession.count({
        where: { createdAt: { gte: new Date(Date.now() - 3600_000) } },
      });
      checks.push({
        name: 'Recent Activity',
        passed: true,
        message: `${recentCount} sessions in the last hour`,
      });
    } catch {
      checks.push({
        name: 'Recent Activity',
        passed: false,
        message: 'Failed to query recent sessions',
      });
    }

    // Check 11: Failed sessions (alert if > 10% in last hour)
    try {
      const [total, failed] = await Promise.all([
        prisma.linkvertiseSession.count({
          where: { createdAt: { gte: new Date(Date.now() - 3600_000) } },
        }),
        prisma.linkvertiseSession.count({
          where: {
            status: 'FAILED',
            createdAt: { gte: new Date(Date.now() - 3600_000) },
          },
        }),
      ]);
      const failRate = total > 0 ? (failed / total) * 100 : 0;
      checks.push({
        name: 'Failure Rate',
        passed: failRate < 10,
        message: `${failRate.toFixed(1)}% failure rate (${failed}/${total})`,
      });
    } catch {
      checks.push({
        name: 'Failure Rate',
        passed: false,
        message: 'Failed to compute',
      });
    }

    // Overall status
    const failedChecks = checks.filter(c => !c.passed);
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (failedChecks.length > 0 && failedChecks.length <= 2) status = 'degraded';
    if (failedChecks.length > 2) status = 'unhealthy';

    let analytics = null;
    try {
      analytics = await AnalyticsService.getAnalytics(24);
    } catch (err) {
      logger.error('[DIAGNOSTICS] Failed to fetch analytics:', err);
    }

    return {
      status,
      checks,
      config: {
        publisherId: config.publisherId,
        enabled: config.enabled,
        enableDynamicLinks: config.enableDynamicLinks,
        enableRewards: config.enableRewards,
        enableCallbackProcessing: config.enableCallbackProcessing,
        enableAnalytics: config.enableAnalytics,
        enableDiagnostics: config.enableDiagnostics,
        enableTestMode: config.enableTestMode,
      },
      analytics,
      timestamp: new Date(),
    };
  }

  static async createMockSession(userId: number, config: LinkvertiseConfig): Promise<number | null> {
    if (!config.enableTestMode) {
      logger.warn('[DIAGNOSTICS] Cannot create mock session: test mode disabled');
      return null;
    }

    const session = await prisma.linkvertiseSession.create({
      data: {
        token: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
        userId,
        campaign: 'test',
        placement: 'diagnostics',
        rewardType: 'COINS',
        rewardAmount: 1,
        destination: config.defaultDestination || 'https://example.com',
        status: 'CREATED',
      },
    });

    logger.info(`[DIAGNOSTICS] Created mock session id=${session.id} for userId=${userId}`);
    return session.id;
  }
}
