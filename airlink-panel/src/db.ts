import { PrismaClient } from '@prisma/client';

declare const require: any;
declare const process: any;

const fs = require('fs');
const path = require('path');

// Load .env early so DATABASE_URL is available
const envPath = path.resolve(process.cwd(), '.env');
try {
  const data = fs.readFileSync(envPath, 'utf8');
  for (const line of data.split('\n')) {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env may not exist in all environments
}

function resolveDbUrl(raw: string): string {
  if (!raw.startsWith('file:')) return raw;
  const relPath = raw.slice('file:'.length);
  const absPath = path.resolve(process.cwd(), relPath);
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return `file:${absPath}`;
}

const rawUrl = process.env.DATABASE_URL || 'file:./storage/dev.db';
const dbUrl = resolveDbUrl(rawUrl);
process.env.DATABASE_URL = dbUrl;

const prisma = new PrismaClient();

export default prisma;
