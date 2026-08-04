import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform, arch } from 'node:os';

export class JavaRuntimeManager {
  private runtimeDir: string;

  constructor(runtimeDir: string) {
    this.runtimeDir = resolve(runtimeDir);
    if (!existsSync(this.runtimeDir)) {
      mkdirSync(this.runtimeDir, { recursive: true });
    }
  }

  /**
   * Resolves the absolute path to the java executable for the given version requirement (e.g., "17", "21").
   */
  public getJavaBinaryPath(versionOverride?: string | null): string {
    if (!versionOverride || versionOverride === 'auto') {
      return 'java'; // Default system java
    }

    const versionFolder = resolve(this.runtimeDir, `java-${versionOverride}`);
    const osPlatform = platform();

    const binName = osPlatform === 'win32' ? 'java.exe' : 'java';
    const binPath = resolve(versionFolder, 'bin', binName);

    if (existsSync(binPath)) {
      return binPath;
    }

    // Fallback to system java if specified version is not yet installed locally
    return 'java';
  }

  /**
   * Discovers locally managed Java runtimes.
   */
  public listManagedRuntimes(): string[] {
    if (!existsSync(this.runtimeDir)) return [];
    return readdirSync(this.runtimeDir).filter(name => name.startsWith('java-'));
  }
}
