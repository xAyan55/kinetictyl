import { readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { create as tarCreate } from 'tar';
import { getServerDir } from '../processManager.js';

export interface ZipOptions {
  include?: string[];
  exclude?: string[];
  maxFileSizeMb?: number;
}

export async function zipScanVolume(id: string, options: ZipOptions = {}): Promise<Buffer> {
  const baseDir = getServerDir(id);
  const tarPath = join(tmpdir(), `kinetictyl-radar-${id}-${Date.now()}.tar.gz`);

  try {
    await tarCreate(
      {
        gzip: true,
        file: tarPath,
        cwd: baseDir,
        filter: (p) => !p.startsWith('backups'),
      },
      ['.'],
    );

    const buffer = readFileSync(tarPath);
    return buffer;
  } finally {
    try {
      rmSync(tarPath, { force: true });
    } catch {}
  }
}
