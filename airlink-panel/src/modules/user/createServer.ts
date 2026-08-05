import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import { ResourceService } from '../../services/ResourceService';
import { ServerProvisioner } from '../../services/ServerProvisioner';
import { AllocationType } from '@prisma/client';
import { daemonSchemeSync } from '../../handlers/utils/core/daemonRequest';
import axios from 'axios';

const userCreateServerModule: Module = {
  info: {
    name: 'User Create Server Module',
    description: 'Enables normal users to provision Minecraft servers using their allocated resource quotas.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'Kinetictyl',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/user/create-server', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session?.user?.id;
        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (!user) return res.redirect('/login');

        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        if (!settings?.allowUserCreateServer) {
          return res.redirect('/dashboard');
        }

        const [availMem, availCpu, availDisk, availServers] = await Promise.all([
          ResourceService.getAvailable(userId, AllocationType.RAM),
          ResourceService.getAvailable(userId, AllocationType.CPU),
          ResourceService.getAvailable(userId, AllocationType.DISK),
          ResourceService.getAvailable(userId, AllocationType.SERVER_SLOTS),
        ]);

        const images = await prisma.images.findMany();
        const nodes = await prisma.node.findMany();

        res.render('user/create-server', {
          user,
          req,
          settings,
          images,
          nodes,
          quota: {
            memory: availMem,
            cpu: availCpu,
            disk: availDisk,
            servers: availServers,
          },
        });
      } catch (error) {
        logger.error('Error rendering user create server page:', error);
        res.redirect('/dashboard');
      }
    });

    router.post('/user/create-server', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session?.user?.id;
        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        if (!settings?.allowUserCreateServer) {
          return res.status(403).json({ error: 'Server creation is not enabled for users.' });
        }

        const {
          name,
          description,
          nodeId,
          imageId,
          Memory,
          Cpu,
          Storage,
          javaVersion,
          softwareType,
          softwareVersion,
        } = req.body;

        if (!name) {
          return res.status(400).json({ error: 'Server name is required.' });
        }

        const server = await ServerProvisioner.provisionServer(userId, {
          name,
          description,
          nodeId: nodeId ? parseInt(nodeId) : undefined,
          imageId: imageId ? parseInt(imageId) : 1,
          memory: Memory ? parseInt(Memory) : undefined,
          cpu: Cpu ? parseInt(Cpu) : undefined,
          storage: Storage ? parseInt(Storage) : undefined,
          javaVersion: javaVersion || '17',
          softwareType: softwareType || 'paper',
          softwareVersion: softwareVersion || 'latest',
        });

        res.status(200).json({ success: true, serverUUID: server.UUID });
      } catch (error: any) {
        logger.error('Error creating user server:', error);
        res.status(500).json({ error: error.message || 'Failed to create server.' });
      }
    });

    router.delete('/user/server/:uuid', isAuthenticated(), async (req: Request, res: Response) => {
      try {
        const userId = req.session?.user?.id;
        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        if (!settings?.allowUserDeleteServer) {
          return res.status(403).json({ error: 'Server deletion is not enabled for users.' });
        }

        const server = await prisma.server.findUnique({
          where: { UUID: String(req.params.uuid) },
          include: { node: true },
        });

        if (!server) return res.status(404).json({ error: 'Server not found.' });
        if (server.ownerId !== userId) return res.status(403).json({ error: 'This is not your server.' });

        const force = req.query.force === 'true';

        if (!force) {
          try {
            await axios.delete(`${daemonSchemeSync()}://${server.node.address}:${server.node.port}/container`, {
              auth: { username: 'CynexGP', password: server.node.key },
              headers: { 'Content-Type': 'application/json' },
              data: { id: server.UUID },
            });
          } catch (err: any) {
            const isGone =
              err.response?.status === 404 ||
              err.response?.data?.error?.includes('not exist');

            if (!isGone) {
              return res.status(500).json({
                error: 'Failed to delete server process on node. Use ?force=true to delete from panel anyway.',
              });
            }
          }
        }

        await prisma.server.delete({ where: { id: server.id } });
        logger.info(`User ${user.username} deleted server ${server.name} (${server.UUID})`);

        res.status(200).json({ success: true, message: 'Server deleted successfully.' });
      } catch (error) {
        logger.error('Error deleting server:', error);
        res.status(500).json({ error: 'Failed to delete server.' });
      }
    });

    return router;
  },
};

export default userCreateServerModule;
