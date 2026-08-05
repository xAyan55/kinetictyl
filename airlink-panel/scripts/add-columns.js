/**
 * Run this with: node scripts/add-columns.js
 *
 * Adds all new columns to an existing database without touching existing data.
 * Safe to run multiple times — silently skips columns that already exist.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const columns = [
  { table: 'settings', name: 'loginWallpaper',      def: 'TEXT' },
  { table: 'settings', name: 'registerWallpaper',   def: 'TEXT' },
  { table: 'settings', name: 'loginMaxAttempts',    def: 'INTEGER NOT NULL DEFAULT 5' },
  { table: 'settings', name: 'loginLockoutMinutes', def: 'INTEGER NOT NULL DEFAULT 15' },
  { table: 'settings', name: 'enforceDaemonHttps',  def: 'BOOLEAN NOT NULL DEFAULT false' },
  { table: 'settings', name: 'behindReverseProxy',  def: 'BOOLEAN NOT NULL DEFAULT false' },
  { table: 'settings', name: 'hashApiKeys',         def: 'BOOLEAN NOT NULL DEFAULT false' },
  { table: 'Users',    name: 'loginAttempts',       def: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'Users',    name: 'lockedUntil',         def: 'DATETIME' },
];

async function main() {
  for (const col of columns) {
    try {
      const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${col.table}")`);
      const exists = Array.isArray(rows) && rows.some(r => r.name === col.name);
      if (exists) {
        console.log(`  skip  ${col.table}.${col.name} (already exists)`);
      } else {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${col.table}" ADD COLUMN "${col.name}" ${col.def}`);
        console.log(`  added ${col.table}.${col.name}`);
      }
    } catch (e) {
      console.warn(`  error processing ${col.table}.${col.name}: ${e.message}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

