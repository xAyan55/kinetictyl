import type { Images } from '@prisma/client';
import {
  detectPluginLoader,
  resolveMinecraftVersion,
  getServerVariablesRecord,
} from '../../../../handlers/utils/server/pluginServer';
import { ModrinthVersion } from '../types/modrinth-api';
import type { CompatibilityResult } from '../types/modrinth-api';
import {
  isCompatibleLoader,
  isCompatibleMinecraftVersion,
} from './compatibility-service';

export class CompatibilityChecker {
  check(
    image: Images,
    serverVariablesJson: string | null | undefined,
    version: ModrinthVersion,
    isAdmin: boolean,
  ): CompatibilityResult {
    const loader = detectPluginLoader(image);
    const minecraftVersion = resolveMinecraftVersion(image, serverVariablesJson);

    console.log(`[CHECKER] === Compatibility Check ===`);
    console.log(`[CHECKER] image=${image?.name}`);
    console.log(`[CHECKER] loader=${loader}`);
    console.log(`[CHECKER] minecraftVersion=${minecraftVersion}`);
    console.log(`[CHECKER] version=${version.version_number} (${version.name})`);
    console.log(`[CHECKER] version.loaders=[${version.loaders.join(', ')}]`);
    console.log(`[CHECKER] version.game_versions=[${version.game_versions.join(', ')}]`);

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!loader) {
      errors.push('This server does not appear to support Bukkit-style plugins.');
      console.log(`[CHECKER] ERROR: No loader detected for server`);
    }

    if (loader && version.loaders.length > 0) {
      const loaderMatches = isCompatibleLoader(loader, version.loaders);
      console.log(`[CHECKER] loader=${loader} version.loaders=[${version.loaders.join(',')}] -> ${loaderMatches ? 'MATCH' : 'MISMATCH'}`);
      if (!loaderMatches) {
        const message = `Version is from a different ecosystem (loaders: ${version.loaders.join(', ')}) and is not compatible with ${loader}.`;
        if (isAdmin) warnings.push(message);
        else errors.push(message);
        console.log(`[CHECKER] ${isAdmin ? 'WARNING' : 'ERROR'}: ${message}`);
      }
    } else if (loader && version.loaders.length === 0) {
      console.log(`[CHECKER] Version has no loader metadata - accepted (cannot positively reject)`);
    }

    if (minecraftVersion && version.game_versions.length > 0) {
      const matches = isCompatibleMinecraftVersion(minecraftVersion, version.game_versions);
      console.log(`[CHECKER] minecraftVersion=${minecraftVersion} game_versions=[${version.game_versions.join(',')}] -> ${matches ? 'MATCH' : 'MISMATCH'}`);
      if (!matches) {
        const message = `Plugin version does not list Minecraft ${minecraftVersion} as supported (supports: ${version.game_versions.join(', ')}).`;
        if (isAdmin) warnings.push(message);
        else errors.push(message);
        console.log(`[CHECKER] ${isAdmin ? 'WARNING' : 'ERROR'}: ${message}`);
      }
    } else if (minecraftVersion && version.game_versions.length === 0) {
      console.log(`[CHECKER] Version has no game version metadata - skipping MC check`);
    }

    const variables = getServerVariablesRecord(serverVariablesJson);
    console.log(`[CHECKER] serverVariables=${JSON.stringify(variables)}`);
    const javaVersion = variables.JAVA_VERSION;
    if (!javaVersion) {
      warnings.push('Java version could not be determined from server variables.');
      console.log(`[CHECKER] WARNING: Java version not determined`);
    } else {
      console.log(`[CHECKER] javaVersion=${javaVersion}`);
    }

    console.log(`[CHECKER] Result: compatible=${errors.length === 0} errors=[${errors.join('; ')}] warnings=[${warnings.join('; ')}]`);

    return {
      compatible: errors.length === 0,
      warnings,
      errors,
      minecraftVersion,
      loader,
      forceAllowed: isAdmin,
    };
  }
}
