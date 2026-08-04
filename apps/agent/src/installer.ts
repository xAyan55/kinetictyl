import { createWriteStream, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { validatePath, unzipWithGuard } from './guard.js';

export interface DownloadStep {
  type: 'download';
  url: string;
  file: string;
  size?: number;
}

export interface UnzipStep {
  type: 'unzip';
  file: string;
  location: string;
}

export interface RemoveStep {
  type: 'remove';
  location: string;
}

export type InstallStep = DownloadStep | UnzipStep | RemoveStep;

export class InstallerPipeline {
  public async executePipeline(
    serverRootDir: string,
    steps: InstallStep[],
    onProgress: (pct: number, detail: string) => void
  ): Promise<void> {
    const totalSteps = steps.length;

    for (let i = 0; i < totalSteps; i++) {
      const step = steps[i];
      const progressPct = Math.floor(((i + 1) / totalSteps) * 100);

      switch (step.type) {
        case 'download': {
          onProgress(progressPct, `Downloading ${step.file}...`);
          const targetPath = validatePath(serverRootDir, step.file);
          const targetDir = dirname(targetPath);
          if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
          }
          await this.downloadFile(step.url, targetPath);
          break;
        }

        case 'unzip': {
          onProgress(progressPct, `Extracting ${step.file}...`);
          const zipPath = validatePath(serverRootDir, step.file);
          const extractDest = validatePath(serverRootDir, step.location);
          await unzipWithGuard(zipPath, extractDest);
          break;
        }

        case 'remove': {
          onProgress(progressPct, `Cleaning temporary files (${step.location})...`);
          const removeTarget = validatePath(serverRootDir, step.location);
          if (existsSync(removeTarget)) {
            unlinkSync(removeTarget);
          }
          break;
        }
      }
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download file from ${url}: Status ${response.status}`);
    }

    const fileStream = createWriteStream(destPath);
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }

    return new Promise((res, rej) => {
      fileStream.end();
      fileStream.on('finish', () => res());
      fileStream.on('error', rej);
    });
  }
}
