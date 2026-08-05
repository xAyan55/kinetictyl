import type { WebSocket } from 'ws';
import { getLogBuffer, processEvents } from '../handlers/processManager.js';
import logger from '../logger.js';

export async function attachToContainer(uuid: string, ws: WebSocket & { _logCleanup?: () => void }): Promise<void> {
  try {
    // 1. Send recent buffered log history
    const logs = getLogBuffer(uuid);
    for (const line of logs) {
      if (ws.readyState === 1) {
        ws.send(line + '\n');
      }
    }

    // 2. Listen to real-time log events
    const onLog = (data: { uuid: string; line: string }) => {
      if (data.uuid === uuid && ws.readyState === 1) {
        ws.send(data.line + '\n');
      }
    };

    processEvents.on('log', onLog);

    ws._logCleanup = () => {
      processEvents.off('log', onLog);
    };
  } catch (err) {
    logger.error(`Error attaching log stream for server ${uuid}:`, err);
    if (ws.readyState === 1) {
      ws.close(1000, 'Server logs unavailable');
    }
  }
}
