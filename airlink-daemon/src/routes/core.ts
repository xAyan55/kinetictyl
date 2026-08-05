import { existsSync, readFileSync } from 'fs';
import config from '../config.js';
import { getTotalStats } from '../handlers/stats.js';

let daemonVersion = '1.0.0';
try {
  if (existsSync('storage/config.json')) {
    const cfg = JSON.parse(readFileSync('storage/config.json', 'utf8')) as {
      meta?: { version?: string };
    };
    daemonVersion = cfg?.meta?.version ?? daemonVersion;
  }
} catch {}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || !parts.length) parts.push(`${m}m`);
  return parts.join(' ');
}

export function handleRoot(_req: Request): Response {
  return new Response(
    JSON.stringify({
      versionFamily: 1,
      versionRelease: `Kinetictyl Agent ${daemonVersion}`,
      status: 'Online',
      remote: config.remote,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

export function handleStats(_req: Request): Response {
  try {
    const totalStats = getTotalStats();
    const uptime = formatUptime(process.uptime());
    return new Response(JSON.stringify({ totalStats, uptime }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: 'failed to fetch stats' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
