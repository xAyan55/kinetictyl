import type { Images } from '@prisma/client';
import type { ModrinthVersion } from '../types/modrinth-api';

export const LOADER_GROUPS = {
  PLUGIN: new Set(['paper', 'purpur', 'spigot', 'bukkit', 'folia']),
  MOD: new Set(['fabric', 'forge', 'neoforge', 'quilt']),
  PROXY: new Set(['velocity', 'waterfall', 'bungeecord']),
} as const;

export type LoaderGroup = keyof typeof LOADER_GROUPS;

export const ALL_LOADERS = new Set([
  ...LOADER_GROUPS.PLUGIN,
  ...LOADER_GROUPS.MOD,
  ...LOADER_GROUPS.PROXY,
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

export function detectServerSoftware(image: Images | null | undefined): string | null {
  if (!image) return null;

  const info = parseImageInfo(image);
  const explicitType = typeof info?.type === 'string' ? info.type.toLowerCase() : '';
  if (explicitType && ALL_LOADERS.has(explicitType)) {
    return explicitType;
  }

  const haystack = collectImageText(image);
  for (const loader of ALL_LOADERS) {
    if (haystack.includes(loader)) {
      return loader;
    }
  }

  return null;
}

export function getLoaderGroup(software: string | null): LoaderGroup | null {
  if (!software) return null;
  for (const [group, loaders] of Object.entries(LOADER_GROUPS)) {
    if (loaders.has(software.toLowerCase())) {
      return group as LoaderGroup;
    }
  }
  return null;
}

export function getGroupLoaders(group: LoaderGroup | null): string[] {
  if (!group) return [];
  return Array.from(LOADER_GROUPS[group]);
}

export function isCompatibleLoader(serverLoader: string | null, versionLoaders: string[]): boolean {
  if (!serverLoader) return false;
  if (!versionLoaders || versionLoaders.length === 0) return true;

  const serverGroup = getLoaderGroup(serverLoader);
  if (!serverGroup) return true;

  const serverGroupLoaders = getGroupLoaders(serverGroup);

  let hasKnownDifferentGroup = false;
  for (const l of versionLoaders) {
    const loader = l.toLowerCase();
    if (serverGroupLoaders.includes(loader)) return true;
    const lGroup = getLoaderGroup(loader);
    if (lGroup === null) return true;
    if (lGroup !== serverGroup) hasKnownDifferentGroup = true;
  }

  return hasKnownDifferentGroup ? false : true;
}

function mcVersionMatch(serverVersion: string, gameVersion: string): boolean {
  if (!serverVersion || !gameVersion) return false;
  gameVersion = gameVersion.replace(/\.x$/i, '');
  const parseMc = (v: string) => {
    const parts = v.split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] ?? 0, patch: parts[2] };
  };
  const sv = parseMc(serverVersion);
  const gv = parseMc(gameVersion);
  if (sv.major !== gv.major) return false;
  if (sv.minor !== gv.minor) return false;
  if (gv.patch === undefined) return true;
  return (sv.patch ?? 0) >= gv.patch;
}

export function isCompatibleMinecraftVersion(serverVersion: string | null, gameVersions: string[]): boolean {
  if (!serverVersion || !gameVersions || !gameVersions.length) return false;
  return gameVersions.some((gv) => mcVersionMatch(serverVersion, gv));
}

export function filterVersionsByGroup(versions: ModrinthVersion[], serverLoader: string | null): ModrinthVersion[] {
  if (!serverLoader) return versions;
  return versions.filter((v) => isCompatibleLoader(serverLoader, v.loaders));
}

export function sortVersions(versions: ModrinthVersion[]): ModrinthVersion[] {
  return [...versions].sort((a, b) => {
    const aIsRelease = a.version_type === 'release' ? 1 : 0;
    const bIsRelease = b.version_type === 'release' ? 1 : 0;
    if (aIsRelease !== bIsRelease) return bIsRelease - aIsRelease;

    const aFeatured = a.featured ? 1 : 0;
    const bFeatured = b.featured ? 1 : 0;
    if (aFeatured !== bFeatured) return bFeatured - aFeatured;

    return new Date(b.date_published || 0).getTime() - new Date(a.date_published || 0).getTime();
  });
}

export interface VersionDebugInfo {
  versionId: string;
  versionName: string;
  versionNumber: string;
  versionType: string;
  loaders: string[];
  gameVersions: string[];
  serverLoader: string | null;
  serverLoaderGroup: string | null;
  loaderAccepted: boolean;
  loaderReason: string;
  mcAccepted: boolean;
  mcReason: string;
  overallAccepted: boolean;
  score: number;
}

function classifyLoaders(versionLoaders: string[], serverGroup: LoaderGroup | null): { hasGroupLoader: boolean; allFromKnownDifferentGroup: boolean; hasUnknown: boolean } {
  let hasGroupLoader = false;
  let hasUnknown = false;
  let hasKnownDifferent = false;

  const groupLoaders = serverGroup ? getGroupLoaders(serverGroup) : [];

  for (const l of versionLoaders) {
    const loader = l.toLowerCase();
    if (serverGroup && groupLoaders.includes(loader)) {
      hasGroupLoader = true;
    } else {
      const lGroup = getLoaderGroup(loader);
      if (lGroup === null) {
        hasUnknown = true;
      } else if (lGroup !== serverGroup) {
        hasKnownDifferent = true;
      }
    }
  }

  const allFromKnownDifferentGroup = !hasGroupLoader && !hasUnknown && hasKnownDifferent;

  return { hasGroupLoader, allFromKnownDifferentGroup, hasUnknown };
}

export function debugVersion(version: ModrinthVersion, serverLoader: string | null, minecraftVersion: string | null): VersionDebugInfo {
  const group = getLoaderGroup(serverLoader);
  const groupLoaders = group ? getGroupLoaders(group) : [];

  let loaderAccepted: boolean;
  let loaderReason: string;

  if (!serverLoader || !group) {
    loaderAccepted = false;
    loaderReason = !serverLoader ? 'No server loader detected' : 'Unknown server type';
  } else if (version.loaders.length === 0) {
    loaderAccepted = true;
    loaderReason = 'No loader metadata - cannot positively reject';
  } else {
    const { hasGroupLoader, allFromKnownDifferentGroup, hasUnknown } = classifyLoaders(version.loaders, group);

    if (hasGroupLoader) {
      loaderAccepted = true;
      loaderReason = `Loader ${version.loaders.filter((l) => groupLoaders.includes(l.toLowerCase())).join(', ')} is in group ${group}`;
    } else if (allFromKnownDifferentGroup) {
      loaderAccepted = false;
      loaderReason = `All loaders (${version.loaders.join(', ')}) belong to a different ecosystem (${group})`;
    } else {
      loaderAccepted = true;
      const unknownLabel = hasUnknown ? ' with unknown loaders' : '';
      loaderReason = `Cannot positively reject${unknownLabel} (loaders: ${version.loaders.join(', ')})`;
    }
  }

  const mcMatch = minecraftVersion
    ? isCompatibleMinecraftVersion(minecraftVersion, version.game_versions)
    : false;
  const mcReason = minecraftVersion
    ? (mcMatch
      ? `Minecraft ${minecraftVersion} matches one of ${version.game_versions.join(', ')}`
      : `Minecraft ${minecraftVersion} does not match any of ${version.game_versions.join(', ')}`)
    : 'No server MC version detected';

  const score = scoreVersion(version, serverLoader, minecraftVersion);

  return {
    versionId: version.id,
    versionName: version.name || version.version_number,
    versionNumber: version.version_number,
    versionType: version.version_type,
    loaders: version.loaders,
    gameVersions: version.game_versions,
    serverLoader,
    serverLoaderGroup: group,
    loaderAccepted,
    loaderReason,
    mcAccepted: mcMatch,
    mcReason,
    overallAccepted: loaderAccepted && (mcMatch || !minecraftVersion),
    score,
  };
}

export function scoreVersion(version: ModrinthVersion, serverLoader: string | null, minecraftVersion: string | null): number {
  let score = 0;

  if (minecraftVersion && isCompatibleMinecraftVersion(minecraftVersion, version.game_versions)) {
    score += 50;
  }

  if (serverLoader && version.loaders.length > 0) {
    const serverGroup = getLoaderGroup(serverLoader);
    if (serverGroup) {
      const groupLoaders = getGroupLoaders(serverGroup);
      if (version.loaders.some((l) => groupLoaders.includes(l.toLowerCase()))) {
        score += 20;
      }
    }
  }

  return score;
}

export function selectBestVersion(
  versions: ModrinthVersion[],
  serverLoader: string | null,
  minecraftVersion: string | null,
): ModrinthVersion | null {
  const sorted = sortVersions(versions);

  let best: ModrinthVersion | null = null;
  let bestScore = -1;

  for (const v of sorted) {
    const s = scoreVersion(v, serverLoader, minecraftVersion);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }

  return best;
}
