import type { Images } from '@prisma/client';
import { PluginDaemonClient } from './daemon-client';
import { UpdateChecker } from './update-checker';
import { InstalledPlugin } from '../types/modrinth-api';
import { PLUGIN_MANAGER_CONFIG } from '../config';
import { isNewerVersion } from '../utils/semver';
import { detectPluginLoader, resolveMinecraftVersion } from '../../../../handlers/utils/server/pluginServer';

interface ServerWithNode {
  UUID: string;
  Variables: string | null;
  image: Images;
  node: {
    address: string;
    port: number;
    key: string;
  };
}

interface InstallationRow {
  id: number;
  projectId: string | null;
  projectName: string | null;
  versionId: string | null;
  versionNumber: string | null;
  filename: string;
  fileSize: number | null;
  author: string | null;
  enabled: number;
  installedAt: string;
}

interface IgnoredUpdateRow {
  projectId: string;
}

export class PluginScanner {
  constructor(
    private readonly daemon: PluginDaemonClient,
    private readonly updateChecker: UpdateChecker,
    private readonly prisma: { $queryRaw: Function },
  ) {}

  async listInstalled(server: ServerWithNode, query?: string): Promise<InstalledPlugin[]> {
    const [files, installations, ignoredUpdates] = await Promise.all([
      this.daemon.listDirectory(server, PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY),
      this.getInstallations(server.UUID),
      this.getIgnoredUpdates(server.UUID),
    ]);

    const ignoredSet = new Set(ignoredUpdates.map((row) => row.projectId));
    const installationByFilename = new Map(installations.map((row) => [row.filename.toLowerCase(), row]));

    const plugins: InstalledPlugin[] = [];

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.jar') && !file.name.toLowerCase().endsWith('.jar.disabled')) {
        continue;
      }

      const enabled = !file.name.toLowerCase().endsWith('.jar.disabled');
      const normalizedName = file.name.replace(/\.disabled$/i, '');
      const installation = installationByFilename.get(normalizedName.toLowerCase()) ||
        installationByFilename.get(file.name.toLowerCase());

      let updateAvailable = false;
      let latestVersionNumber: string | null = null;
      let latestVersionId: string | null = null;

      if (installation?.projectId) {
        try {
          const loader = detectPluginLoader(server.image);
          const mcVersion = resolveMinecraftVersion(server.image, server.Variables) ?? undefined;
          const update = await this.updateChecker.checkProjectUpdate(
            installation.projectId,
            installation.versionId,
            installation.versionNumber,
            loader,
            mcVersion,
          );
          if (update?.updateAvailable) {
            updateAvailable = true;
            latestVersionNumber = update.latestVersionNumber;
            latestVersionId = update.latestVersionId;
          } else if (installation.versionNumber && update?.latestVersionNumber) {
            updateAvailable = isNewerVersion(update.latestVersionNumber, installation.versionNumber);
            latestVersionNumber = update.latestVersionNumber;
            latestVersionId = update.latestVersionId;
          }
        } catch {
          // Ignore update lookup failures for individual plugins.
        }
      }

      plugins.push({
        filename: file.name,
        enabled,
        size: file.size ?? installation?.fileSize ?? 0,
        modifiedAt: file.modified ?? null,
        projectId: installation?.projectId ?? null,
        projectName: installation?.projectName ?? normalizedName.replace(/\.jar$/i, ''),
        versionId: installation?.versionId ?? null,
        versionNumber: installation?.versionNumber ?? null,
        author: installation?.author ?? null,
        installedAt: installation?.installedAt ?? file.modified ?? null,
        installationId: installation?.id ?? null,
        updateAvailable,
        latestVersionNumber,
        latestVersionId,
        ignoredUpdate: installation?.projectId ? ignoredSet.has(installation.projectId) : false,
      });
    }

    const normalizedQuery = query?.trim().toLowerCase();
    if (!normalizedQuery) return plugins.sort((a, b) => a.filename.localeCompare(b.filename));

    return plugins
      .filter((plugin) =>
        plugin.filename.toLowerCase().includes(normalizedQuery) ||
        (plugin.projectName?.toLowerCase().includes(normalizedQuery) ?? false) ||
        (plugin.author?.toLowerCase().includes(normalizedQuery) ?? false),
      )
      .sort((a, b) => a.filename.localeCompare(b.filename));
  }

  private async getInstallations(serverId: string): Promise<InstallationRow[]> {
    const rows = await this.prisma.$queryRaw`
      SELECT id, projectId, projectName, versionId, versionNumber, filename, fileSize, author, enabled, installedAt
      FROM PluginManagerInstallation
      WHERE serverId = ${serverId} AND status = 'completed'
      ORDER BY installedAt DESC
    `;
    return Array.isArray(rows) ? rows as InstallationRow[] : [];
  }

  private async getIgnoredUpdates(serverId: string): Promise<IgnoredUpdateRow[]> {
    const rows = await this.prisma.$queryRaw`
      SELECT projectId FROM PluginManagerIgnoredUpdate WHERE serverId = ${serverId}
    `;
    return Array.isArray(rows) ? rows as IgnoredUpdateRow[] : [];
  }
}
