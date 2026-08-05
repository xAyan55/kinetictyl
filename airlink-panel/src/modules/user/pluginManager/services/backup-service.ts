import { PluginDaemonClient } from './daemon-client';
import { PLUGIN_MANAGER_CONFIG } from '../config';

interface ServerWithNode {
  UUID: string;
  node: {
    address: string;
    port: number;
    key: string;
  };
}

export class PluginBackupService {
  constructor(
    private readonly daemon: PluginDaemonClient,
    private readonly prisma: { $executeRaw: Function },
  ) {}

  async backupPluginFile(
    server: ServerWithNode,
    filename: string,
    reason: 'update' | 'delete' | 'replace' | 'upload',
  ): Promise<string> {
    const sourcePath = `${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}/${filename}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `${filename}.${timestamp}.bak.zip`;
    const backupPath = `${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}/.cynexgp-backups/${backupFilename}`;

    await this.daemon.createDirectory(server, `${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}/.cynexgp-backups`);
    await this.daemon.createBackupZip(server, sourcePath, backupPath);

    await this.prisma.$executeRaw`
      INSERT INTO PluginManagerBackup (serverId, filename, filePath, reason)
      VALUES (${server.UUID}, ${filename}, ${backupPath}, ${reason})
    `;

    return backupPath;
  }

  async rollback(server: ServerWithNode, backupPath: string, targetFilename: string): Promise<void> {
    throw new Error('Rollback is not supported. The daemon does not provide file extraction endpoints.');
  }
}
