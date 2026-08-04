import { platform } from 'node:os';
import { exec } from 'node:child_process';

export interface ProcessLimits {
  ramLimitBytes: bigint | number;
  cpuLimitPct: number;
  uid?: number;
}

/**
 * Builds the process execution arguments or system wrappers for applying CPU and RAM limits.
 */
export function buildExecutionCommand(
  javaBinaryPath: string,
  jvmArgs: string[],
  jarPath: string,
  limits: ProcessLimits
): { command: string; args: string[] } {
  const currentPlatform = platform();

  if (currentPlatform === 'linux') {
    // Wrap process in a transient systemd cgroup scope for Linux
    const ramMB = Math.floor(Number(limits.ramLimitBytes) / (1024 * 1024));
    const cpuWeight = Math.max(1, Math.floor((limits.cpuLimitPct / 100) * 100));
    
    const systemdArgs = [
      '--scope',
      `-p`, `MemoryMax=${ramMB}M`,
      `-p`, `CPUWeight=${cpuWeight}`,
    ];

    if (limits.uid) {
      systemdArgs.push(`--user-uid=${limits.uid}`);
    }

    return {
      command: 'systemd-run',
      args: [...systemdArgs, javaBinaryPath, ...jvmArgs, '-jar', jarPath, 'nogui']
    };
  }

  // Windows / Fallback execution
  return {
    command: javaBinaryPath,
    args: [...jvmArgs, '-jar', jarPath, 'nogui']
  };
}
