import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { buildExecutionCommand, ProcessLimits } from './limits.js';
import { ServerStatus } from '@kinetictyl/shared';

export interface ManagedServer {
  uuid: string;
  serverDir: string;
  javaPath: string;
  jvmArgs: string[];
  jarName: string;
  limits: ProcessLimits;
  status: ServerStatus;
  process?: ChildProcess;
  restartCount: number;
  lastRestartAt: number;
}

export class ProcessSupervisor extends EventEmitter {
  private servers = new Map<string, ManagedServer>();

  public registerServer(server: Omit<ManagedServer, 'status' | 'restartCount' | 'lastRestartAt'>) {
    this.servers.set(server.uuid, {
      ...server,
      status: ServerStatus.OFFLINE,
      restartCount: 0,
      lastRestartAt: 0,
    });
  }

  public getStatus(uuid: string): ServerStatus {
    return this.servers.get(uuid)?.status || ServerStatus.OFFLINE;
  }

  public async startServer(uuid: string): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server) throw new Error(`Server ${uuid} is not registered.`);
    if (server.status === ServerStatus.RUNNING || server.status === ServerStatus.STARTING) {
      return;
    }

    server.status = ServerStatus.STARTING;
    this.emitStatus(uuid, ServerStatus.STARTING);

    const { command, args } = buildExecutionCommand(
      server.javaPath,
      server.jvmArgs,
      server.jarName,
      server.limits
    );

    const child = spawn(command, args, {
      cwd: server.serverDir,
      env: { ...process.env, PATH: process.env.PATH },
    });

    server.process = child;

    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString('utf-8');
      this.emit('console', { uuid, text: line });

      // Mark running when server socket opens or done message appears
      if (line.includes('Done (') || line.includes('For help, type')) {
        if (server.status !== ServerStatus.RUNNING) {
          server.status = ServerStatus.RUNNING;
          this.emitStatus(uuid, ServerStatus.RUNNING);
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      this.emit('console', { uuid, text: data.toString('utf-8') });
    });

    child.on('close', (code: number | null) => {
      server.process = undefined;

      if (server.status === ServerStatus.STOPPING) {
        server.status = ServerStatus.OFFLINE;
        this.emitStatus(uuid, ServerStatus.OFFLINE);
        return;
      }

      // Unexpected exit / crash handling
      if (code !== 0 && code !== null) {
        this.handleCrash(server);
      } else {
        server.status = ServerStatus.OFFLINE;
        this.emitStatus(uuid, ServerStatus.OFFLINE);
      }
    });
  }

  public sendCommand(uuid: string, command: string): void {
    const server = this.servers.get(uuid);
    if (!server?.process?.stdin) {
      throw new Error(`Server ${uuid} is not running.`);
    }
    server.process.stdin.write(`${command}\n`);
  }

  public async stopServer(uuid: string): Promise<void> {
    const server = this.servers.get(uuid);
    if (!server || !server.process) return;

    server.status = ServerStatus.STOPPING;
    this.emitStatus(uuid, ServerStatus.STOPPING);

    // 1. Send graceful stop command
    this.sendCommand(uuid, 'stop');

    // 2. Escalation timer: 60 seconds wait -> SIGTERM -> 15 seconds -> SIGKILL
    const timeout = setTimeout(() => {
      if (server.process) {
        this.emit('console', { uuid, text: '[Kinetictyl] Server stop timed out. Sending SIGTERM...\n' });
        server.process.kill('SIGTERM');

        setTimeout(() => {
          if (server.process) {
            this.emit('console', { uuid, text: '[Kinetictyl] Server process unresponsive. Sending SIGKILL...\n' });
            server.process.kill('SIGKILL');
          }
        }, 15000);
      }
    }, 60000);

    server.process.once('close', () => clearTimeout(timeout));
  }

  public killServer(uuid: string): void {
    const server = this.servers.get(uuid);
    if (server?.process) {
      server.process.kill('SIGKILL');
      server.status = ServerStatus.OFFLINE;
      this.emitStatus(uuid, ServerStatus.OFFLINE);
    }
  }

  private handleCrash(server: ManagedServer): void {
    const now = Date.now();

    // Reset restart counter if more than 10 minutes have passed
    if (now - server.lastRestartAt > 10 * 60 * 1000) {
      server.restartCount = 0;
    }

    server.restartCount += 1;
    server.lastRestartAt = now;

    if (server.restartCount <= 3) {
      server.status = ServerStatus.STARTING;
      this.emitStatus(server.uuid, ServerStatus.STARTING);
      this.emit('console', {
        uuid: server.uuid,
        text: `[Kinetictyl] Crash detected! Auto-restarting (Attempt ${server.restartCount}/3)...\n`
      });
      setTimeout(() => this.startServer(server.uuid), 2000 * server.restartCount);
    } else {
      server.status = ServerStatus.CRASHED;
      this.emitStatus(server.uuid, ServerStatus.CRASHED);
      this.emit('console', {
        uuid: server.uuid,
        text: '[Kinetictyl] Maximum crash-restart threshold exceeded. Server marked CRASHED.\n'
      });
    }
  }

  private emitStatus(uuid: string, status: ServerStatus): void {
    this.emit('status', { uuid, status });
  }
}
