import { Response } from 'express';
import { prisma } from '../database/client.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { UserRole } from '@kinetictyl/shared';

export async function listServersController(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === UserRole.ADMIN;

    const servers = await prisma.server.findMany({
      where: isAdmin ? {} : { ownerId: userId },
      include: { node: { select: { name: true, address: true } } }
    });

    const formatted = servers.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      version: s.version,
      port: s.port,
      status: s.status,
      ramLimit: Number(s.ramLimit),
      diskLimit: Number(s.diskLimit),
      cpuLimit: s.cpuLimit,
      suspended: s.suspended,
      address: `${s.node.address}:${s.port}`
    }));

    return res.json({ success: true, servers: formatted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function getServerController(req: AuthenticatedRequest, res: Response) {
  try {
    const { uuid } = req.params;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === UserRole.ADMIN;

    const server = await prisma.server.findUnique({
      where: { id: uuid },
      include: { node: true }
    });

    if (!server || (!isAdmin && server.ownerId !== userId)) {
      return res.status(404).json({ success: false, error: "Server not found." });
    }

    return res.json({
      success: true,
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        version: server.version,
        port: server.port,
        status: server.status,
        ramLimit: Number(server.ramLimit),
        diskLimit: Number(server.diskLimit),
        cpuLimit: server.cpuLimit,
        javaOverride: server.javaOverride,
        suspended: server.suspended,
        nodeName: server.node.name,
        address: `${server.node.address}:${server.port}`
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
