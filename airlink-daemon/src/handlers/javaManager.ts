import { execSync, spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import logger from '../logger.js';

export interface JavaInfo {
  version: string; // e.g. "8", "11", "17", "21"
  path: string;
  vendor?: string;
  isDefault?: boolean;
}

const detectedJavas = new Map<string, string>(); // version -> binary path

export function detectSystemJava(): Map<string, string> {
  detectedJavas.clear();

  // Check system PATH default java
  try {
    const res = spawnSync('java', ['-version'], { encoding: 'utf8' });
    const output = (res.stdout || '') + (res.stderr || '');
    const versionMatch = output.match(/version "([^"]+)"/i) || output.match(/openjdk version "([^"]+)"/i);
    if (versionMatch && versionMatch[1]) {
      const fullVer = versionMatch[1];
      const major = parseJavaMajorVersion(fullVer);
      detectedJavas.set(major, 'java');
      logger.ok(`Detected system default Java ${major} (${fullVer})`);
    }
  } catch {
    logger.warn('Default system java not found in PATH');
  }

  // Common Linux/Unix JVM installation paths
  const commonPaths = [
    '/usr/lib/jvm',
    '/usr/lib64/jvm',
    '/usr/local/openjdk-8/bin',
    '/usr/local/openjdk-11/bin',
    '/usr/local/openjdk-17/bin',
    '/usr/local/openjdk-21/bin',
    'C:\\Program Files\\Java',
    'C:\\Program Files (x86)\\Java',
  ];

  for (const basePath of commonPaths) {
    if (!existsSync(basePath)) continue;
    try {
      const entries = readdirSync(basePath);
      for (const entry of entries) {
        const fullPath = join(basePath, entry, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        if (existsSync(fullPath)) {
          try {
            const res = spawnSync(fullPath, ['-version'], { encoding: 'utf8' });
            const output = (res.stdout || '') + (res.stderr || '');
            const versionMatch = output.match(/version "([^"]+)"/i) || output.match(/openjdk version "([^"]+)"/i);
            if (versionMatch && versionMatch[1]) {
              const major = parseJavaMajorVersion(versionMatch[1]);
              if (!detectedJavas.has(major)) {
                detectedJavas.set(major, fullPath);
                logger.ok(`Detected Java ${major} at ${fullPath}`);
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  // Fallbacks if a specific version wasn't explicitly found
  if (!detectedJavas.has('17')) detectedJavas.set('17', 'java');
  if (!detectedJavas.has('21')) detectedJavas.set('21', detectedJavas.get('17') || 'java');
  if (!detectedJavas.has('11')) detectedJavas.set('11', detectedJavas.get('17') || 'java');
  if (!detectedJavas.has('8')) detectedJavas.set('8', detectedJavas.get('11') || 'java');

  return detectedJavas;
}

export function getJavaBinary(version: string): string {
  if (detectedJavas.size === 0) {
    detectSystemJava();
  }
  const cleanVer = parseJavaMajorVersion(version);
  return detectedJavas.get(cleanVer) || detectedJavas.get('17') || 'java';
}

function parseJavaMajorVersion(verStr: string): string {
  if (verStr.startsWith('1.8')) return '8';
  const parts = verStr.split('.');
  if (parts[0] === '1') return parts[1] || '8';
  return parts[0] || '17';
}

export function getAvailableJavaVersions(): JavaInfo[] {
  if (detectedJavas.size === 0) {
    detectSystemJava();
  }
  const list: JavaInfo[] = [];
  detectedJavas.forEach((path, version) => {
    list.push({ version, path });
  });
  return list;
}
