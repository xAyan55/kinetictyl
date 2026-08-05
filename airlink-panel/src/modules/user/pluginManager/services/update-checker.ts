import { ModrinthClient } from './modrinth-client';
import { isNewerVersion } from '../utils/semver';

export interface PluginUpdateInfo {
  projectId: string;
  projectName: string;
  filename: string;
  currentVersionId: string | null;
  currentVersionNumber: string | null;
  latestVersionId: string;
  latestVersionNumber: string;
  updateAvailable: boolean;
  ignored: boolean;
}

export class UpdateChecker {
  constructor(private readonly client: ModrinthClient) {}

  async checkProjectUpdate(
    projectId: string,
    currentVersionId: string | null,
    currentVersionNumber: string | null,
    minecraftVersion: string | null,
    loader: string | null,
  ): Promise<PluginUpdateInfo | null> {
    const [project, versions] = await Promise.all([
      this.client.getProject(projectId),
      this.client.getProjectVersions(projectId),
    ]);

    const compatibleLatest = versions.find((version) => {
      const matchesGame = !minecraftVersion || version.game_versions.includes(minecraftVersion);
      const matchesLoader = !loader || version.loaders.some((entry) => entry.toLowerCase() === loader.toLowerCase());
      return matchesGame && matchesLoader;
    }) ?? versions[0];

    if (!compatibleLatest) return null;

    const updateAvailable = currentVersionId
      ? compatibleLatest.id !== currentVersionId
      : currentVersionNumber
        ? isNewerVersion(compatibleLatest.version_number, currentVersionNumber)
        : true;

    return {
      projectId,
      projectName: project.title,
      filename: '',
      currentVersionId,
      currentVersionNumber,
      latestVersionId: compatibleLatest.id,
      latestVersionNumber: compatibleLatest.version_number,
      updateAvailable,
      ignored: false,
    };
  }
}
