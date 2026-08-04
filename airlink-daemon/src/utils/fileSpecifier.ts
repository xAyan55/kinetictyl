import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const specPath = resolve(process.cwd(), 'storage/fileSpecifier.json');

type FileSpecifierData = Record<string, string[]>;

let cached: FileSpecifierData | null = null;

async function load(): Promise<FileSpecifierData> {
  if (cached) return cached;
  try {
    if (existsSync(specPath)) {
      cached = JSON.parse(readFileSync(specPath, 'utf8')) as FileSpecifierData;
      return cached;
    }
    return {};
  } catch {
    return {};
  }
}

async function getCategory(extension: string): Promise<string | null> {
  const data = await load();
  for (const [category, extensions] of Object.entries(data)) {
    if (Array.isArray(extensions) && extensions.includes(extension)) {
      return category;
    }
  }
  return null;
}

export default { getCategory };
