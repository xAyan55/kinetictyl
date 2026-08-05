import { access, readdir, readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { getServerDir } from '../processManager.js';

export interface RadarPattern {
  type: 'filename' | 'extension' | 'content';
  pattern: string;
  description: string;
  content?: string;
  size_less_than?: number;
  size_greater_than?: number;
}

export interface RadarScript {
  name: string;
  description: string;
  version: string;
  patterns: RadarPattern[];
}

interface ScanResult {
  pattern: RadarPattern;
  matches: { path: string; size?: number }[];
}

async function walkDir(dir: string, baseDir: string, fileList: string[] = []): Promise<string[]> {
  const files = await readdir(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = join(dir, file.name);
    const relPath = fullPath.replace(baseDir + '/', '').replace(baseDir + '\\', '');
    if (file.isDirectory()) {
      await walkDir(fullPath, baseDir, fileList);
    } else {
      fileList.push(relPath);
    }
  }
  return fileList;
}

export async function scanVolume(id: string, script: RadarScript): Promise<ScanResult[]> {
  const baseDirectory = getServerDir(id);

  try {
    await access(baseDirectory);
  } catch {
    throw new Error(`Server directory for ${id} does not exist`);
  }

  const results: ScanResult[] = [];
  const allFiles = await walkDir(baseDirectory, baseDirectory);

  for (const pattern of script.patterns) {
    const scanResult: ScanResult = { pattern, matches: [] };

    for (const file of allFiles) {
      const filePath = join(baseDirectory, file);
      const fileStats = await stat(filePath).catch(() => null);
      if (!fileStats || fileStats.isDirectory()) continue;

      if (pattern.type === 'filename' && !file.toLowerCase().includes(pattern.pattern.toLowerCase())) {
        continue;
      }
      if (pattern.type === 'extension' && !file.toLowerCase().endsWith(pattern.pattern.toLowerCase())) {
        continue;
      }

      if (pattern.size_less_than && fileStats.size >= pattern.size_less_than) continue;
      if (pattern.size_greater_than && fileStats.size <= pattern.size_greater_than) continue;

      if (pattern.content && fileStats.size < 10 * 1024 * 1024) {
        try {
          const content = await readFile(filePath, 'utf-8');
          const re = new RegExp(pattern.content, 'i');
          if (!re.test(content)) continue;
        } catch {
          continue;
        }
      }

      scanResult.matches.push({ path: file, size: fileStats.size });
    }

    if (scanResult.matches.length > 0) results.push(scanResult);
  }

  return results;
}
