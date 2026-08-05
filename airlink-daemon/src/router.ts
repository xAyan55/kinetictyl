import config from './config.js';
import logger from './logger.js';
import { handleRoot, handleStats } from './routes/core.js';
import {
  handleFsAppend,
  handleFsCreateEmpty,
  handleFsDownload,
  handleFsFileRead,
  handleFsFileWrite,
  handleFsInfo,
  handleFsList,
  handleFsMkdir,
  handleFsRename,
  handleFsRm,
  handleFsSize,
  handleFsUnzip,
  handleFsUpload,
  handleFsZip,
} from './routes/filesystem.js';
import {
  handleContainerBackup,
  handleContainerBackupDelete,
  handleContainerBackupDownload,
  handleContainerBackupUpload,
  handleContainerCommand,
  handleContainerDelete,
  handleContainerInstall,
  handleContainerInstaller,
  handleContainerInstallStatus,
  handleContainerKill,
  handleContainerRestore,
  handleContainerStart,
  handleContainerStats,
  handleContainerStatus,
  handleContainerStop,
} from './routes/instances.js';
import { handleMinecraftPlayers } from './routes/minecraft.js';
import { handleRadarScan, handleRadarZip } from './routes/radar.js';
import { handleSftpCreate, handleSftpRevoke, handleSftpStatus } from './routes/sftp.js';
import { checkBasicAuth, getAllowedIpCheck, verifyHmac, withSecurityHeaders } from './security/hmac.js';
import { checkRateLimit } from './security/rateLimit.js';

type Handler = (req: Request, params: Record<string, string>) => Promise<Response> | Response;

const exactRoutes = new Map<string, Handler>([
  ['GET /', handleRoot],
  ['GET /stats', handleStats],
  // Legacy /container/* and native /servers/* endpoints
  ['POST /container/installer', handleContainerInstaller],
  ['POST /servers/installer', handleContainerInstaller],
  ['POST /container/install', handleContainerInstall],
  ['POST /servers/install', handleContainerInstall],
  ['POST /container/start', handleContainerStart],
  ['POST /servers/start', handleContainerStart],
  ['POST /container/stop', handleContainerStop],
  ['POST /servers/stop', handleContainerStop],
  ['DELETE /container/kill', handleContainerKill],
  ['POST /container/kill', handleContainerKill],
  ['DELETE /servers/kill', handleContainerKill],
  ['POST /servers/kill', handleContainerKill],
  ['POST /container/command', handleContainerCommand],
  ['POST /servers/command', handleContainerCommand],
  ['DELETE /container', handleContainerDelete],
  ['DELETE /servers', handleContainerDelete],
  ['POST /servers/delete', handleContainerDelete],
  ['GET /container/status', handleContainerStatus],
  ['GET /servers/status', handleContainerStatus],
  ['GET /container/stats', handleContainerStats],
  ['GET /servers/stats', handleContainerStats],
  ['POST /container/backup', handleContainerBackup],
  ['POST /servers/backup', handleContainerBackup],
  ['POST /container/restore', handleContainerRestore],
  ['POST /servers/restore', handleContainerRestore],
  ['DELETE /container/backup', handleContainerBackupDelete],
  ['DELETE /servers/backup', handleContainerBackupDelete],
  ['GET /container/backup/download', handleContainerBackupDownload],
  ['GET /servers/backup/download', handleContainerBackupDownload],
  ['POST /container/backup/upload', handleContainerBackupUpload],
  ['POST /servers/backup/upload', handleContainerBackupUpload],
  ['GET /fs/list', handleFsList],
  ['GET /fs/size', handleFsSize],
  ['GET /fs/info', handleFsInfo],
  ['GET /fs/file/content', handleFsFileRead],
  ['POST /fs/file/content', handleFsFileWrite],
  ['GET /fs/download', handleFsDownload],
  ['DELETE /fs/rm', handleFsRm],
  ['POST /fs/zip', handleFsZip],
  ['POST /fs/unzip', handleFsUnzip],
  ['POST /fs/mkdir', handleFsMkdir],
  ['POST /fs/rename', handleFsRename],
  ['POST /fs/upload', handleFsUpload],
  ['POST /fs/create-empty-file', handleFsCreateEmpty],
  ['POST /fs/append-file', handleFsAppend],
  ['POST /sftp/credentials', handleSftpCreate],
  ['DELETE /sftp/credentials', handleSftpRevoke],
  ['GET /sftp/status', handleSftpStatus],
  ['GET /minecraft/players', handleMinecraftPlayers],
  ['POST /radar/scan', handleRadarScan],
  ['POST /radar/zip', handleRadarZip],
]);

const dynamicRoutes: [RegExp, string[], string, Handler][] = [
  [
    /^\/container\/status\/([a-zA-Z0-9_-]+)$/,
    ['id'],
    'GET',
    (req, params) => handleContainerInstallStatus(req, params),
  ],
  [
    /^\/servers\/status\/([a-zA-Z0-9_-]+)$/,
    ['id'],
    'GET',
    (req, params) => handleContainerInstallStatus(req, params),
  ],
];

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleHttpRequest(req: Request, clientIp: string = '127.0.0.1'): Promise<Response> {
  const started = Date.now();
  const url = new URL(req.url);
  const key = `${req.method} ${url.pathname}`;

  const finish = (res: Response): Response => {
    const wrapped = withSecurityHeaders(res);
    if (key !== 'GET /healthz') {
      logger.info(`${req.method} ${url.pathname} ${clientIp} -> ${wrapped.status} [${Date.now() - started}ms]`);
    }
    return wrapped;
  };

  if (key === 'GET /healthz') {
    return finish(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
  }

  const ipErr = getAllowedIpCheck(clientIp);
  if (ipErr) return finish(ipErr);

  const authErr = checkBasicAuth(req, config.key);
  if (authErr) return finish(authErr);

  const hmacErr = await verifyHmac(req, config.key);
  if (hmacErr) return finish(hmacErr);

  const rlErr = checkRateLimit(clientIp);
  if (rlErr) return finish(rlErr);

  const handler = exactRoutes.get(key);
  if (handler) {
    try {
      return finish(await handler(req, {}));
    } catch (err) {
      logger.error(`route error: ${key}`, err);
      return finish(jsonError('internal error', 500));
    }
  }

  for (const [pattern, paramNames, method, dynHandler] of dynamicRoutes) {
    if (req.method !== method) continue;
    const match = url.pathname.match(pattern);
    if (!match) continue;

    const params: Record<string, string> = {};
    paramNames.forEach((name, i) => {
      params[name] = match[i + 1];
    });

    try {
      return finish(await dynHandler(req, params));
    } catch (err) {
      logger.error(`route error: ${url.pathname}`, err);
      return finish(jsonError('internal error', 500));
    }
  }

  return finish(jsonError('not found', 404));
}
