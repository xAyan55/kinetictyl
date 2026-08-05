import { ProviderRegistry } from './ProviderRegistry';
import { LinkvertiseProvider } from './LinkvertiseProvider';
import { AdsterraProvider } from './AdsterraProvider';

export function initializeProviders(): void {
  ProviderRegistry.register(new LinkvertiseProvider());
  ProviderRegistry.register(new AdsterraProvider());
}

export * from './MonetizationProvider';
export * from './ProviderRegistry';
export * from './LinkvertiseProvider';
export * from './AdsterraProvider';
