import { MonetizationProvider } from './MonetizationProvider';
import logger from '../../../handlers/logger';

export class ProviderRegistry {
  private static providers = new Map<string, MonetizationProvider>();

  static register(provider: MonetizationProvider): void {
    const key = provider.id.toLowerCase();
    this.validateDuplicates(key);
    this.providers.set(key, provider);
    logger.info(`Registered monetization provider: ${provider.name} (${provider.version})`);
  }

  static unregister(id: string): void {
    const key = id.toLowerCase();
    if (this.providers.has(key)) {
      const provider = this.providers.get(key);
      provider?.shutdown().catch((err) => {
        logger.error(`Error shutting down provider ${id}:`, err);
      });
      this.providers.delete(key);
      logger.info(`Unregistered monetization provider: ${id}`);
    }
  }

  static get(id: string): MonetizationProvider {
    const key = id.toLowerCase();
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(`Monetization provider "${id}" is not registered.`);
    }
    return provider;
  }

  static getAll(): MonetizationProvider[] {
    return Array.from(this.providers.values());
  }

  static async reload(id: string, config: Record<string, any>): Promise<void> {
    const provider = this.get(id);
    await provider.reloadConfiguration(config);
    logger.info(`Reloaded configuration for provider: ${provider.name}`);
  }

  static async healthCheckAll(): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    for (const provider of this.providers.values()) {
      try {
        const check = await provider.healthCheck();
        results[provider.id] = check;
      } catch (err: any) {
        results[provider.id] = {
          status: 'UNKNOWN',
          responseTime: 0,
          error: err.message || String(err),
        };
      }
    }
    return results;
  }

  static validateDuplicates(key: string): void {
    if (this.providers.has(key)) {
      throw new Error(`Monetization provider with key "${key}" already registered.`);
    }
  }

  static discover(): void {
    // Dynamic discovery can be wired up here or registered statically.
    // We will call this during app initialization.
  }
}
