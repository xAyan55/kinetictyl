import { ConfigService } from '../config/ConfigService';
import type { MonetizationConfig } from '../config/types';

let cached: MonetizationConfig | null = null;
let lastFetch = 0;
const TTL = 30_000;

export function getMonetizationConfigCached(): Promise<MonetizationConfig | null> {
  const now = Date.now();
  if (cached && now - lastFetch < TTL) {
    return Promise.resolve(cached);
  }
  return ConfigService.monetization().then((cfg) => {
    cached = cfg;
    lastFetch = Date.now();
    return cfg;
  }).catch(() => {
    return cached || null;
  });
}

export function invalidateMonetizationConfigCache(): void {
  cached = null;
  lastFetch = 0;
}
