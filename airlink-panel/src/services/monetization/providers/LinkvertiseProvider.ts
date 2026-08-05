import { Request } from 'express';
import { MonetizationProvider } from './MonetizationProvider';
import { RewardType } from '@prisma/client';
import { LinkvertiseConfig } from './linkvertiseTypes';
import { LinkBuilder } from '../linkvertise/LinkBuilder';
import { TokenService } from '../linkvertise/TokenService';
import { CallbackService } from '../linkvertise/CallbackService';
import { RewardService } from '../linkvertise/RewardService';
import { AnalyticsService } from '../linkvertise/AnalyticsService';
import { DiagnosticsService } from '../linkvertise/DiagnosticsService';
import { CleanupService } from '../linkvertise/CleanupService';
import { validateTarget } from '../../../utils/urlSafe';
import prisma from '../../../db';
import logger from '../../../handlers/logger';

const DEFAULT_CONFIG: LinkvertiseConfig = {
  publisherId: '',
  enabled: false,
  useDynamicLinks: true,
  defaultDestination: '',
  redirectDelay: 0,
  verifyCallbacks: true,
  callbackSecret: '',
  allowGuestLinks: false,
  analyticsEnabled: true,
  retryFailures: true,
  baseUrl: '',
  enableDynamicLinks: true,
  enableRewards: true,
  enableCallbackProcessing: true,
  enableAnalytics: true,
  enableDiagnostics: true,
  enableTestMode: false,
  enableCsvExport: false,
  rewardRules: { earn: 20, bonus: 25, afk: 15, store: 10 },
};

export class LinkvertiseProvider implements MonetizationProvider {
  readonly id = 'linkvertise';
  readonly name = 'Linkvertise';
  readonly version = '2.1.0';

  private config: LinkvertiseConfig = { ...DEFAULT_CONFIG };
  private tokenService: TokenService | null = null;
  private callbackService: CallbackService | null = null;
  private rewardService: RewardService | null = null;
  private cleanupService: CleanupService | null = null;

  async initialize(): Promise<void> {
    logger.info('[LinkvertiseProvider] Initializing v2.1.0');

    if (this.config.callbackSecret && this.config.callbackSecret.length >= 32) {
      this.tokenService = new TokenService(this.config.callbackSecret);
      this.callbackService = new CallbackService(this.tokenService);
    }

    this.rewardService = new RewardService(this.config.rewardRules);

    this.cleanupService = new CleanupService();
    this.cleanupService.start();

    logger.info('[LinkvertiseProvider] Initialized successfully');
  }

  async shutdown(): Promise<void> {
    if (this.cleanupService) {
      this.cleanupService.stop();
    }
    logger.info('[LinkvertiseProvider] Shut down');
  }

  async reloadConfiguration(config: Record<string, any>): Promise<void> {
    const merged: Record<string, any> = {};

    // Extract linkvertise-prefixed keys (MonetizationConfig format) and strip prefix
    for (const [key, value] of Object.entries(config)) {
      if (key.toLowerCase().startsWith('linkvertise')) {
        const stripped = key.slice('linkvertise'.length);
        const unprefixed = stripped.charAt(0).toLowerCase() + stripped.slice(1);
        merged[unprefixed] = value;
      } else {
        // Pass through unprefixed keys (for test-route direct config)
        merged[key] = value;
      }
    }

    this.config = { ...DEFAULT_CONFIG, ...merged } as LinkvertiseConfig;

    // Normalize publisherId to string (form sanitization may convert it to number)
    if (this.config.publisherId != null) {
      this.config.publisherId = String(this.config.publisherId);
    }

    if (this.config.callbackSecret && this.config.callbackSecret.length >= 32) {
      this.tokenService = new TokenService(this.config.callbackSecret);
      this.callbackService = new CallbackService(this.tokenService);
    }

    this.rewardService = new RewardService(this.config.rewardRules);
    logger.info('[LinkvertiseProvider] Configuration reloaded');
  }

  async validateConfiguration(config: Record<string, any>): Promise<void> {
    const publisherId = (config.publisherId || '').toString().trim();
    if (!publisherId) {
      throw new Error('Linkvertise Publisher ID is required.');
    }
    if (!/^\d+$/.test(publisherId)) {
      throw new Error('Linkvertise Publisher ID must be numeric (digits only).');
    }
    if (config.enableDynamicLinks !== false) {
      if (!config.callbackSecret || (config.callbackSecret as string).length < 32) {
        throw new Error('Callback Secret must be at least 32 characters when Dynamic Links are enabled.');
      }
      if (config.baseUrl) {
        const baseUrl = (config.baseUrl as string).replace(/\/+$/, '');
        if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) {
          throw new Error('Base URL must use HTTPS (or http://localhost for development).');
        }
      }
    }
    if (config.defaultDestination && !config.defaultDestination.startsWith('https://')) {
      throw new Error('Default Destination must use HTTPS.');
    }
  }

  async generateLink(user: any, offer: any, targetUrl: string, options?: any): Promise<string> {
    const correlationId = `lv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // ── Pre-generation validation ──────────────────────────────────
    this.assertCanGenerate(targetUrl, correlationId);

    const publisherId = String(this.config.publisherId).trim();
    const campaign = options?.campaign || 'earn';
    const placement = options?.placement || 'offer_wall';
    const rewardAmount = this.rewardService?.getRewardAmount(campaign) ?? 10;
    const sessionToken = options?.sessionToken || '';

    // 1. Generate a signed token for callback verification
    const token = this.tokenService!.generate(user.id, 'COINS', campaign, placement);

    // 2. Create a session record
    const session = await prisma.linkvertiseSession.create({
      data: {
        token,
        userId: user.id,
        campaign,
        placement,
        rewardType: 'COINS',
        rewardAmount,
        destination: targetUrl,
        status: 'CREATED',
      },
    });

    // 3. Build the dynamic Linkvertise URL
    const builder = new LinkBuilder(publisherId);
    builder.setTargetUrl(targetUrl)
      .setToken(token)
      .setCampaign(campaign)
      .setPlacement(placement)
      .setReward('COINS', rewardAmount);

    // Use the baseUrl as the callback target so Linkvertise redirects to our
    // completion endpoint after the user finishes the ad flow.
    if (this.config.baseUrl) {
      builder.setCallbackUrl(this.config.baseUrl.replace(/\/+$/, ''));
    }

    const url = builder.build();

    // 4. Post-generation URL validation
    const validation = builder.validateGeneratedUrl(url);
    if (!validation.valid) {
      logger.error(`[LINK_BUILD_FAILED] correlationId=${correlationId} errors=${validation.errors.join('; ')}`);
      throw new Error(`Generated Linkvertise URL is invalid: ${validation.errors.join('; ')}`);
    }

    // 5. Debug logging
    logger.info(`[LINK_GENERATED] correlationId=${correlationId} user=${user.id} campaign=${campaign} sessionId=${session.id}`);
    logger.debug(`[LINK_DEBUG] correlationId=${correlationId} inputUrl=${targetUrl} generatedUrl=${url} publisherId=${publisherId} campaign=${campaign} placement=${placement} token=${token.substr(0, 20)}... callbackUrl=${this.config.baseUrl}`);

    return url;
  }

  async verifyCallback(req: Request): Promise<boolean> {
    if (!this.callbackService || !this.config.enableCallbackProcessing) {
      logger.warn('[LinkvertiseProvider] Callback processing disabled or not configured');
      return false;
    }

    const result = await this.callbackService.processCallback(req);

    if (!result.success) {
      logger.warn(`[LinkvertiseProvider] Callback rejected: ${result.error}`);
      return false;
    }

    if (this.config.enableRewards && this.rewardService && result.sessionId) {
      const rewardResult = await this.rewardService.processReward(result.sessionId);
      if (!rewardResult.success) {
        logger.error(`[LinkvertiseProvider] Reward failed for session=${result.sessionId}: ${rewardResult.error}`);
      }
    }

    return result.success;
  }

  async healthCheck(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN'; responseTime: number; error?: string }> {
    const start = Date.now();
    try {
      if (!this.config.publisherId) {
        return { status: 'DEGRADED', responseTime: Date.now() - start, error: 'Publisher ID not configured' };
      }
      if (!this.tokenService) {
        return { status: 'DEGRADED', responseTime: Date.now() - start, error: 'Callback secret not configured or too short' };
      }
      if (!this.config.enableDynamicLinks) {
        return { status: 'DEGRADED', responseTime: Date.now() - start, error: 'Dynamic Links are disabled in configuration' };
      }
      if (!this.config.baseUrl) {
        return { status: 'DEGRADED', responseTime: Date.now() - start, error: 'Base URL not configured — callback flow will not work' };
      }

      await prisma.linkvertiseSession.count({ take: 1 });

      // Validate the URL format would work
      const builder = new LinkBuilder(this.config.publisherId);
      builder.setTargetUrl(this.config.defaultDestination || 'https://example.com')
        .setToken('test.validation.token')
        .setCallbackUrl(this.config.baseUrl);
      const testUrl = builder.build();
      const urlValidation = builder.validateGeneratedUrl(testUrl);
      if (!urlValidation.valid) {
        return { status: 'DEGRADED', responseTime: Date.now() - start, error: `URL generation validation failed: ${urlValidation.errors.join('; ')}` };
      }

      return { status: 'HEALTHY', responseTime: Date.now() - start };
    } catch (err: any) {
      return { status: 'OFFLINE', responseTime: Date.now() - start, error: err.message };
    }
  }

  renderConfigurationFields(): Array<{ key: string; label: string; type: string; default?: any }> {
    return [
      { key: 'publisherId', label: 'Publisher / User ID (numeric)', type: 'text' },
      { key: 'apiKey', label: 'API Key (Optional)', type: 'password' },
      { key: 'callbackSecret', label: 'Callback Secret Key (min 32 chars)', type: 'password' },
      { key: 'baseUrl', label: 'Application Base URL (for callback redirect, e.g. https://panel.com)', type: 'text' },
      { key: 'defaultDestination', label: 'Default Fallback Destination (HTTPS)', type: 'text' },
      { key: 'enableDynamicLinks', label: 'Enable Dynamic Links', type: 'toggle', default: true },
      { key: 'enableRewards', label: 'Enable Reward Processing', type: 'toggle', default: true },
      { key: 'enableCallbackProcessing', label: 'Enable Callback Processing', type: 'toggle', default: true },
      { key: 'enableAnalytics', label: 'Enable Analytics', type: 'toggle', default: true },
      { key: 'enableDiagnostics', label: 'Enable Diagnostics', type: 'toggle', default: true },
      { key: 'enableTestMode', label: 'Enable Test Mode', type: 'toggle', default: false },
      { key: 'enableCsvExport', label: 'Enable CSV Export', type: 'toggle', default: false },
    ];
  }

  async getStatistics(): Promise<Record<string, any>> {
    if (!this.config.enableAnalytics) {
      return { analyticsDisabled: true };
    }
    return AnalyticsService.getAnalytics(24);
  }

  supportsReward(type: RewardType): boolean {
    return type === RewardType.COINS;
  }

  supportsWebhook(): boolean {
    return true;
  }

  supportsClientScript(): boolean {
    return true;
  }

  // ─── Pre-generation validation ───────────────────────────────

  private assertCanGenerate(targetUrl: string, correlationId: string): void {
    const errors: string[] = [];

    if (!this.config.enabled) {
      errors.push('Linkvertise provider is disabled');
    }

    const pid = String(this.config.publisherId || '').trim();
    if (!pid) {
      errors.push('Publisher ID is not configured');
    } else if (!/^\d+$/.test(pid)) {
      errors.push(`Publisher ID "${this.config.publisherId}" is not numeric`);
    }

    if (!this.config.enableDynamicLinks) {
      errors.push('Dynamic Links are disabled in configuration');
    }

    if (!this.tokenService) {
      errors.push('Token service not initialized — callback secret missing or too short');
    }

    if (!targetUrl) {
      errors.push('Target URL is empty');
    } else if (!validateTarget(targetUrl)) {
      errors.push(`Target URL "${targetUrl}" is not a valid HTTP or HTTPS URL`);
    }

    if (errors.length > 0) {
      logger.error(`[LINK_VALIDATION_FAILED] correlationId=${correlationId} errors=${errors.join('; ')} targetUrl=${targetUrl}`);
      throw new Error(`Cannot generate Linkvertise link: ${errors.join('; ')}`);
    }
  }

  // ─── Extended API (for admin routes) ────────────────────────────

  getConfig(): LinkvertiseConfig {
    return { ...this.config };
  }

  getTokenService(): TokenService | null {
    return this.tokenService;
  }

  getRewardService(): RewardService | null {
    return this.rewardService;
  }

  async getDiagnostics() {
    return DiagnosticsService.runDiagnostics(this.config);
  }

  async createMockSession(userId: number) {
    return DiagnosticsService.createMockSession(userId, this.config);
  }

  /**
   * Generate a test link for diagnostic/validation purposes.
   * Returns the generated URL and validation results without creating a session.
   */
  async generateTestLink(targetUrl?: string): Promise<{
    url: string;
    validation: { valid: boolean; errors: string[] };
    builderValidation: { valid: boolean; errors: string[] };
    diagnostics: string[];
  }> {
    const diagnostics: string[] = [];
    const testTarget = targetUrl || this.config.defaultDestination || 'https://example.com';

    diagnostics.push(`Publisher ID: ${this.config.publisherId || '(not set)'}`);
    diagnostics.push(`Dynamic Links: ${this.config.enableDynamicLinks ? 'enabled' : 'disabled'}`);
    diagnostics.push(`Test target: ${testTarget}`);
    diagnostics.push(`Base URL: ${this.config.baseUrl || '(not set — callback will not be embedded)'}`);

    const builder = new LinkBuilder(this.config.publisherId || '000000');
    builder.setTargetUrl(testTarget)
      .setToken(`test-${Date.now()}`)
      .setCampaign('test')
      .setPlacement('diagnostics');

    if (this.config.baseUrl) {
      builder.setCallbackUrl(this.config.baseUrl);
      diagnostics.push('Callback URL will be embedded in the r parameter');
    } else {
      diagnostics.push('No baseUrl set — token will be appended directly to target URL');
    }

    const builderValidation = builder.validate();
    diagnostics.push(`Pre-build validation: ${builderValidation.valid ? 'PASS' : 'FAIL'}`);
    builderValidation.errors.forEach(e => diagnostics.push(`  - ${e}`));

    const url = builder.build();
    diagnostics.push(`Generated URL: ${url}`);

    const urlValidation = builder.validateGeneratedUrl(url);
    diagnostics.push(`Post-build URL validation: ${urlValidation.valid ? 'PASS' : 'FAIL'}`);
    urlValidation.errors.forEach(e => diagnostics.push(`  - ${e}`));

    return { url, validation: builderValidation, builderValidation: urlValidation, diagnostics };
  }
}
