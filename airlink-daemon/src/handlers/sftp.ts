import crypto from 'crypto';
import config from '../config.js';
import logger from '../logger.js';
import { getServerDir } from './processManager.js';

export interface SftpCredential {
  username: string;
  password: string;
  host: string;
  port: number;
  expiresAt: number;
}

interface ActiveSftpSession {
  serverId: string;
  username: string;
  password: string;
  port: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const activeSessions = new Map<string, ActiveSftpSession>();
const SFTP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function generateCredential(serverId: string): Promise<SftpCredential> {
  const serverDir = getServerDir(serverId);

  const sessionKey = `server:${serverId}`;
  if (activeSessions.has(sessionKey)) {
    revokeCredential(sessionKey);
  }

  const username = `mc_${serverId.substring(0, 8)}`;
  const password = crypto.randomBytes(16).toString('hex');
  const port = config.port + 2; // Default SFTP port offset
  const expiresAt = Date.now() + SFTP_TTL_MS;

  const timer = setTimeout(() => revokeCredential(sessionKey), SFTP_TTL_MS);

  const session: ActiveSftpSession = {
    serverId,
    username,
    password,
    port,
    expiresAt,
    timer,
  };

  activeSessions.set(sessionKey, session);
  logger.info(`SFTP credential generated for server ${serverId}: user=${username}`);

  return {
    username,
    password,
    host: config.remote || '127.0.0.1',
    port,
    expiresAt,
  };
}

export function revokeCredential(sessionKey: string): void {
  const session = activeSessions.get(sessionKey);
  if (!session) return;
  clearTimeout(session.timer);
  activeSessions.delete(sessionKey);
  logger.info(`SFTP credential revoked for server ${session.serverId}`);
}

export function revokeCredentialForServer(serverId: string): void {
  revokeCredential(`server:${serverId}`);
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
