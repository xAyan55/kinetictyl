import express, { Request as ExpressReq, Response as ExpressRes } from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import config from './config.js';
import { detectSystemJava } from './handlers/javaManager.js';
import { sendCommand } from './handlers/processManager.js';
import logger, { drawHeader } from './logger.js';
import { handleHttpRequest } from './router.js';
import { attachToContainer } from './ws/attach.js';
import { subscribe } from './ws/events.js';
import { startStatusPolling, stopStatusPolling } from './ws/status.js';

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ limit: '100mb', type: 'application/octet-stream' }));

// Forward Express requests to our fetch-style router
app.all('*', async (req: ExpressReq, res: ExpressRes) => {
  const scheme = req.secure ? 'https' : 'http';
  const url = `${scheme}://${req.headers.host || 'localhost'}${req.url}`;
  
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  let body: any = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (req.body && Object.keys(req.body).length > 0) {
      body = JSON.stringify(req.body);
    }
  }

  const webReq = new Request(url, {
    method: req.method,
    headers,
    body,
  });

  const webRes = await handleHttpRequest(webReq, req.ip || '127.0.0.1');

  res.status(webRes.status);
  webRes.headers.forEach((val, key) => {
    res.setHeader(key, val);
  });

  const buffer = await webRes.arrayBuffer();
  res.send(Buffer.from(buffer));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

interface CustomWs extends WebSocket {
  route?: 'container' | 'containerstatus' | 'containerevents';
  containerId?: string;
  authed?: boolean;
  authTimer?: NodeJS.Timeout;
  statusTimer?: NodeJS.Timeout;
  unsubEvents?: () => void;
  _logCleanup?: () => void;
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const route = parts[0] as 'container' | 'containerstatus' | 'containerevents';
  const containerId = parts[1];

  const validRoutes = ['container', 'containerstatus', 'containerevents', 'server', 'serverstatus', 'serverevents'];
  if (!validRoutes.includes(route) || !containerId) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const customWs = ws as CustomWs;
    customWs.route = route.replace('server', 'container') as any;
    customWs.containerId = containerId;
    customWs.authed = false;
    wss.emit('connection', customWs, request);
  });
});

wss.on('connection', (ws: CustomWs) => {
  const AUTH_TIMEOUT_MS = 10000;

  ws.authTimer = setTimeout(() => {
    if (!ws.authed) {
      ws.send(JSON.stringify({ error: 'authentication timeout' }));
      ws.close(1008, 'auth timeout');
    }
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (raw) => {
    let msg: any = null;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      msg = { event: 'CMD', command: raw.toString().trim() };
    }

    const eventName = (msg.event || '').toLowerCase();

    if (eventName === 'auth') {
      const key = Array.isArray(msg.args) ? msg.args[0] : msg.key || msg.token;
      if (key !== config.key) {
        ws.send(JSON.stringify({ error: 'invalid key' }));
        ws.close(1008, 'auth failed');
        return;
      }

      ws.authed = true;
      if (ws.authTimer) clearTimeout(ws.authTimer);

      if (ws.route === 'container' && ws.containerId) {
        attachToContainer(ws.containerId, ws);
      } else if (ws.route === 'containerstatus' && ws.containerId) {
        ws.statusTimer = startStatusPolling(ws.containerId, ws);
      } else if (ws.route === 'containerevents' && ws.containerId) {
        ws.unsubEvents = subscribe(ws.containerId, (ev) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'lifecycle', data: ev }));
          }
        });
      }
      return;
    }

    if (!ws.authed) {
      ws.send(JSON.stringify({ error: 'not authenticated' }));
      ws.close(1008, 'auth required');
      return;
    }

    if (['cmd', 'command', 'input', 'stdin', 'sendcommand'].includes(eventName)) {
      const cmd = msg.command || (Array.isArray(msg.args) ? msg.args.join(' ') : '');
      if (cmd && ws.containerId) {
        sendCommand(ws.containerId, cmd);
      }
    }
  });

  ws.on('close', () => {
    if (ws.authTimer) clearTimeout(ws.authTimer);
    if (ws.statusTimer) stopStatusPolling(ws.statusTimer);
    if (ws.unsubEvents) ws.unsubEvents();
    if (ws._logCleanup) ws._logCleanup();
  });
});

drawHeader(config.version, config.port);
detectSystemJava();

server.listen(config.port, '0.0.0.0', () => {
  logger.ok(`Kinetictyl Agent ready on port ${config.port}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
