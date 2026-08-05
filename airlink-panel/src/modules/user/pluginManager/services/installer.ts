import crypto from 'crypto';
import type { Images } from '@prisma/client';
import { ModrinthClient } from './modrinth-client';
import { PluginDaemonClient } from './daemon-client';
import { DependencyResolver } from './dependency-resolver';
import { CompatibilityChecker } from './compatibility-checker';
import { PluginBackupService } from './backup-service';
import { pluginProgressTracker } from './progress-tracker';
import { PLUGIN_MANAGER_CONFIG } from '../config';
import { sanitizeFilename } from '../utils/validation';
import { ResolvedDependency } from './dependency-resolver';
import { isCompatibleLoader } from './compatibility-service';
import { detectPluginLoader } from '../../../../handlers/utils/server/pluginServer';

interface ServerRecord {
  UUID: string;
  Variables: string | null;
  image: Images;
  node: {
    address: string;
    port: number;
    key: string;
  };
}

export class PluginInstaller {
  constructor(
    private readonly prisma: { $executeRaw: Function },
    private readonly modrinthClient: ModrinthClient,
    private readonly daemon: PluginDaemonClient,
    private readonly dependencyResolver: DependencyResolver,
    private readonly compatibilityChecker: CompatibilityChecker,
    private readonly backupService: PluginBackupService,
    private readonly logger: { error: (message: string, ...args: unknown[]) => void },
  ) {}

  createOperationId(projectId: string): string {
    return `${projectId}-${crypto.randomBytes(4).toString('hex')}`;
  }

  async installFromModrinth(
    server: ServerRecord,
    projectId: string,
    versionId: string,
    operationId: string,
    options: {
      force?: boolean;
      isAdmin: boolean;
      installDependencies?: boolean;
      dependencyIds?: string[];
    },
  ): Promise<void> {
    try {
      console.log(`[INSTALL] ====== INSTALL START ======`);
      console.log(`[INSTALL] serverUUID=${server.UUID}`);
      console.log(`[INSTALL] imageName=${server.image?.name}`);
      console.log(`[INSTALL] Variables=${server.Variables}`);
      console.log(`[INSTALL] projectId=${projectId}`);
      console.log(`[INSTALL] versionId=${versionId}`);
      console.log(`[INSTALL] operationId=${operationId}`);
      console.log(`[INSTALL] options=`, JSON.stringify(options));

      pluginProgressTracker.initialize(server.UUID, operationId, projectId, '');

      console.log(`[INSTALL] Fetching project ${projectId} and version ${versionId}...`);
      const [project, version] = await Promise.all([
        this.modrinthClient.getProject(projectId),
        this.modrinthClient.getVersion(versionId),
      ]);

      console.log(`[INSTALL] Project: "${project.title}" type=${project.project_type} id=${project.id}`);
      console.log(`[INSTALL] Version: ${version.version_number} name=${version.name}`);
      console.log(`[INSTALL] Version loaders: [${version.loaders.join(', ')}]`);
      console.log(`[INSTALL] Version game_versions: [${version.game_versions.join(', ')}]`);
      console.log(`[INSTALL] Version files: ${version.files.map(f => `${f.filename} (${f.size} bytes, primary=${f.primary})`).join(', ')}`);

      const serverLoader = detectPluginLoader(server.image);
      console.log(`[INSTALL] Detected server loader: ${serverLoader || 'null'}`);

      const loaderCompatible = isCompatibleLoader(serverLoader, version.loaders);
      console.log(`[INSTALL] Loader compatibility: ${loaderCompatible ? 'PASS' : 'FAIL'}`);
      if (!loaderCompatible) {
        throw new Error(
          `Version is from a different ecosystem (loaders: ${version.loaders.join(', ')}) and is not compatible with ${serverLoader || 'your server'}.`
        );
      }

      pluginProgressTracker.initialize(server.UUID, operationId, projectId, project.title);

      console.log(`[INSTALL] Checking compatibility...`);
      const compatibility = this.compatibilityChecker.check(server.image, server.Variables, version, options.isAdmin);
      console.log(`[INSTALL] Compatibility result: compatible=${compatibility.compatible}`);
      console.log(`[INSTALL]   errors=[${compatibility.errors.join('; ')}]`);
      console.log(`[INSTALL]   warnings=[${compatibility.warnings.join('; ')}]`);
      console.log(`[INSTALL]   minecraftVersion=${compatibility.minecraftVersion}`);
      console.log(`[INSTALL]   loader=${compatibility.loader}`);
      if (!compatibility.compatible && !(options.force && options.isAdmin)) {
        throw new Error(compatibility.errors.join(' '));
      }
      for (const warning of compatibility.warnings) {
        pluginProgressTracker.addWarning(server.UUID, operationId, warning);
      }

      const primaryFile = version.files.find((file) => file.primary) || version.files[0];
      if (!primaryFile) {
        console.log(`[INSTALL] ERROR: No primary file found in version files`);
        throw new Error('No downloadable files found for this plugin version.');
      }
      console.log(`[INSTALL] Primary file: ${primaryFile.filename} (${primaryFile.size || 'unknown'} bytes)`);
      console.log(`[INSTALL] Download URL: ${primaryFile.url}`);
      console.log(`[INSTALL] Expected SHA1: ${primaryFile.hashes?.sha1 || 'none'}`);

      const dependencies = options.installDependencies
        ? await this.dependencyResolver.resolve(version, compatibility.minecraftVersion, compatibility.loader)
        : [];
      console.log(`[INSTALL] Dependencies resolved: ${dependencies.length} total`);

      const selectedDependencies = dependencies.filter((dependency) =>
        dependency.required || options.dependencyIds?.includes(dependency.projectId),
      );
      console.log(`[INSTALL] Dependencies selected for install: ${selectedDependencies.length}`);
      for (const dep of selectedDependencies) {
        console.log(`[INSTALL]   -> ${dep.projectName} v${dep.versionNumber} (${dep.filename}) required=${dep.required}`);
      }

      for (const dependency of selectedDependencies) {
        await this.installResolvedDependency(server, dependency, operationId);
      }

      console.log(`[INSTALL] Installing primary file: ${primaryFile.filename}...`);
      await this.installPrimaryFile(server, project.id, project.title, version.id, version.version_number, primaryFile.filename, primaryFile.url, primaryFile.hashes?.sha1, primaryFile.size, operationId);
      console.log(`[INSTALL] ====== INSTALL COMPLETE ======`);
      pluginProgressTracker.complete(server.UUID, operationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Installation failed';
      console.log(`[INSTALL] ERROR: ${message}`);
      console.log(`[INSTALL] Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
      pluginProgressTracker.fail(server.UUID, operationId, message);
      this.logger.error(`Plugin install failed for ${projectId}:`, message);
      throw error;
    }
  }

  async uploadJar(
    server: ServerRecord,
    filename: string,
    buffer: Buffer,
    operationId: string,
  ): Promise<void> {
    pluginProgressTracker.initialize(server.UUID, operationId, 'upload', filename);
    console.log(`[INSTALL] uploadJar: ${filename} (${buffer.length} bytes)`);

    try {
      if (!this.daemon.isValidJar(buffer)) {
        console.log(`[INSTALL] ERROR: Uploaded file is not a valid JAR`);
        throw new Error('Uploaded file is not a valid JAR archive.');
      }

      const sanitized = sanitizeFilename(filename);
      if (!sanitized.toLowerCase().endsWith('.jar')) {
        throw new Error('Only .jar plugin files are supported.');
      }

      pluginProgressTracker.updateStage(server.UUID, operationId, 'validating', 'Validating uploaded plugin...');
      console.log(`[INSTALL] Creating plugins directory...`);
      await this.daemon.createDirectory(server, PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY);

      const targetPath = `${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}/${sanitized}`;
      try {
        console.log(`[INSTALL] Backing up existing plugin...`);
        await this.backupService.backupPluginFile(server, sanitized, 'upload');
      } catch {
        pluginProgressTracker.addWarning(server.UUID, operationId, 'Could not create backup before upload.');
        console.log(`[INSTALL] Backup failed (non-fatal)`);
      }

      pluginProgressTracker.updateStage(server.UUID, operationId, 'installing', 'Uploading plugin...');
      console.log(`[INSTALL] Uploading ${sanitized} to daemon...`);
      await this.daemon.uploadFile(server, PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY, sanitized, buffer);
      console.log(`[INSTALL] Upload complete`);

      await this.recordInstallation(server.UUID, null, sanitized.replace(/\.jar$/i, ''), null, null, sanitized, buffer.length, null);
      pluginProgressTracker.complete(server.UUID, operationId);
      console.log(`[INSTALL] Upload installation complete`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      console.log(`[INSTALL] uploadJar ERROR: ${message}`);
      pluginProgressTracker.fail(server.UUID, operationId, message);
      throw error;
    }
  }

  async deletePlugin(server: ServerRecord, filename: string): Promise<void> {
    console.log(`[INSTALL] deletePlugin: ${filename}`);
    const sanitized = sanitizeFilename(filename);
    try {
      await this.backupService.backupPluginFile(server, sanitized.replace(/\.disabled$/i, ''), 'delete');
    } catch {
      // Continue even if backup fails; deletion is still requested.
    }

    await this.daemon.deletePath(server, `${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}/${sanitized}`);
    console.log(`[INSTALL] Deleted ${sanitized} from daemon`);
    await this.prisma.$executeRaw`
      UPDATE PluginManagerInstallation
      SET status = 'removed', updatedAt = datetime('now')
      WHERE serverId = ${server.UUID} AND filename = ${sanitized.replace(/\.disabled$/i, '')}
    `;
    console.log(`[INSTALL] deletePlugin complete`);
  }

  async togglePlugin(server: ServerRecord, filename: string, enabled: boolean): Promise<string> {
    const sanitized = sanitizeFilename(filename);
    const baseName = sanitized.replace(/\.disabled$/i, '');
    const fromPath = `${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}/${sanitized}`;
    const toName = enabled ? `${baseName}.jar` : `${baseName}.jar.disabled`;
    const toPath = `${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}/${toName}`;

    console.log(`[INSTALL] togglePlugin: ${fromPath} -> ${toPath} (enabled=${enabled})`);
    await this.daemon.renamePath(server, fromPath, toPath);
    await this.prisma.$executeRaw`
      UPDATE PluginManagerInstallation
      SET enabled = ${enabled ? 1 : 0}, filename = ${toName}, updatedAt = datetime('now')
      WHERE serverId = ${server.UUID} AND filename IN (${sanitized}, ${baseName}, ${`${baseName}.jar`}, ${`${baseName}.jar.disabled`})
    `;
    console.log(`[INSTALL] togglePlugin complete`);
    return toName;
  }

  private async installResolvedDependency(
    server: ServerRecord,
    dependency: ResolvedDependency,
    operationId: string,
  ): Promise<void> {
    console.log(`[INSTALL] Installing dependency: ${dependency.projectName} v${dependency.versionNumber}`);
    console.log(`[INSTALL]   downloadUrl=${dependency.downloadUrl}`);
    console.log(`[INSTALL]   filename=${dependency.filename}`);
    pluginProgressTracker.addWarning(
      server.UUID,
      operationId,
      `Installing dependency: ${dependency.projectName}`,
    );
    await this.installPrimaryFile(
      server,
      dependency.projectId,
      dependency.projectName,
      dependency.versionId,
      dependency.versionNumber,
      dependency.filename,
      dependency.downloadUrl,
      undefined,
      undefined,
      operationId,
    );
    console.log(`[INSTALL] Dependency installed: ${dependency.projectName}`);
  }

  private async installPrimaryFile(
    server: ServerRecord,
    projectId: string | null,
    projectName: string,
    versionId: string | null,
    versionNumber: string | null,
    filename: string,
    downloadUrl: string,
    expectedHash: string | undefined,
    fileSize: number | undefined,
    operationId: string,
  ): Promise<void> {
    const sanitized = sanitizeFilename(filename);
    console.log(`[INSTALL] installPrimaryFile: ${sanitized}`);
    console.log(`[INSTALL]   projectName=${projectName}`);
    console.log(`[INSTALL]   versionNumber=${versionNumber}`);
    console.log(`[INSTALL]   fileSize=${fileSize || 'unknown'}`);
    console.log(`[INSTALL]   expectedHash=${expectedHash || 'none'}`);

    pluginProgressTracker.updateStage(server.UUID, operationId, 'downloading', `Downloading ${sanitized}...`);

    try {
      await this.backupService.backupPluginFile(server, sanitized, 'replace');
      console.log(`[INSTALL] Backup complete`);
    } catch {
      pluginProgressTracker.addWarning(server.UUID, operationId, `No existing backup created for ${sanitized}.`);
      console.log(`[INSTALL] Backup skipped (no existing file)`);
    }

    console.log(`[INSTALL] Downloading file from ${downloadUrl}...`);
    const buffer = await this.daemon.downloadFile(downloadUrl, sanitized, expectedHash);
    console.log(`[INSTALL] Downloaded ${buffer.length} bytes`);

    pluginProgressTracker.updateStage(server.UUID, operationId, 'validating', 'Validating plugin archive...');

    const isValid = this.daemon.isValidJar(buffer);
    console.log(`[INSTALL] JAR validation: ${isValid ? 'PASS' : 'FAIL'} (starts with PK=${buffer[0] === 0x50 && buffer[1] === 0x4b})`);
    if (!isValid) {
      throw new Error(`Downloaded file ${sanitized} is not a valid JAR archive.`);
    }

    pluginProgressTracker.updateStage(server.UUID, operationId, 'installing', 'Installing plugin on server...');
    console.log(`[INSTALL] Ensuring plugins directory exists: ${PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY}...`);
    await this.daemon.createDirectory(server, PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY);
    console.log(`[INSTALL] Uploading ${sanitized} to daemon (${buffer.length} bytes)...`);
    await this.daemon.uploadFile(server, PLUGIN_MANAGER_CONFIG.PLUGINS_DIRECTORY, sanitized, buffer);
    console.log(`[INSTALL] Upload to daemon complete`);

    pluginProgressTracker.updateStage(server.UUID, operationId, 'moving', 'Finalizing installation...');
    console.log(`[INSTALL] Recording installation in database...`);
    await this.recordInstallation(
      server.UUID,
      projectId,
      projectName,
      versionId,
      versionNumber,
      sanitized,
      fileSize ?? buffer.length,
      null,
    );
    console.log(`[INSTALL] installPrimaryFile complete`);
  }

  private async recordInstallation(
    serverId: string,
    projectId: string | null,
    projectName: string,
    versionId: string | null,
    versionNumber: string | null,
    filename: string,
    fileSize: number,
    author: string | null,
  ): Promise<void> {
    console.log(`[INSTALL] DB record: server=${serverId} project=${projectId} name=${projectName} ver=${versionNumber} file=${filename} size=${fileSize}`);
    await this.prisma.$executeRaw`
      INSERT INTO PluginManagerInstallation (
        serverId, projectId, projectName, versionId, versionNumber, filename, fileSize, author, status, enabled
      ) VALUES (
        ${serverId}, ${projectId}, ${projectName}, ${versionId}, ${versionNumber}, ${filename}, ${fileSize}, ${author}, 'completed', 1
      )
    `;
    console.log(`[INSTALL] DB record created`);
  }
}
