import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import { daemonSchemeSync } from '../../../../handlers/utils/core/daemonRequest';
import { DaemonFileEntry } from '../types/modrinth-api';
import { PLUGIN_MANAGER_CONFIG } from '../config';

interface ServerWithNode {
  UUID: string;
  node: {
    address: string;
    port: number;
    key: string;
  };
}

export interface DaemonClientConfig {
  maxFileSize: number;
  downloadTimeout: number;
  requestTimeout: number;
}

const DEFAULT_CONFIG: DaemonClientConfig = {
  maxFileSize: PLUGIN_MANAGER_CONFIG.MAX_FILE_SIZE,
  downloadTimeout: 300000,
  requestTimeout: PLUGIN_MANAGER_CONFIG.REQUEST_TIMEOUT,
};

export class PluginDaemonClient {
  private readonly config: DaemonClientConfig;

  constructor(
    private readonly logger: { info: (message: string, ...args: unknown[]) => void; warn: (message: string, ...args: unknown[]) => void; error: (message: string, ...args: unknown[]) => void },
    config?: Partial<DaemonClientConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  sanitizeFilePath(filePath: string): string {
    if (!filePath?.trim()) return '';
    return path
      .normalize(filePath)
      .replace(/^(\.\.[\\/])+/, '')
      .replace(/[<>:"|?*]/g, '_')
      .replace(/\.\./g, '')
      .replace(/^\/+(?!\/)/, '');
  }

  private validateServer(server: ServerWithNode): void {
    if (!server?.node?.address || !server?.node?.port || !server?.node?.key || !server?.UUID) {
      throw new Error('Invalid server configuration');
    }
  }

  private baseUrl(server: ServerWithNode): string {
    return `${daemonSchemeSync()}://${server.node.address}:${server.node.port}`;
  }

  private auth(server: ServerWithNode) {
    return { username: 'CynexGP', password: server.node.key };
  }

  async isDaemonOnline(server: ServerWithNode): Promise<boolean> {
    const url = `${this.baseUrl(server)}/`;
    console.log(`[DAEMON] Checking daemon health: ${url}`);
    try {
      await axios.get(url, {
        auth: this.auth(server),
        timeout: 5000,
      });
      console.log(`[DAEMON] Daemon is ONLINE`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] Daemon is OFFLINE: ${msg}`);
      return false;
    }
  }

  async listDirectory(server: ServerWithNode, directoryPath: string): Promise<DaemonFileEntry[]> {
    this.validateServer(server);
    const sanitizedPath = this.sanitizeFilePath(directoryPath) || '/';
    const url = `${this.baseUrl(server)}/fs/list`;
    console.log(`[DAEMON] listDirectory: ${url} path=${sanitizedPath}`);
    try {
      const response = await axios.get(url, {
        auth: this.auth(server),
        params: { id: server.UUID, path: sanitizedPath },
        timeout: this.config.requestTimeout,
      });
      const entries = Array.isArray(response.data) ? response.data as DaemonFileEntry[] : [];
      console.log(`[DAEMON] listDirectory: ${entries.length} entries, status=${response.status}`);
      return entries;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] listDirectory ERROR: ${msg}`);
      throw error;
    }
  }

  async uploadFile(
    server: ServerWithNode,
    relativePath: string,
    fileName: string,
    fileBuffer: Buffer,
  ): Promise<void> {
    this.validateServer(server);
    if (!fileBuffer.length || !fileName.trim()) {
      throw new Error('Invalid file data');
    }

    const sanitizedPath = this.sanitizeFilePath(relativePath) || '/';
    const sanitizedFileName = this.sanitizeFilePath(fileName);
    if (!sanitizedFileName) throw new Error('Invalid file name');

    const url = `${this.baseUrl(server)}/fs/upload`;
    const dataSize = fileBuffer.length;
    const base64Size = Math.ceil(dataSize * 4 / 3);
    console.log(`[DAEMON] uploadFile: ${url}`);
    console.log(`[DAEMON]   path=${sanitizedPath}`);
    console.log(`[DAEMON]   fileName=${sanitizedFileName}`);
    console.log(`[DAEMON]   fileSize=${dataSize} bytes`);
    console.log(`[DAEMON]   base64Size=${base64Size} bytes`);

    if (dataSize > this.config.maxFileSize) {
      console.log(`[DAEMON]   ERROR: File exceeds max size (${dataSize} > ${this.config.maxFileSize})`);
      throw new Error(`File exceeds maximum upload size`);
    }

    try {
      const response = await axios.post(
        url,
        {
          id: server.UUID,
          path: sanitizedPath,
          fileName: sanitizedFileName,
          fileContent: `data:application/octet-stream;base64,${fileBuffer.toString('base64')}`,
        },
        {
          auth: this.auth(server),
          headers: { 'Content-Type': 'application/json' },
          timeout: this.config.downloadTimeout,
          maxContentLength: this.config.maxFileSize * 2,
          maxBodyLength: this.config.maxFileSize * 2,
        },
      );
      console.log(`[DAEMON] uploadFile: DONE status=${response.status}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] uploadFile ERROR: ${msg}`);
      if (axios.isAxiosError(error)) {
        console.log(`[DAEMON]   status=${error.response?.status}`);
        console.log(`[DAEMON]   data=${JSON.stringify(error.response?.data)}`);
      }
      throw error;
    }
  }

  async deletePath(server: ServerWithNode, filePath: string): Promise<void> {
    this.validateServer(server);
    const sanitizedPath = this.sanitizeFilePath(filePath);
    if (!sanitizedPath) throw new Error('Invalid file path');
    const url = `${this.baseUrl(server)}/fs/rm`;
    console.log(`[DAEMON] deletePath: ${url} path=${sanitizedPath}`);
    try {
      const response = await axios.delete(url, {
        auth: this.auth(server),
        headers: { 'Content-Type': 'application/json' },
        data: { id: server.UUID, path: sanitizedPath },
        timeout: this.config.requestTimeout,
      });
      console.log(`[DAEMON] deletePath: DONE status=${response.status}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] deletePath ERROR: ${msg}`);
      throw error;
    }
  }

  async renamePath(server: ServerWithNode, fromPath: string, toPath: string): Promise<void> {
    this.validateServer(server);
    const sanitizedFrom = this.sanitizeFilePath(fromPath);
    const sanitizedTo = this.sanitizeFilePath(toPath);
    if (!sanitizedFrom || !sanitizedTo) throw new Error('Invalid rename path');
    const url = `${this.baseUrl(server)}/fs/rename`;
    console.log(`[DAEMON] renamePath: ${url} from=${sanitizedFrom} to=${sanitizedTo}`);
    try {
      const response = await axios.post(
        url,
        { id: server.UUID, from: sanitizedFrom, to: sanitizedTo },
        {
          auth: this.auth(server),
          headers: { 'Content-Type': 'application/json' },
          timeout: this.config.requestTimeout,
        },
      );
      console.log(`[DAEMON] renamePath: DONE status=${response.status}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] renamePath ERROR: ${msg}`);
      throw error;
    }
  }

  async createDirectory(server: ServerWithNode, directoryPath: string): Promise<void> {
    this.validateServer(server);
    const sanitizedPath = this.sanitizeFilePath(directoryPath);
    if (!sanitizedPath) throw new Error('Invalid directory path');
    const normalizedPath = sanitizedPath.endsWith('/') ? sanitizedPath : `${sanitizedPath}/`;
    const url = `${this.baseUrl(server)}/fs/mkdir`;
    console.log(`[DAEMON] createDirectory: ${url} path=${normalizedPath}`);
    try {
      const response = await axios.post(
        url,
        { id: server.UUID, path: normalizedPath },
        {
          auth: this.auth(server),
          headers: { 'Content-Type': 'application/json' },
          timeout: this.config.requestTimeout,
        },
      );
      console.log(`[DAEMON] createDirectory: DONE status=${response.status}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] createDirectory ERROR: ${msg}`);
      if (axios.isAxiosError(error)) {
        console.log(`[DAEMON]   status=${error.response?.status}`);
        console.log(`[DAEMON]   data=${JSON.stringify(error.response?.data)}`);
      }
      throw error;
    }
  }

  async createBackupZip(server: ServerWithNode, sourcePath: string, zipPath: string): Promise<void> {
    this.validateServer(server);
    const url = `${this.baseUrl(server)}/fs/zip`;
    console.log(`[DAEMON] createBackupZip: ${url} source=${sourcePath} zip=${zipPath}`);
    try {
      const response = await axios.post(
        url,
        { id: server.UUID, path: this.sanitizeFilePath(sourcePath), zipPath: this.sanitizeFilePath(zipPath) },
        {
          auth: this.auth(server),
          headers: { 'Content-Type': 'application/json' },
          timeout: this.config.downloadTimeout,
        },
      );
      console.log(`[DAEMON] createBackupZip: DONE status=${response.status}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] createBackupZip ERROR: ${msg}`);
      throw error;
    }
  }

  validateHash(buffer: Buffer, expectedHash: string): boolean {
    try {
      const hashType = expectedHash.length === 64 ? 'sha256' : 'sha1';
      const hash = crypto.createHash(hashType).update(buffer).digest('hex');
      const match = hash.toLowerCase() === expectedHash.toLowerCase();
      console.log(`[DAEMON] validateHash: type=${hashType} expected=${expectedHash} actual=${hash} match=${match}`);
      return match;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[DAEMON] validateHash ERROR: ${msg}`);
      return false;
    }
  }

  async downloadFile(url: string, filename: string, expectedHash?: string): Promise<Buffer> {
    if (!url || !filename) throw new Error('URL and filename required');

    console.log(`[DAEMON] downloadFile: ${filename}`);
    console.log(`[DAEMON]   url=${url}`);
    console.log(`[DAEMON]   expectedHash=${expectedHash || 'none'}`);

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      console.log(`[DAEMON]   download attempt ${attempt + 1}/${maxAttempts}`);
      try {
        const response = await axios.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': PLUGIN_MANAGER_CONFIG.USER_AGENT,
            Accept: '*/*',
          },
          timeout: this.config.downloadTimeout,
          maxContentLength: this.config.maxFileSize,
          maxBodyLength: this.config.maxFileSize,
        });

        const buffer = Buffer.from(response.data);
        console.log(`[DAEMON]   download SUCCESS: ${buffer.length} bytes, status=${response.status}`);
        if (!buffer.length) {
          console.log(`[DAEMON]   ERROR: Empty file downloaded`);
          throw new Error('Empty file');
        }

        if (expectedHash && !this.validateHash(buffer, expectedHash)) {
          console.log(`[DAEMON]   ERROR: Hash mismatch`);
          throw new Error(`Hash validation failed for ${filename}`);
        }

        console.log(`[DAEMON]   download complete: ${filename} (${buffer.length} bytes)`);
        return buffer;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[DAEMON]   attempt ${attempt + 1} FAILED: ${message}`);
        if (axios.isAxiosError(error)) {
          console.log(`[DAEMON]   status=${error.response?.status}`);
          console.log(`[DAEMON]   headers=${JSON.stringify(error.response?.headers)}`);
        }
        if (attempt >= maxAttempts - 1) {
          throw new Error(`Download failed after ${maxAttempts} attempts: ${message}`);
        }
        const delay = 1000 * 2 ** attempt;
        console.log(`[DAEMON]   retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Download failed for ${filename}`);
  }

  isValidJar(buffer: Buffer): boolean {
    if (buffer.length < 4) {
      console.log(`[DAEMON] isValidJar: FAIL (buffer too small: ${buffer.length} bytes)`);
      return false;
    }
    const isJar = buffer[0] === 0x50 && buffer[1] === 0x4b;
    console.log(`[DAEMON] isValidJar: ${isJar ? 'PASS' : 'FAIL'} (first bytes: ${buffer[0].toString(16)} ${buffer[1].toString(16)})`);
    return isJar;
  }
}
