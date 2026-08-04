import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const logsPath = join(process.cwd(), 'storage/install_logs.json');

async function readState(): Promise<Record<string, string>> {
  try {
    if (existsSync(logsPath)) {
      const text = readFileSync(logsPath, 'utf8');
      return JSON.parse(text);
    }
    return {};
  } catch {
    return {};
  }
}

async function writeState(data: Record<string, string>): Promise<void> {
  const dir = dirname(logsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(logsPath, JSON.stringify(data, null, 2), 'utf8');
}

export async function setServerState(containerId: string, state: string): Promise<void> {
  const logs = await readState();
  logs[containerId] = state;
  await writeState(logs);
}

export async function getServerState(containerId: string): Promise<string | undefined> {
  const logs = await readState();
  return logs[containerId];
}

export async function getAllServerStates(): Promise<Record<string, string>> {
  return readState();
}

export async function removeServerState(containerId: string): Promise<void> {
  const logs = await readState();
  if (logs[containerId]) {
    delete logs[containerId];
    await writeState(logs);
  }
}
