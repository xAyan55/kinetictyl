import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ProcessSupervisor } from './supervisor.js';
import { InstallerPipeline, InstallStep } from './installer.js';
import { JavaRuntimeManager } from './runtimes.js';
import { SftpDaemon } from './sftp.js';
import { validatePath } from './guard.js';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

export class AgentDaemon {
  private port: number;
  private serverRootDir: string;
  private supervisor: ProcessSupervisor;
  private installer: InstallerPipeline;
  private runtimes: JavaRuntimeManager;
  private sftp: SftpDaemon;

  constructor(port = 8081, sftpPort = 2022, serverRootDir = './data/servers', runtimeDir = './data/runtimes') {
    this.port = port;
    this.serverRootDir = serverRootDir;
    this.supervisor = new ProcessSupervisor();
    this.installer = new InstallerPipeline();
    this.runtimes = new JavaRuntimeManager(runtimeDir);
    this.sftp = new SftpDaemon(sftpPort, serverRootDir);
  }

  public start(): void {
    const app = express();
    app.use(express.json());

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });

    // Server Register & Provision endpoint
    app.post('/api/servers/provision', async (req, res) => {
      try {
        const { uuid, type, version, steps, ramLimitMB, cpuLimitPct, javaOverride } = req.body;
        const serverDir = validatePath(this.serverRootDir, `${this.serverRootDir}/${uuid}`);
        
        const javaPath = this.runtimes.getJavaBinaryPath(javaOverride);

        this.supervisor.registerServer({
          uuid,
          serverDir,
          javaPath,
          jvmArgs: [`-Xms${ramLimitMB}M`, `-Xmx${ramLimitMB}M`],
          jarName: 'server.jar',
          limits: { ramLimitBytes: BigInt(ramLimitMB) * 1024n * 1024n, cpuLimitPct }
        });

        // Run installation pipeline asynchronously
        if (steps && Array.isArray(steps)) {
          this.installer.executePipeline(serverDir, steps as InstallStep[], (pct, detail) => {
            console.log(`[Installer ${uuid}] ${pct}% - ${detail}`);
          }).catch(err => {
            console.error(`[Installer ${uuid}] Error:`, err);
          });
        }

        res.json({ success: true, message: "Server provisioned successfully." });
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // File Manager Endpoints
    app.get('/api/servers/:uuid/files', (req, res) => {
      try {
        const { uuid } = req.params;
        const pathReq = (req.query.path as string) || '/';
        const serverDir = `${this.serverRootDir}/${uuid}`;
        const targetDir = validatePath(serverDir, `${serverDir}/${pathReq}`);

        if (!existsSync(targetDir)) {
          return res.status(404).json({ success: false, error: "Directory does not exist." });
        }

        const entries = readdirSync(targetDir, { withFileTypes: true }).map(e => {
          const stat = statSync(`${targetDir}/${e.name}`);
          return {
            name: e.name,
            isDirectory: e.isDirectory(),
            size: stat.size,
            mtime: stat.mtime
          };
        });

        res.json({ success: true, files: entries });
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    app.post('/api/servers/:uuid/files/write', (req, res) => {
      try {
        const { uuid } = req.params;
        const { path, content } = req.body;
        const serverDir = `${this.serverRootDir}/${uuid}`;
        const targetPath = validatePath(serverDir, `${serverDir}/${path}`);

        writeFileSync(targetPath, content, 'utf-8');
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    app.delete('/api/servers/:uuid/files/delete', (req, res) => {
      try {
        const { uuid } = req.params;
        const { path } = req.body;
        const serverDir = `${this.serverRootDir}/${uuid}`;
        const targetPath = validatePath(serverDir, `${serverDir}/${path}`);

        if (existsSync(targetPath)) {
          unlinkSync(targetPath);
        }
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    const httpServer = createServer(app);
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws: WebSocket, req) => {
      const urlParams = new URLSearchParams(req.url?.split('?')[1]);
      const uuid = urlParams.get('uuid');

      if (!uuid) {
        ws.close(1008, "Missing server UUID");
        return;
      }

      // Pipe supervisor logs to WebSocket
      const consoleListener = (data: { uuid: string; text: string }) => {
        if (data.uuid === uuid && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: 'console_output', args: [data.text] }));
        }
      };

      const statusListener = (data: { uuid: string; status: string }) => {
        if (data.uuid === uuid && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: 'status_change', args: [data.status] }));
        }
      };

      this.supervisor.on('console', consoleListener);
      this.supervisor.on('status', statusListener);

      ws.on('message', (message: string) => {
        try {
          const payload = JSON.parse(message);
          if (payload.event === 'power_action') {
            const action = payload.args[0];
            if (action === 'start') this.supervisor.startServer(uuid);
            if (action === 'stop') this.supervisor.stopServer(uuid);
            if (action === 'kill') this.supervisor.killServer(uuid);
          } else if (payload.event === 'console_input') {
            this.supervisor.sendCommand(uuid, payload.args[0]);
          }
        } catch (err) {
          console.error('[Agent WS] Parse error:', err);
        }
      });

      ws.on('close', () => {
        this.supervisor.off('console', consoleListener);
        this.supervisor.off('status', statusListener);
      });
    });

    httpServer.listen(this.port, () => {
      console.log(`[Agent Daemon] Listening on HTTP/WS port ${this.port}`);
    });

    // Start SFTP daemon
    this.sftp.start();
  }
}
