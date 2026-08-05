import type { Images } from '@prisma/client';

export const PLUGIN_SERVER_LOADERS = ['paper', 'purpur', 'spigot', 'bukkit', 'folia'] as const;

export type PluginServerLoader = (typeof PLUGIN_SERVER_LOADERS)[number];

const EXCLUDED_LOADERS = new Set([
  'forge',
  'fabric',
  'neoforge',
  'quilt',
  'vanilla',
  'bedrock',
  'velocity',
  'waterfall',
  'bungeecord',
]);

function collectImageText(image: Images): string {
  return [
    image.name,
    image.description,
    image.dockerImages,
    image.startup,
    image.meta,
    image.info,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function parseImageInfo(image: Images): Record<string, unknown> | null {
  if (!image.info) return null;
  try {
    return typeof image.info === 'string' ? JSON.parse(image.info) : (image.info as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function detectPluginLoader(image: Images | null | undefined): PluginServerLoader | null {
  if (!image) return null;

  const info = parseImageInfo(image);
  const explicitType = typeof info?.type === 'string' ? info.type.toLowerCase() : '';
  if (PLUGIN_SERVER_LOADERS.includes(explicitType as PluginServerLoader)) {
    return explicitType as PluginServerLoader;
  }

  const haystack = collectImageText(image);
  for (const loader of PLUGIN_SERVER_LOADERS) {
    if (haystack.includes(loader)) {
      return loader;
    }
  }

  return null;
}

export function isPluginServer(image: Images | null | undefined): boolean {
  if (!image) return false;

  const info = parseImageInfo(image);
  if (info?.pluginServer === true) return true;
  if (info?.pluginServer === false) return false;

  const loader = detectPluginLoader(image);
  if (!loader) return false;

  const haystack = collectImageText(image);
  for (const excluded of EXCLUDED_LOADERS) {
    if (haystack.includes(excluded) && !haystack.includes(loader)) {
      return false;
    }
  }

  return true;
}

export function getMinecraftVersionFromImage(image: Images | null | undefined): string | null {
  if (!image?.variables) return null;

  try {
    const variables = JSON.parse(image.variables) as Array<{
      env?: string;
      env_variable?: string;
      value?: string | number | boolean;
      default?: string | number | boolean;
      default_value?: string | number | boolean;
    }>;

    const versionKeys = ['MINECRAFT_VERSION', 'MC_VERSION', 'SERVER_VERSION', 'VERSION'];
    for (const variable of variables) {
      const key = (variable.env_variable || variable.env || '').toUpperCase();
      if (!versionKeys.includes(key)) continue;
      const raw = variable.value ?? variable.default ?? variable.default_value;
      if (raw === undefined || raw === null || raw === '') continue;
      return String(raw).replace(/^mc\.?/i, '').trim();
    }
  } catch {
    return null;
  }

  return null;
}

const DEPLOYMENT_TAGS = new Set(['latest', 'stable', 'nightly', 'rolling']);

function isValidMinecraftVersion(version: string | null | undefined): version is string {
  if (!version) return false;
  const cleaned = version.replace(/^mc\.?/i, '').trim().toLowerCase();
  if (DEPLOYMENT_TAGS.has(cleaned)) return false;
  return /^\d+\.\d+(\.\d+)?$/.test(cleaned);
}

export function resolveMinecraftVersion(
  image: Images | null | undefined,
  runtimeVariablesJson: string | null | undefined,
): string | null {
  const tryVersion = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const cleaned = String(v).replace(/^mc\.?/i, '').trim();
    if (!isValidMinecraftVersion(cleaned)) return null;
    return cleaned;
  };

  const fromRuntime = tryVersion(getServerVariablesRecord(runtimeVariablesJson).MINECRAFT_VERSION)
    || tryVersion(getServerVariablesRecord(runtimeVariablesJson).MC_VERSION)
    || tryVersion(getServerVariablesRecord(runtimeVariablesJson).SERVER_VERSION)
    || tryVersion(getServerVariablesRecord(runtimeVariablesJson).VERSION);
  if (fromRuntime) return fromRuntime;

  const fromImage = tryVersion(getMinecraftVersionFromImage(image));
  if (fromImage) return fromImage;

  if (image?.dockerImages) {
    try {
      const images = JSON.parse(image.dockerImages) as Record<string, string>;
      for (const tag of Object.values(images)) {
        const colonIdx = tag.lastIndexOf(':');
        if (colonIdx === -1) continue;
        const tagValue = tag.slice(colonIdx + 1);
        const cleaned = tryVersion(tagValue);
        if (cleaned) return cleaned;
      }
    } catch {
      // Not JSON — try raw text
      const match = image.dockerImages.match(/:(\d+\.\d+(?:\.\d+)?)/);
      if (match) {
        const cleaned = tryVersion(match[1]);
        if (cleaned) return cleaned;
      }
    }
  }

  return null;
}

export function getServerVariablesRecord(
  variablesJson: string | null | undefined,
): Record<string, string> {
  if (!variablesJson) return {};

  try {
    const variables = JSON.parse(variablesJson) as Array<{
      env?: string;
      env_variable?: string;
      value?: string | number | boolean;
      default?: string | number | boolean;
      default_value?: string | number | boolean;
    }>;

    const env: Record<string, string> = {};
    for (const variable of variables) {
      const key = variable.env_variable || variable.env;
      if (!key) continue;
      const raw = variable.value ?? variable.default ?? variable.default_value ?? '';
      env[key] = String(raw);
    }
    return env;
  } catch {
    return {};
  }
}
