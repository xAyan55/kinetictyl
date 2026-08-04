import { Response } from 'express';
import { prisma } from '../database/client.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { CreateServerSchema } from '@kinetictyl/shared';
import { randomUUID } from 'node:crypto';

export async function getAdminOverviewController(req: AuthenticatedRequest, res: Response) {
  try {
    const totalUsers = await prisma.user.count();
    const totalServers = await prisma.server.count();
    const serversOnline = await prisma.server.count({ where: { status: 'running' } });
    const totalNodes = await prisma.node.count();

    const recentAuditLogs = await prisma.auditLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { username: true } } }
    });

    return res.json({
      success: true,
      stats: {
        totalUsers,
        totalServers,
        serversOnline,
        totalNodes
      },
      auditLogs: recentAuditLogs
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function createServerAdminController(req: AuthenticatedRequest, res: Response) {
  try {
    const parseResult = CreateServerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, errors: parseResult.error.errors });
    }

    const {
      name,
      ownerId,
      nodeId,
      type,
      version,
      buildUuid,
      port,
      ramLimitMB,
      diskLimitMB,
      cpuLimitPct,
      javaOverride
    } = parseResult.data;

    // Verify owner exists
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
      return res.status(404).json({ success: false, error: "Target owner user does not exist." });
    }

    // Verify node exists
    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
      return res.status(404).json({ success: false, error: "Target node does not exist." });
    }

    const uuid = randomUUID();
    const ramLimit = BigInt(ramLimitMB) * 1024n * 1024n;
    const diskLimit = BigInt(diskLimitMB) * 1024n * 1024n;

    const server = await prisma.server.create({
      data: {
        id: uuid,
        name,
        ownerId,
        nodeId,
        type,
        version,
        buildUuid,
        port,
        ramLimit,
        diskLimit,
        cpuLimit: cpuLimitPct,
        javaOverride,
        status: 'installing'
      }
    });

    // Notify agent via provisioning POST
    try {
      await fetch(`http://127.0.0.1:8081/api/servers/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid,
          type,
          version,
          ramLimitMB,
          cpuLimitPct,
          javaOverride,
          steps: [
            {
              type: 'download',
              url: `https://mcjars.app/api/v3/builds/${buildUuid}/download`,
              file: 'server.jar'
            }
          ]
        })
      });
    } catch (agentErr) {
      console.error("[Panel Admin] Agent provisioning request failed:", agentErr);
    }

    return res.status(201).json({
      success: true,
      server: {
        id: server.id,
        name: server.name,
        port: server.port,
        status: server.status
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function listNodesAdminController(req: AuthenticatedRequest, res: Response) {
  try {
    const nodes = await prisma.node.findMany({
      include: { _count: { select: { servers: true } } }
    });

    const formatted = nodes.map(n => ({
      id: n.id,
      name: n.name,
      address: n.address,
      cpuCores: n.cpuCores,
      ramTotal: Number(n.ramTotal),
      diskTotal: Number(n.diskTotal),
      isLocal: n.isLocal,
      serverCount: n._count.servers
    }));

    return res.json({ success: true, nodes: formatted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function listUsersAdminController(req: AuthenticatedRequest, res: Response) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { servers: true } }
      }
    });

    return res.json({ success: true, users });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
