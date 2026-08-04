import ssh2 from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { validatePath } from './guard.js';

const SshServer = ssh2.Server;

export class SftpDaemon {
  private port: number;
  private hostKey: string;
  private serverRootDir: string;

  constructor(port: number = 2022, serverRootDir: string = './data/servers') {
    this.port = port;
    this.serverRootDir = serverRootDir;

    // Generate ephemeral RSA keypair for SSH host authentication
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
    });
    this.hostKey = privateKey;
  }

  public start(): void {
    const server = new SshServer({ hostKeys: [this.hostKey] }, (client) => {
      let authenticatedServerUuid: string | null = null;

      client.on('authentication', (ctx) => {
        // SFTP username format: user.serverUuid (e.g., admin.e2296716-1f6e-4cc3-b26a-939e1ffc1c1f)
        const parts = ctx.username.split('.');
        if (parts.length >= 2) {
          authenticatedServerUuid = parts.slice(1).join('.');
          ctx.accept();
        } else {
          ctx.reject(['password']);
        }
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();

          session.on('sftp', (acceptSftp) => {
            const sftp = acceptSftp();
            const serverDir = `${this.serverRootDir}/${authenticatedServerUuid}`;

            sftp.on('readdir', (reqPath: string, callback: (code: number, list: any[]) => void) => {
              try {
                const target = validatePath(serverDir, `${serverDir}/${reqPath}`);
                const files = readdirSync(target, { withFileTypes: true });

                const list = files.map(f => {
                  const stat = statSync(`${target}/${f.name}`);
                  return {
                    filename: f.name,
                    longname: `${f.isDirectory() ? 'd' : '-'}rw-r--r-- 1 owner group ${stat.size} Aug 04 12:00 ${f.name}`,
                    attrs: {
                      mode: f.isDirectory() ? 0o40755 : 0o100644,
                      size: stat.size,
                      uid: 1000,
                      gid: 1000,
                      atime: Math.floor(stat.atimeMs / 1000),
                      mtime: Math.floor(stat.mtimeMs / 1000)
                    }
                  };
                });
                callback(0, list);
              } catch {
                callback(2, []); // 2 = SSH_FX_NO_SUCH_FILE
              }
            });

            sftp.on('open', (reqPath: string, flags: any, attrs: any, callback: (code: number, handle: Buffer) => void) => {
              try {
                const target = validatePath(serverDir, `${serverDir}/${reqPath}`);
                // Simple file handle wrapper
                callback(0, Buffer.from(target));
              } catch {
                callback(2, Buffer.from([]));
              }
            });
          });
        });
      });
    });

    server.listen(this.port, '0.0.0.0', () => {
      console.log(`[SFTP] SFTP Server listening on port ${this.port}`);
    });
  }
}
