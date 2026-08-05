import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
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
  { id: 'fabric', name: 'Fabric', description: 'Lightweight, modular modding toolchain for Minecraft', defaultJava: '21' },
  { id: 'velocity', name: 'Velocity', description: 'Next-generation Minecraft proxy server', defaultJava: '21' },
  { id: 'waterfall', name: 'Waterfall', description: 'BungeeCord fork with improved stability and security', defaultJava: '21' },
];

const MCJARS_API_BASE = 'https://api.mcjars.app/v2';

export async function fetchMcJarsVersions(type: string): Promise<string[]> {
  const cleanType = type.toLowerCase();
  try {
    const res = await fetch(`${MCJARS_API_BASE}/builds/${cleanType}`);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      if (Array.isArray(data.versions)) {
        return data.versions.map(String);
      }
      if (typeof data === 'object' && data !== null) {
        return Object.keys(data);
      }
    }
  } catch (err) {
    logger.warn(`MCJars API error fetching versions for ${type}: ${err}`);
  }

  // Fallback versions if offline
  return ['1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'];
}

export async function downloadServerJar(type: string, version: string, destinationPath: string, onLog?: (msg: string) => void): Promise<boolean> {
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

  // 1. Dedicated PaperMC API provider (fetches exact latest build)
  if (cleanType === 'paper') {
    try {
      log(`Checking PaperMC API for version ${version}...`);
      const vRes = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${version}`);
      if (vRes.ok) {
        const vData = (await vRes.json()) as any;
        if (Array.isArray(vData.builds) && vData.builds.length > 0) {
          const latestBuild = vData.builds[vData.builds.length - 1];
          const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/paper-${version}-${latestBuild}.jar`;
          log(`Fetching Paper build #${latestBuild}...`);
          const res = await fetch(downloadUrl, { redirect: 'follow' });
          if (res.ok && res.body) {
            const fileStream = createWriteStream(destinationPath);
            // @ts-ignore
            await pipeline(res.body, fileStream);
            log(`Successfully downloaded Paper ${version} build #${latestBuild}.`);
            return true;
          }
        }
      }
    } catch (err) {
      log(`PaperMC direct download notice: ${err}`);
    }
  }

  // 2. Dedicated Purpur API provider
  if (cleanType === 'purpur') {
    try {
      log(`Checking Purpur API for version ${version}...`);
      const downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
      const res = await fetch(downloadUrl, { redirect: 'follow' });
      if (res.ok && res.body) {
        const fileStream = createWriteStream(destinationPath);
        // @ts-ignore
        await pipeline(res.body, fileStream);
        log(`Successfully downloaded Purpur ${version}.`);
        return true;
      }
    } catch (err) {
      log(`Purpur direct download notice: ${err}`);
    }
  }

  // 3. Dedicated Mojang Vanilla Provider
  if (cleanType === 'vanilla') {
    try {
      log(`Checking Mojang Manifest for Vanilla version ${version}...`);
      const mRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      if (mRes.ok) {
        const mData = (await mRes.json()) as any;
        const entry = mData.versions?.find((v: any) => v.id === version);
        if (entry && entry.url) {
          const pRes = await fetch(entry.url);
          if (pRes.ok) {
            const pData = (await pRes.json()) as any;
            const downloadUrl = pData.downloads?.server?.url;
            if (downloadUrl) {
              const res = await fetch(downloadUrl, { redirect: 'follow' });
              if (res.ok && res.body) {
                const fileStream = createWriteStream(destinationPath);
                // @ts-ignore
                await pipeline(res.body, fileStream);
                log(`Successfully downloaded Vanilla ${version} via Mojang.`);
                return true;
              }
            }
          }
        }
      }
    } catch (err) {
      log(`Mojang Vanilla download notice: ${err}`);
    }
  }

  // 4. Dedicated Fabric Provider
  if (cleanType === 'fabric') {
    try {
      log(`Checking Fabric Meta API for version ${version}...`);
      const downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/0.16.10/1.0.1/server/jar`;
      const res = await fetch(downloadUrl, { redirect: 'follow' });
      if (res.ok && res.body) {
        const fileStream = createWriteStream(destinationPath);
        // @ts-ignore
        await pipeline(res.body, fileStream);
        log(`Successfully downloaded Fabric ${version} via Fabric Meta API.`);
        return true;
      }
    } catch (err) {
      log(`Fabric download notice: ${err}`);
    }
  }

  // 5. MCJars & ServerJars endpoints
  const mirrorUrls = [
    `https://api.mcjars.app/v2/download/${cleanType}/${version}/latest`,
    `https://api.mcjars.app/v2/download/${cleanType}/${version}`,
    `https://serverjars.com/api/v1/download/servers/${cleanType}/${version}`,
    `https://serverjars.com/api/v1/download/${cleanType}/${version}`,
  ];

  for (const url of mirrorUrls) {
    try {
      log(`Trying fallback mirror: ${url}`);
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok && res.body) {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('html') && !contentType.includes('json')) {
          const fileStream = createWriteStream(destinationPath);
          // @ts-ignore
          await pipeline(res.body, fileStream);
          log(`Successfully downloaded ${cleanType} ${version} via mirror.`);
          return true;
        }
      }
    } catch {}
  }

  throw new Error(`Failed to download server jar for ${cleanType} ${version}`);
}
