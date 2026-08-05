import { ModrinthClient } from './modrinth-client';
import { ModrinthProject, ModrinthVersion } from '../types/modrinth-api';
import {
  isCompatibleLoader,
  isCompatibleMinecraftVersion,
} from './compatibility-service';

export interface ResolvedDependency {
  projectId: string;
  projectName: string;
  versionId: string;
  versionNumber: string;
  downloadUrl: string;
  filename: string;
  required: boolean;
}

export class DependencyResolver {
  constructor(
    private readonly client: ModrinthClient,
    private readonly logger: { warn: (message: string, ...args: unknown[]) => void; info: (message: string, ...args: unknown[]) => void },
  ) {}

  async resolve(
    version: ModrinthVersion,
    minecraftVersion: string | null,
    loader: string | null,
    visited = new Set<string>(),
  ): Promise<ResolvedDependency[]> {
    const dependencies: ResolvedDependency[] = [];

    console.log(`[DEPS] ===== Resolving dependencies for ${version.version_number} (${version.name}) =====`);
    console.log(`[DEPS] minecraftVersion=${minecraftVersion} loader=${loader}`);
    console.log(`[DEPS] version.dependencies: ${version.dependencies.length} total`);

    for (const dependency of version.dependencies) {
      console.log(`[DEPS] Checking dependency: project_id=${dependency.project_id} version_id=${dependency.version_id} type=${dependency.dependency_type}`);

      if (!dependency.project_id) {
        console.log(`[DEPS]   Skipped: no project_id`);
        continue;
      }
      if (dependency.dependency_type !== 'required' && dependency.dependency_type !== 'optional') {
        console.log(`[DEPS]   Skipped: type is "${dependency.dependency_type}" (not required/optional)`);
        continue;
      }
      if (visited.has(dependency.project_id)) {
        console.log(`[DEPS]   Skipped: already visited`);
        continue;
      }

      visited.add(dependency.project_id);

      try {
        console.log(`[DEPS]   Fetching project ${dependency.project_id}...`);
        const project = await this.client.getProject(dependency.project_id);
        console.log(`[DEPS]   Project: "${project.title}" type=${project.project_type}`);

        console.log(`[DEPS]   Fetching all versions for ${project.id}...`);
        const allVersions = await this.client.getProjectVersions(dependency.project_id);
        console.log(`[DEPS]   Got ${allVersions.length} versions`);

        console.log(`[DEPS]   Picking version (explicit=${dependency.version_id || 'none'})...`);
        const resolvedVersion = this.pickVersion(allVersions, dependency.version_id, minecraftVersion, loader);
        if (!resolvedVersion) {
          console.log(`[DEPS]   REJECTED: no compatible version found for ${loader || 'unknown'} ${minecraftVersion || 'unknown'}`);
          this.logger.info(`[DEPS] Skipped dependency ${project.title} (${dependency.project_id}): no compatible version found for ${loader || 'unknown'} ${minecraftVersion || 'unknown'}`);
          continue;
        }

        console.log(`[DEPS]   Resolved version: ${resolvedVersion.version_number} loaders=[${resolvedVersion.loaders.join(',')}] game_versions=[${resolvedVersion.game_versions.join(',')}]`);

        if (!isCompatibleLoader(loader, resolvedVersion.loaders)) {
          console.log(`[DEPS]   REJECTED: loader mismatch (server=${loader} version_loaders=[${resolvedVersion.loaders.join(',')}])`);
          this.logger.info(`[DEPS] Rejected dependency ${project.title} v${resolvedVersion.version_number}: loader mismatch (version loaders: ${resolvedVersion.loaders.join(',')}, server: ${loader || 'unknown'})`);
          continue;
        }

        const primaryFile = resolvedVersion.files.find((file) => file.primary) || resolvedVersion.files[0];
        if (!primaryFile) {
          console.log(`[DEPS]   REJECTED: no primary file found`);
          continue;
        }
        console.log(`[DEPS]   Primary file: ${primaryFile.filename} (${primaryFile.size || 'unknown'} bytes) url=${primaryFile.url}`);

        console.log(`[DEPS]   ACCEPTED: ${project.title} v${resolvedVersion.version_number} (${resolvedVersion.loaders.join(',')}) — ${dependency.dependency_type}`);
        this.logger.info(`[DEPS] Accepted dependency ${project.title} v${resolvedVersion.version_number} (${resolvedVersion.loaders.join(',')}) — ${dependency.dependency_type}`);

        dependencies.push({
          projectId: project.id,
          projectName: project.title,
          versionId: resolvedVersion.id,
          versionNumber: resolvedVersion.version_number,
          downloadUrl: primaryFile.url,
          filename: primaryFile.filename,
          required: dependency.dependency_type === 'required',
        });

        console.log(`[DEPS]   Resolving nested deps for ${resolvedVersion.version_number}...`);
        const nested = await this.resolve(resolvedVersion, minecraftVersion, loader, visited);
        console.log(`[DEPS]   Nested deps: ${nested.length}`);
        dependencies.push(...nested);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[DEPS]   ERROR resolving dependency ${dependency.project_id}: ${message}`);
        this.logger.warn(`[DEPS] Failed to resolve dependency ${dependency.project_id}: ${message}`);
      }
    }

    console.log(`[DEPS] ===== Dependency resolution complete: ${dependencies.length} total =====`);
    return dependencies;
  }

  private pickVersion(
    versions: ModrinthVersion[],
    explicitVersionId: string | null | undefined,
    minecraftVersion: string | null,
    loader: string | null,
  ): ModrinthVersion | null {
    if (explicitVersionId) {
      const found = versions.find((entry) => entry.id === explicitVersionId) ?? null;
      if (found) {
        console.log(`[DEPS]   pickVersion: found by explicit ID ${explicitVersionId} -> ${found.version_number}`);
      } else {
        console.log(`[DEPS]   pickVersion: explicit ID ${explicitVersionId} not found in ${versions.length} versions`);
      }
      return found;
    }

    const found = versions.find((entry) => {
      const matchesLoader = isCompatibleLoader(loader, entry.loaders);
      const matchesGame = isCompatibleMinecraftVersion(minecraftVersion, entry.game_versions);
      if (!matchesLoader || !matchesGame) {
        console.log(`[DEPS]   pickVersion: skipping ${entry.version_number} loaders=[${entry.loaders.join(',')}] -> loader=${matchesLoader} game=${matchesGame}`);
      }
      return matchesLoader && matchesGame;
    }) ?? null;

    if (found) {
      console.log(`[DEPS]   pickVersion: found by compatibility: ${found.version_number}`);
    } else {
      console.log(`[DEPS]   pickVersion: no compatible version found among ${versions.length} versions`);
    }
    return found;
  }
}
