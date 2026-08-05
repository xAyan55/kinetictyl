import type { MonetizationConfig } from '../config/types';

const ZONE_CONFIG_KEY_MAP: Record<string, string> = {
  popunder: 'adsterraPopunderId',
  native: 'adsterraNativeBannerId',
  banner: 'adsterraBannerId',
  smartlink: 'adsterraSmartlinkId',
  socialbar: 'adsterraSocialBarId',
  '468x60': 'adsterra468x60Id',
  '300x250': 'adsterra300x250Id',
  '160x300': 'adsterra160x300Id',
  '160x600': 'adsterra160x600Id',
  '320x50': 'adsterra320x50Id',
  '728x90': 'adsterra728x90Id',
};

function cfg(config: MonetizationConfig, key: string): string {
  return ((config as unknown as Record<string, unknown>)[key] as string) || '';
}

function renderContainer(zoneId: string, format: string, placement: string): string {
  return `<div class="cynex-ad-wrapper" id="cynex-${placement}" data-cynex-placement="${placement}" data-cynex-format="${format}" data-cynex-zone="${zoneId}"></div>`;
}

export function renderPlacement(
  config: MonetizationConfig | null,
  placementName: string,
): string {
  if (!config || !config.enabled || !config.adsterraEnabled) return '';

  const configKey = 'placement' + placementName.charAt(0).toUpperCase() + placementName.slice(1);
  const format = cfg(config, configKey);
  if (!format) return '';

  const zoneConfigKey = ZONE_CONFIG_KEY_MAP[format];
  if (!zoneConfigKey) return '';
  const zoneId = cfg(config, zoneConfigKey);
  if (!zoneId) return '';

  // smartlink — render as link directly
  if (format === 'smartlink') {
    return renderSmartlink(config);
  }

  // All ad formats render as empty containers with data attributes.
  // Client-side ads.js reads the data attributes and injects the
  // correct Adsterra script (atOptions + invoke.js) sequentially.
  // This avoids the broken iframe embed (/{zoneId}/invoke as iframe
  // src returns JavaScript, not HTML) and prevents atOptions overwrites.
  return renderContainer(zoneId, format, placementName);
}

export function renderSmartlink(
  config: MonetizationConfig | null,
): string {
  if (!config || !config.enabled || !config.adsterraEnabled) return '';
  const smartlinkId = config.adsterraSmartlinkId;
  if (!smartlinkId) return '';

  return `<a href="https://www.highperformanceformat.com/${encodeURIComponent(smartlinkId)}/invoke" target="_blank" rel="noopener" class="cynex-ad-smartlink" data-cynex-placement="smartlink">Sponsored</a>`;
}
