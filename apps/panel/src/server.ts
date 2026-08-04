import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';

import { CONFIG } from './config/index.js';
import { prisma } from './database/client.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { registerController, loginController, logoutController, meController } from './controllers/auth.js';
import { listServersController, getServerController } from './controllers/server.js';
import { getAdminOverviewController, createServerAdminController, listNodesAdminController, listUsersAdminController } from './controllers/admin.js';
import { getMcJarsTypesController, getMcJarsVersionsController } from './controllers/mcjars.js';
import { sha256 } from '@kinetictyl/shared';

export function createPanelApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({ origin: true, credentials: true }));

  // --- Auth Routes ---
  app.post('/auth/register', registerController);
  app.post('/auth/login', loginController);
  app.post('/auth/logout', logoutController);
  app.get('/auth/me', requireAuth, meController);

  // --- User Server Routes ---
  app.get('/api/servers', requireAuth, listServersController);
  app.get('/api/servers/:uuid', requireAuth, getServerController);

  // --- Admin Routes ---
  app.get('/api/admin/overview', requireAuth, requireAdmin, getAdminOverviewController);
  app.post('/api/admin/servers', requireAuth, requireAdmin, createServerAdminController);
  app.get('/api/admin/nodes', requireAuth, requireAdmin, listNodesAdminController);
  app.get('/api/admin/users', requireAuth, requireAdmin, listUsersAdminController);

  // --- MCJars API Routes ---
  app.get('/api/mcjars/types', getMcJarsTypesController);
  app.get('/api/mcjars/versions/:type', getMcJarsVersionsController);

  // Serve Built Frontend Assets if present
  const frontendDist = resolve('../frontend/dist');
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => res.sendFile(join(frontendDist, 'index.html')));
  }

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    // Proxy WebSocket traffic to local Agent Daemon
    const agentWs = new WebSocket(`ws://127.0.0.1:8081${req.url}`);

    ws.on('message', (msg) => {
      if (agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(msg.toString());
      }
    });

    agentWs.on('message', (msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg.toString());
      }
    });

    ws.on('close', () => agentWs.close());
    agentWs.on('close', () => ws.close());
  });

  return { httpServer, app };
}

/**
 * Auto-provisions the 'local' node on first boot if no nodes exist.
 */
export async function autoProvisionLocalNode() {
  const nodeCount = await prisma.node.count();
  if (nodeCount === 0) {
    const cpuCores = cpus().length;
    const ramTotal = BigInt(totalmem());
    const diskTotal = 100n * 1024n * 1024n * 1024n; // 100GB default
    const agentTokenHash = sha256("default_local_agent_token");

    await prisma.node.create({
      data: {
        name: "local",
        address: "127.0.0.1",
        agentTokenHash,
        cpuCores,
        ramTotal,
        diskTotal,
        portRangeStart: 25565,
        portRangeEnd: 25600,
        isLocal: true
      }
    });
    console.log(`[Panel Setup] Auto-created local node with ${cpuCores} CPU cores and ${Math.floor(Number(ramTotal)/(1024*1024*1024))}GB RAM.`);
  }
}
