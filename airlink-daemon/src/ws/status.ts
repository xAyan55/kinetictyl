import type { WebSocket } from 'ws';
import { getServerMetrics, getServerStatus } from '../handlers/processManager';

const POLL_MS = 2000;

export function startStatusPolling(uuid: string, ws: WebSocket): ReturnType<typeof setInterval> {
  sendState(uuid, ws);
  sendStats(uuid, ws);

  let tick = 0;
  return setInterval(async () => {
    if (ws.readyState !== 1) return;
    tick++;
    sendState(uuid, ws);
    if (tick % 2 === 0) await sendStats(uuid, ws);
  }, POLL_MS);
}

function sendState(uuid: string, ws: WebSocket): void {
  if (ws.readyState !== 1) return;
  const status = getServerStatus(uuid);
  ws.send(JSON.stringify({ event: 'state', data: { running: status.running, state: status.state } }));
}

async function sendStats(uuid: string, ws: WebSocket): Promise<void> {
  if (ws.readyState !== 1) return;
  try {
    const metrics = await getServerMetrics(uuid);
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          event: 'stats',
          data: {
            running: metrics.running,
            memory: {
              usage: metrics.memory * 1024 * 1024,
              limit: metrics.maxMemory * 1024 * 1024,
              percentage: metrics.maxMemory > 0 ? (metrics.memory / metrics.maxMemory) * 100 : 0,
            },
            cpu: { percentage: metrics.cpu },
            storage: { usage: metrics.disk },
          },
        }),
      );
    }
  } catch {}
}

export function stopStatusPolling(timer: ReturnType<typeof setInterval>): void {
  clearInterval(timer);
}
