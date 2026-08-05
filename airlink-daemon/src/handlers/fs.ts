import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, isAbsolute, join, relative, resolve } from 'path';
import { create as tarCreate, extract as tarExtract } from 'tar';
import logger from '../logger.js';
import { getServerDir } from './processManager.js';

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  updatedAt: Date;
}

/**
 * Sandboxes the target path strictly inside `servers/<uuid>/`.
 * Prevents directory traversal attacks (e.g. `../../etc/passwd`).
 */
export function getSandboxedPath(uuid: string, relativePath: string = ''): string {
  const rootDir = resolve(getServerDir(uuid));
  const targetPath = resolve(rootDir, relativePath.replace(/^(\/|\\)+/, ''));

  if (!targetPath.startsWith(rootDir)) {
    throw new Error('Access denied: Path traversal outside server directory sandbox');
  }

  return targetPath;
}

export function listDirectory(uuid: string, subPath: string = ''): FileEntry[] {
  const dir = getSandboxedPath(uuid, subPath);
  if (!existsSync(dir)) return [];

  const items = readdirSync(dir, { withFileTypes: true });
  return items.map((item) => {
    const full = join(dir, item.name);
    let size = 0;
    let updatedAt = new Date();
    try {
      const st = statSync(full);
      size = st.size;
      updatedAt = st.mtime;
    } catch {}
    return {
      name: item.name,
      isDir: item.isDirectory(),
      size,
      updatedAt,
    };
  });
}

export function readFileContent(uuid: string, filePath: string): string {
  const full = getSandboxedPath(uuid, filePath);
  if (!existsSync(full) || statSync(full).isDirectory()) {
    throw new Error('File not found or is a directory');
  }
  return readFileSync(full, 'utf8');
}

export function writeFileContent(uuid: string, filePath: string, content: string | Buffer): void {
  const full = getSandboxedPath(uuid, filePath);
  const dir = resolve(full, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(full, content);
}

export function appendFileContent(uuid: string, filePath: string, content: string | Buffer): void {
  const full = getSandboxedPath(uuid, filePath);
  appendFileSync(full, content);
}

export function createEmptyFile(uuid: string, filePath: string): void {
  const full = getSandboxedPath(uuid, filePath);
  if (existsSync(full)) return;
  writeFileSync(full, '', 'utf8');
}

export function makeDirectory(uuid: string, dirPath: string): void {
  const full = getSandboxedPath(uuid, dirPath);
  mkdirSync(full, { recursive: true });
}

export function renameItem(uuid: string, oldPath: string, newPath: string): void {
  const source = getSandboxedPath(uuid, oldPath);
  const target = getSandboxedPath(uuid, newPath);
  renameSync(source, target);
}

export function removeItem(uuid: string, targetPath: string): void {
  const full = getSandboxedPath(uuid, targetPath);
  if (existsSync(full)) {
    rmSync(full, { recursive: true, force: true });
  }
}

export async function compressArchive(uuid: string, targets: string[], archiveName: string): Promise<string> {
  const rootDir = getSandboxedPath(uuid, '');
  const archivePath = getSandboxedPath(uuid, archiveName);

  const relativeTargets = targets.map((t) => relative(rootDir, getSandboxedPath(uuid, t)));

  await tarCreate(
    {
      gzip: true,
      file: archivePath,
      cwd: rootDir,
    },
    relativeTargets,
  );

  return archivePath;
}

export async function extractArchive(uuid: string, archiveName: string, destinationDir: string = ''): Promise<void> {
  const archivePath = getSandboxedPath(uuid, archiveName);
  const destPath = getSandboxedPath(uuid, destinationDir);

  if (!existsSync(archivePath)) throw new Error('Archive file not found');

  await tarExtract({
    file: archivePath,
    cwd: destPath,
  });
}
