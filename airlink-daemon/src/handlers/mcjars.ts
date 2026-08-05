import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import logger from '../logger.js';

export interface SoftwareCategory {
  id: string;
  name: string;
  description: string;
  defaultJava: string;
}

export const SUPPORTED_SOFTWARE: SoftwareCategory[] = [
  { id: 'paper', name: 'Paper', description: 'High performance Minecraft server software', defaultJava: '21' },
  { id: 'purpur', name: 'Purpur', description: 'Drop-in replacement for Paper designed for performance & customization', defaultJava: '21' },
  { id: 'spigot', name: 'Spigot', description: 'High performance Minecraft server software derived from CraftBukkit', defaultJava: '21' },
  { id: 'vanilla', name: 'Vanilla', description: 'Official Minecraft server software from Mojang', defaultJava: '21' },
  { id: 'forge', name: 'Forge', description: 'Popular modded server platform for Minecraft', defaultJava: '21' },
  { id: 'neoforge', name: 'NeoForge', description: 'Modern modded server platform for Minecraft', defaultJava: '21' },
  { id: 'fabric', name: 'Fabric', description: 'Lightweight, modular modding toolchain for Minecraft', defaultJava: '21' },
  { id: 'folia', name: 'Folia', description: 'Multi-threaded Paper fork for huge player counts', defaultJava: '21' },
  { id: 'pufferfish', name: 'Pufferfish', description: 'High-performance Paper fork optimized for large servers', defaultJava: '21' },
  { id: 'velocity', name: 'Velocity', description: 'Next-generation Minecraft proxy server', defaultJava: '21' },
  { id: 'waterfall', name: 'Waterfall', description: 'BungeeCord fork with improved stability and security', defaultJava: '21' },
  { id: 'bungeecord', name: 'BungeeCord', description: 'Classic Minecraft proxy server software', defaultJava: '21' },
  { id: 'mohist', name: 'Mohist', description: 'Forge & Paper hybrid server software', defaultJava: '21' },
  { id: 'arclight', name: 'Arclight', description: 'Mixins-based Forge & Paper hybrid', defaultJava: '21' },
  { id: 'sponge', name: 'SpongeVanilla', description: 'Sponge plugin platform for Vanilla Minecraft', defaultJava: '21' },
  { id: 'leaves', name: 'Leaves', description: 'Paper fork aimed at restoring vanilla mechanics', defaultJava: '21' },
  { id: 'divinemc', name: 'DivineMC', description: 'Purpur fork tailored for high performance and features', defaultJava: '21' },
  { id: 'leaf', name: 'Leaf', description: 'Paper fork focused on performance optimizations', defaultJava: '21' },
];

const MCJARS_V3_BASE = 'https://mcjars.app/api/v3';

// MCJars ServerType must be UPPERCASE per api-1.json spec
const TYPE_MAP: Record<string, string> = {
  paper: 'PAPER', purpur: 'PURPUR', spigot: 'SPIGOT', vanilla: 'VANILLA',
  forge: 'FORGE', neoforge: 'NEOFORGE', fabric: 'FABRIC', folia: 'FOLIA',
  pufferfish: 'PUFFERFISH', velocity: 'VELOCITY', waterfall: 'WATERFALL',
  bungeecord: 'BUNGEECORD', mohist: 'MOHIST', arclight: 'ARCLIGHT',
  sponge: 'SPONGE', leaves: 'LEAVES', divinemc: 'DIVINEMC', leaf: 'LEAF',
  quilt: 'QUILT', canvas: 'CANVAS', magma: 'MAGMA',
};

export async function fetchMcJarsVersions(type: string): Promise<string[]> {
  const mcType = TYPE_MAP[type.toLowerCase()] || type.toUpperCase();
  try {
    const res = await fetch(`${MCJARS_V3_BASE}/builds/types/${mcType}/versions`, {
      headers: DEFAULT_HEADERS,
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      // v3 returns { versions: { "1.21": ["1.21.4", ...], ... } }
      if (data.versions && typeof data.versions === 'object') {
        const all: string[] = [];
        for (const group of Object.values(data.versions) as string[][]) {
          if (Array.isArray(group)) all.push(...group);
        }
        return all;
      }
    }
  } catch (err) {
    logger.warn(`MCJars v3 API error fetching versions for ${type}: ${err}`);
  }

  return ['1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'];
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Kinetictyl-Panel/1.0 (https://github.com/xAyan55/kinetictyl)',
  'Accept': '*/*',
};

async function downloadToFileWithProgress(
  url: string,
  destinationPath: string,
  log: (msg: string) => void,
): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
    if (!res.ok || !res.body) return false;

    const contentLength = Number(res.headers.get('content-length')) || 0;
    if (contentLength > 0) {
      log(`File size: ${(contentLength / (1024 * 1024)).toFixed(1)} MB`);
    }

    // @ts-ignore - Node fetch body is a ReadableStream
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    let lastLoggedPct = -20;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;

      if (contentLength > 0) {
        const pct = Math.floor((receivedBytes / contentLength) * 100);
        if (pct >= lastLoggedPct + 20 || pct >= 100) {
          lastLoggedPct = pct;
          const recMB = (receivedBytes / (1024 * 1024)).toFixed(1);
          const totMB = (contentLength / (1024 * 1024)).toFixed(1);
          log(`Download progress: ${pct}% (${recMB} MB / ${totMB} MB)`);
        }
      }
    }

    if (receivedBytes < 1000) return false;

    const combined = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Verify ZIP/JAR PK magic header (0x50 0x4B)
    if (combined[0] !== 0x50 || combined[1] !== 0x4B) return false;

    writeFileSync(destinationPath, combined);
    return true;
  } catch {
    return false;
  }
}

export async function downloadServerJar(
  type: string,
  version: string,
  destinationPath: string,
  onLog?: (msg: string) => void,
): Promise<boolean> {
  const cleanType = type.toLowerCase();
  const dir = dirname(destinationPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const log = (msg: string) => {
    logger.info(msg);
    if (onLog) onLog(msg);
  };

  log(`Downloading server jar for ${cleanType} ${version} to ${destinationPath}`);

  // ─── 1. MCJars v3 API (Universal — works for ALL server types) ───
  {
    const mcType = TYPE_MAP[cleanType] || cleanType.toUpperCase();
    try {
      log(`Querying MCJars v3 API for ${mcType} ${version}...`);
      const res = await fetch(
        `${MCJARS_V3_BASE}/builds/types/${mcType}/versions/${version}/latest?fields=installation`,
        { headers: DEFAULT_HEADERS },
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const steps: any[] = data.build?.installation?.[0];
        if (Array.isArray(steps)) {
          const dlStep = steps.find((s: any) => s.type === 'download');
          if (dlStep?.url) {
            log(`MCJars found ${mcType} ${version} — downloading from ${dlStep.url.substring(0, 80)}...`);
            if (await downloadToFileWithProgress(dlStep.url, destinationPath, log)) {
              log(`Successfully installed ${mcType} ${version} via MCJars.`);
              return true;
            }
            log(`MCJars download URL returned invalid file, trying fallbacks...`);
          }
        }
      }
    } catch (err) {
      log(`MCJars v3 notice: ${err}`);
    }
  }

  // ─── 2. PaperMC v3 (fill.papermc.io) — Paper & Folia only ───
  if (cleanType === 'paper' || cleanType === 'folia') {
    try {
      const project = cleanType === 'folia' ? 'folia' : 'paper';
      log(`Trying PaperMC v3 API for ${project.toUpperCase()} ${version}...`);
      const vRes = await fetch(
        `https://fill.papermc.io/v3/projects/${project}/versions/${version}`,
        { headers: DEFAULT_HEADERS },
      );
      if (vRes.ok) {
        const vData = (await vRes.json()) as any;
        if (Array.isArray(vData.builds) && vData.builds.length > 0) {
          const latestBuild = vData.builds[0];
          const bRes = await fetch(
            `https://fill.papermc.io/v3/projects/${project}/versions/${version}/builds/${latestBuild}`,
            { headers: DEFAULT_HEADERS },
          );
          if (bRes.ok) {
            const bData = (await bRes.json()) as any;
            const downloadUrl = bData.downloads?.['server:default']?.url;
            if (downloadUrl) {
              log(`PaperMC build #${latestBuild} — downloading...`);
              if (await downloadToFileWithProgress(downloadUrl, destinationPath, log)) {
                log(`Successfully downloaded ${project.toUpperCase()} ${version} build #${latestBuild}.`);
                return true;
              }
            }
          }
        }
      }
    } catch (err) {
      log(`PaperMC v3 notice: ${err}`);
    }
  }

  // ─── 3. Purpur API ───
  if (cleanType === 'purpur' || cleanType === 'paper' || cleanType === 'pufferfish') {
    try {
      log(`Trying Purpur API for ${version}...`);
      const url = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
      if (await downloadToFileWithProgress(url, destinationPath, log)) {
        log(`Successfully downloaded via Purpur provider.`);
        return true;
      }
    } catch (err) {
      log(`Purpur notice: ${err}`);
    }
  }

  // ─── 4. Mojang Official Manifest — Vanilla / Paper / Spigot ───
  if (cleanType === 'vanilla' || cleanType === 'paper' || cleanType === 'spigot') {
    try {
      log(`Trying Mojang official manifest for ${version}...`);
      const mRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { headers: DEFAULT_HEADERS });
      if (mRes.ok) {
        const mData = (await mRes.json()) as any;
        const entry = mData.versions?.find((v: any) => v.id === version);
        if (entry?.url) {
          const pRes = await fetch(entry.url, { headers: DEFAULT_HEADERS });
          if (pRes.ok) {
            const pData = (await pRes.json()) as any;
            const downloadUrl = pData.downloads?.server?.url;
            if (downloadUrl) {
              log(`Downloading official Mojang server.jar for ${version}...`);
              if (await downloadToFileWithProgress(downloadUrl, destinationPath, log)) {
                log(`Successfully downloaded Vanilla ${version} via Mojang.`);
                return true;
              }
            }
          }
        }
      }
    } catch (err) {
      log(`Mojang notice: ${err}`);
    }
  }

  // ─── 5. Fabric Meta API ───
  if (cleanType === 'fabric') {
    try {
      log(`Trying Fabric Meta API for ${version}...`);
      const url = `https://meta.fabricmc.net/v2/versions/loader/${version}/0.16.10/1.0.1/server/jar`;
      if (await downloadToFileWithProgress(url, destinationPath, log)) {
        log(`Successfully downloaded Fabric ${version}.`);
        return true;
      }
    } catch (err) {
      log(`Fabric notice: ${err}`);
    }
  }

  throw new Error(`Failed to download server jar for ${cleanType} ${version}`);
}
