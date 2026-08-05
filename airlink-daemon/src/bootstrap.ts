// this module runs its logic immediately when imported.
// it must be the first import in app.ts so it runs before config.ts reads env.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function getFileContent(filePath: string, fallback: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8');
    }
  } catch {
    // fallback
  }
  return fallback;
}

const defaultEnvContent = `remote=http://localhost:3000
key=default_key_change_me_12345
port=3001
DEBUG=false
version=1.0.0
environment=production
STATS_INTERVAL=10000
`;

const defaultConfigContent = `{
  "meta": {
    "version": "1.0.1",
    "codename": "Glazzer Fridge"
  }
}`;

const defaultFileSpecifierContent = `{
  "Web Development": ["html", "css", "js", "ts", "jsx", "vue", "scss", "php"],
  "Documents": ["pdf", "docx", "txt", "xlsx", "pptx", "md", "odt"],
  "Images": ["jpg", "png", "gif", "bmp", "svg", "tiff", "webp"],
  "Videos": ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm"],
  "Audio": ["mp3", "wav", "aac", "flac", "ogg", "m4a"],
  "Archives": ["zip", "rar", "7z", "tar", "gz", "bz2"],
  "Code": ["c", "cpp", "java", "py", "rb", "go", "rs", "cs", "sh", "bat"],
  "System Files": ["dll", "exe", "sys", "so", "bin", "deb", "rpm"],
  "Configuration Files": ["json", "yaml", "xml", "ini", "env", "conf", "properties"],
  "Database Files": ["db", "sqlite", "sql", "csv"]
}`;

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

const envPath = join(process.cwd(), '.env');

if (!existsSync(envPath)) {
  const exampleEnvPath = join(process.cwd(), 'example.env');
  const envTemplate = getFileContent(exampleEnvPath, defaultEnvContent);
  writeFileSync(envPath, envTemplate, 'utf-8');
  const defaults = parseEnv(envTemplate);
  for (const [key, val] of Object.entries(defaults)) {
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
  process.stdout.write('no .env found, so I made one with defaults. tweak it and restart when ready.\n');
}

for (const dir of ['logs', 'storage', 'storage/alc', 'storage/alc/files', 'volumes', 'backups']) {
  mkdirSync(dir, { recursive: true });
}

if (!existsSync('storage/config.json')) {
  writeFileSync('storage/config.json', defaultConfigContent, 'utf-8');
}

if (!existsSync('storage/fileSpecifier.json')) {
  writeFileSync('storage/fileSpecifier.json', defaultFileSpecifierContent, 'utf-8');
}
