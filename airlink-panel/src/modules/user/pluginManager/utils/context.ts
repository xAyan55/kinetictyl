import { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../../../db';
import { isPluginServer } from '../../../../handlers/utils/server/pluginServer';

const serverInclude = {
  node: true,
  image: true,
  owner: true,
} satisfies Prisma.ServerInclude;

export type PluginServerContext = Prisma.ServerGetPayload<{ include: typeof serverInclude }>;

export type LoadedPluginContext =
  | { status: 'ready'; server: PluginServerContext; message?: undefined }
  | { status: 'missing-user'; message: string }
  | { status: 'missing-server'; message: string }
  | { status: 'unsupported'; message: string };

export async function loadPluginServerContext(req: Request, serverId: unknown): Promise<LoadedPluginContext> {
  const userId = req.session?.user?.id;
  if (!userId) {
    return { status: 'missing-user', message: 'Authentication required.' };
  }

  let resolvedId = typeof serverId === 'string' ? serverId.trim() : '';
  if (!resolvedId) {
    const parts = req.originalUrl.split('/');
    const serverIdx = parts.indexOf('server');
    if (serverIdx !== -1 && parts[serverIdx + 1]) {
      resolvedId = parts[serverIdx + 1];
    }
  }

  if (!resolvedId) {
    return { status: 'missing-server', message: 'Server not found.' };
  }

  const server = await prisma.server.findUnique({
    where: { UUID: resolvedId },
    include: serverInclude,
  });

  if (!server) {
    return { status: 'missing-server', message: 'Server not found.' };
  }

  const isOwner = server.ownerId === userId;
  const isAdmin = Boolean(req.session?.user?.isAdmin);
  if (!isOwner && !isAdmin) {
    return { status: 'missing-server', message: 'Server not found.' };
  }

  if (!isPluginServer(server.image)) {
    return {
      status: 'unsupported',
      message: 'Plugin Manager is only available for Paper, Purpur, Spigot, Bukkit, and Folia servers.',
    };
  }

  return { status: 'ready', server };
}

export async function setupPluginManagerDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PluginManagerCache (
      cacheKey TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expiresAt DATETIME NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PluginManagerInstallation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serverId TEXT NOT NULL,
      projectId TEXT,
      projectName TEXT,
      versionId TEXT,
      versionNumber TEXT,
      filename TEXT NOT NULL,
      fileSize INTEGER,
      author TEXT,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'in_progress', 'removed')),
      enabled INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      installedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pm_install_server ON PluginManagerInstallation(serverId)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pm_install_project ON PluginManagerInstallation(serverId, projectId)`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PluginManagerIgnoredUpdate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serverId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      versionId TEXT NOT NULL,
      ignoredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(serverId, projectId)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PluginManagerBackup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serverId TEXT NOT NULL,
      filename TEXT NOT NULL,
      filePath TEXT NOT NULL,
      reason TEXT NOT NULL,
      fileSize INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
