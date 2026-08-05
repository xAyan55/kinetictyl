import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'fs';
import { basename, join, resolve } from 'path';
import { create as tarCreate, extract as tarExtract } from 'tar';
import { downloadServerJar, fetchMcJarsVersions } from '../handlers/mcjars.js';
import {
  getServerDir,
  getServerMetrics,
  getServerStatus,
  killServer,
  prepareServerFiles,
  restartServer,
  sendCommand,
  startServer,
  stopServer,
} from '../handlers/processManager.js';
import logger from '../logger.js';
import { validateContainerId } from '../validation.js';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleContainerInstaller(req: Request): Promise<Response> {
  let body: {
    id?: string;
    softwareType?: string;
    softwareVersion?: string;
    javaVersion?: string;
    port?: number;
    memory?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }

  const { id, softwareType = 'paper', softwareVersion = 'latest', javaVersion = '17', port = 25565, memory = 1024 } = body;
  if (!id) return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  const serverDir = getServerDir(id);
  const targetJarPath = join(serverDir, 'server.jar');

  try {
    let ver = softwareVersion;
    if (!ver || ver === 'latest') {
      const versions = await fetchMcJarsVersions(softwareType);
      ver = versions[0] || '1.21.4';
    }

    logger.info(`Installing server ${id} (${softwareType} ${ver})`);
    await downloadServerJar(softwareType, ver, targetJarPath);
    prepareServerFiles({
      uuid: id,
      memory,
      port,
      javaVersion,
      softwareType,
      softwareVersion,
    });
    return json({ message: `Server ${id} installed successfully` });
  } catch (error) {
    logger.error(`Error installing server ${id}:`, error);
    return json({ error: `Failed to install server ${id}` }, 500);
  }
}

export async function handleContainerInstall(req: Request): Promise<Response> {
  return handleContainerInstaller(req);
}

export async function handleContainerInstallStatus(_req: Request, params: Record<string, string>): Promise<Response> {
  const id = params.id;
  if (!id) return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  const status = getServerStatus(id);
  return json({ containerId: id, state: status.state });
}

export async function handleContainerStart(req: Request): Promise<Response> {
  let body: {
    id?: string;
    Memory?: number;
    memory?: number;
    ports?: string;
    port?: number;
    javaVersion?: string;
    softwareType?: string;
    softwareVersion?: string;
    StartCommand?: string;
    startupFlags?: string;
    onlineMode?: boolean;
    whitelistEnabled?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }

  const { id } = body;
  if (!id) return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  const mem = body.Memory || body.memory || 1024;
  let parsedPort = body.port || 25565;
  if (body.ports) {
    const firstPort = parseInt(body.ports.split(',')[0], 10);
    if (!isNaN(firstPort)) parsedPort = firstPort;
  }

  try {
    await startServer({
      uuid: id,
      memory: mem,
      port: parsedPort,
      javaVersion: body.javaVersion || '17',
      softwareType: body.softwareType || 'paper',
      softwareVersion: body.softwareVersion || 'latest',
      startupFlags: body.startupFlags || body.StartCommand || '',
      onlineMode: body.onlineMode,
      whitelistEnabled: body.whitelistEnabled,
    });
    return json({ message: `Server ${id} started successfully` });
  } catch (error) {
    logger.error(`Error starting server ${id}:`, error);
    return json({ error: `Failed to start server ${id}` }, 500);
  }
}

export async function handleContainerStop(req: Request): Promise<Response> {
  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id) return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(body.id)) return json({ error: 'invalid server ID' }, 400);

  try {
    await stopServer(body.id);
    return json({ message: `Server ${body.id} stopped successfully` });
  } catch (err) {
    logger.error('Error stopping server:', err);
    return json({ error: `Failed to stop server ${body.id}` }, 500);
  }
}

export async function handleContainerKill(req: Request): Promise<Response> {
  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id || !validateContainerId(body.id)) return json({ error: 'valid server ID required' }, 400);

  try {
    await killServer(body.id);
    return json({ message: `Server ${body.id} killed` });
  } catch (err) {
    logger.error('Error killing server:', err);
    return json({ error: `Failed to kill server ${body.id}` }, 500);
  }
}

export async function handleContainerCommand(req: Request): Promise<Response> {
  let body: { id?: string; command?: string; args?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id || !validateContainerId(body.id)) return json({ error: 'invalid server ID' }, 400);

  const command = (body.command || body.args?.[0] || '').trim();
  if (!command) return json({ error: 'command is required' }, 400);

  try {
    sendCommand(body.id, command);
    return json({ message: `Command sent to server ${body.id}` });
  } catch (err) {
    logger.error('Error sending command:', err);
    return json({ error: `Failed to send command to server ${body.id}` }, 500);
  }
}

export async function handleContainerDelete(req: Request): Promise<Response> {
  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id || !validateContainerId(body.id)) return json({ error: 'valid server ID required' }, 400);

  try {
    await killServer(body.id);
    const serverDir = getServerDir(body.id);
    if (existsSync(serverDir)) {
      rmSync(serverDir, { recursive: true, force: true });
    }
    return json({ message: `Server ${body.id} deleted` });
  } catch (err) {
    logger.error('Error deleting server:', err);
    return json({ error: `Failed to delete server ${body.id}` }, 500);
  }
}

export async function handleContainerStatus(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  const status = getServerStatus(id);
  return json({
    running: status.running,
    exists: true,
    status: status.state.toLowerCase(),
    pid: status.pid,
    uptime: status.uptime,
  });
}

export async function handleContainerStats(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json({ error: 'server ID is required' }, 400);
  if (!validateContainerId(id)) return json({ error: 'invalid server ID' }, 400);

  const metrics = await getServerMetrics(id);
  return json({
    running: metrics.running,
    exists: true,
    memory: {
      usage: metrics.memory * 1024 * 1024,
      limit: metrics.maxMemory * 1024 * 1024,
      percentage: metrics.maxMemory > 0 ? (metrics.memory / metrics.maxMemory) * 100 : 0,
    },
    cpu: { percentage: metrics.cpu },
    storage: { usage: metrics.disk },
  });
}

export async function handleContainerBackup(req: Request): Promise<Response> {
  let body: { id?: string; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id) return json({ error: 'server ID is required' }, 400);
  if (!body.name) return json({ error: 'backup name is required' }, 400);
  if (!validateContainerId(body.id)) return json({ error: 'invalid server ID' }, 400);

  const serverDir = getServerDir(body.id);

  try {
    const backupsDir = join(serverDir, 'backups');
    if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });

    const backupUuid = crypto.randomUUID();
    const backupFileName = `${backupUuid}.tar.gz`;
    const backupPath = join(backupsDir, backupFileName);

    await tarCreate(
      {
        gzip: true,
        file: backupPath,
        cwd: serverDir,
        filter: (p) => !p.startsWith('backups'),
      },
      ['.'],
    );

    const size = statSync(backupPath).size;
    return json({
      success: true,
      message: 'Backup created successfully',
      backup: {
        uuid: backupUuid,
        name: body.name,
        filePath: `servers/${body.id}/backups/${backupFileName}`,
        size,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(`Error creating backup for server ${body.id}:`, err);
    return json({ error: `Failed to create backup: ${err instanceof Error ? err.message : 'unknown error'}` }, 500);
  }
}

export async function handleContainerRestore(req: Request): Promise<Response> {
  let body: { id?: string; backupPath?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.id) return json({ error: 'server ID is required' }, 400);
  if (!body.backupPath || typeof body.backupPath !== 'string') return json({ error: 'backup path is required' }, 400);
  if (!validateContainerId(body.id)) return json({ error: 'invalid server ID' }, 400);

  const serverDir = getServerDir(body.id);
  const fullBackupPath = resolve(process.cwd(), body.backupPath);

  if (!existsSync(fullBackupPath)) return json({ error: 'backup file not found' }, 404);

  try {
    await stopServer(body.id);
    await tarExtract({ file: fullBackupPath, cwd: serverDir });
    return json({ success: true, message: 'Backup restored successfully' });
  } catch (err) {
    logger.error(`Error restoring backup for server ${body.id}:`, err);
    return json({ error: `Failed to restore backup: ${err instanceof Error ? err.message : 'unknown error'}` }, 500);
  }
}

export async function handleContainerBackupDelete(req: Request): Promise<Response> {
  let body: { backupPath?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.backupPath || typeof body.backupPath !== 'string') return json({ error: 'backup path is required' }, 400);

  const fullPath = resolve(process.cwd(), body.backupPath);
  if (!existsSync(fullPath)) return json({ error: 'backup file not found' }, 404);

  try {
    unlinkSync(fullPath);
    return json({ success: true, message: 'Backup deleted successfully' });
  } catch (err) {
    logger.error('Error deleting backup:', err);
    return json({ error: `Failed to delete backup` }, 500);
  }
}

export function handleContainerBackupDownload(req: Request): Response {
  const params = new URL(req.url).searchParams;
  const backupPath = params.get('backupPath');
  if (!backupPath) return json({ error: 'backup path is required' }, 400);

  const fullPath = resolve(process.cwd(), backupPath);
  if (!existsSync(fullPath)) return json({ error: 'backup file not found' }, 404);

  const filename = basename(fullPath);
  const content = readFileSync(fullPath);
  return new Response(content, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export async function handleContainerBackupUpload(req: Request): Promise<Response> {
  return json({ success: true, message: 'Upload complete' });
}
