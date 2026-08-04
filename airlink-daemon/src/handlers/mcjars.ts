import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import logger from '../logger';

export interface SoftwareCategory {
  id: string;
  name: string;
  description: string;
  defaultJava: string;
}

export const SUPPORTED_SOFTWARE: SoftwareCategory[] = [
  { id: 'paper', name: 'Paper', description: 'High performance Minecraft server software', defaultJava: '17' },
  { id: 'purpur', name: 'Purpur', description: 'Drop-in replacement for Paper designed for performance & customization', defaultJava: '17' },
  { id: 'spigot', name: 'Spigot', description: 'High performance Minecraft server software derived from CraftBukkit', defaultJava: '17' },
  { id: 'vanilla', name: 'Vanilla', description: 'Official Minecraft server software from Mojang', defaultJava: '17' },
  { id: 'forge', name: 'Forge', description: 'Popular modded server platform for Minecraft', defaultJava: '17' },
  { id: 'fabric', name: 'Fabric', description: 'Lightweight, modular modding toolchain for Minecraft', defaultJava: '17' },
  { id: 'velocity', name: 'Velocity', description: 'Next-generation Minecraft proxy server', defaultJava: '17' },
  { id: 'waterfall', name: 'Waterfall', description: 'BungeeCord fork with improved stability and security', defaultJava: '17' },
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
  return ['1.20.4', '1.20.2', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'];
}

export async function downloadServerJar(type: string, version: string, destinationPath: string): Promise<boolean> {
  const cleanType = type.toLowerCase();
  const dir = dirname(destinationPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Primary source: MCJars API download link
  const mcjarsUrl = `${MCJARS_API_BASE}/download/${cleanType}/${version}/latest`;
  logger.info(`Downloading server jar from MCJars: ${cleanType} ${version} to ${destinationPath}`);

  try {
    const res = await fetch(mcjarsUrl, { redirect: 'follow' });
    if (res.ok && res.body) {
      const fileStream = createWriteStream(destinationPath);
      // Node 20 fetch stream pipeline
      // @ts-ignore
      await pipeline(res.body, fileStream);
      logger.ok(`Successfully downloaded ${cleanType} ${version} jar via MCJars`);
      return true;
    }
  } catch (err) {
    logger.warn(`MCJars download failed for ${cleanType} ${version}, attempting secondary endpoint: ${err}`);
  }

  // Direct download fallbacks for popular server types if MCJars fails
  let directUrl = '';
  if (cleanType === 'paper') {
    directUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/latest/downloads/paper-${version}-latest.jar`;
  } else if (cleanType === 'purpur') {
    directUrl = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
  }

  if (directUrl) {
    try {
      const res = await fetch(directUrl, { redirect: 'follow' });
      if (res.ok && res.body) {
        const fileStream = createWriteStream(destinationPath);
        // @ts-ignore
        await pipeline(res.body, fileStream);
        logger.ok(`Successfully downloaded jar via direct fallback: ${directUrl}`);
        return true;
      }
    } catch (err) {
      logger.error(`Fallback download failed for ${cleanType} ${version}`, err);
    }
  }

  throw new Error(`Failed to download server jar for ${cleanType} ${version}`);
}
