import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import logger from '../../handlers/logger';
import axios from 'axios';
import { queueer } from '../../handlers/queueer';
import { getParamAsNumber } from '../../utils/typeHelpers';
import { daemonSchemeSync } from '../../handlers/utils/core/daemonRequest';
import {
  getUsedExternalPorts,
  normalizeServerPorts,
  parseImagePortRequirements,
  parseServerPorts,
  serializeServerPorts,
  validatePortAssignments,
} from '../../handlers/utils/server/ports';


const adminModule: Module = {
  info: {
    name: 'Admin Module',
    description: 'This file is for admin functionality.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author: 'CynexGP',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/api/mcjars/versions/:type', async (req: Request, res: Response) => {
      const typeParam = Array.isArray(req.params.type) ? req.params.type[0] : req.params.type;
      const type = (typeParam || 'paper').toLowerCase();
      try {
        const apiRes = await axios.get(`https://api.mcjars.app/v2/builds/${type}`, { timeout: 5000 });
        if (apiRes.data && Array.isArray(apiRes.data.versions)) {
          return res.json({ versions: apiRes.data.versions });
        }
        if (apiRes.data && typeof apiRes.data === 'object') {
          return res.json({ versions: Object.keys(apiRes.data) });
        }
      } catch {}
      const fallbacks: Record<string, string[]> = {
        paper: ['1.21.4', '1.21.3', '1.21.1', '1.20.4', '1.20.2', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'],
        purpur: ['1.21.4', '1.21.3', '1.21.1', '1.20.4', '1.20.2', '1.20.1', '1.19.4', '1.18.2', '1.16.5'],
        vanilla: ['1.21.4', '1.21.3', '1.21.1', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'],
        spigot: ['1.21.4', '1.21.1', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'],
        fabric: ['1.21.4', '1.21.3', '1.21.1', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5'],
        forge: ['1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2'],
        neoforge: ['1.21.4', '1.21.1', '1.20.4'],
      };
      return res.json({ versions: fallbacks[type] || fallbacks.paper });
    });

    router.get(
      '/admin/servers',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const servers = await prisma.server.findMany({
            include: {
              node: true,
              owner: true,
            },
          });
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/servers/servers', { user, req, settings, servers });
        } catch (error: unknown) {
          logger.error('Error fetching servers:', error);
          return res.redirect('/login');
        }
      },
    );

    router.get(
      '/admin/servers/edit/:id',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            res.redirect('/login');
            return;
          }

          const serverId = getParamAsNumber(req.params.id);
          if (isNaN(serverId)) {
            res.status(400).send('Invalid server ID');
            return;
          }

          const server = await prisma.server.findUnique({
            where: { id: serverId },
            include: {
              node: true,
              owner: true,
              image: true,
            },
          });

          if (!server) {
            res.status(404).send('Server not found');
            return;
          }

          const users = await prisma.users.findMany();
          const nodes = await prisma.node.findMany();
          const images = await prisma.images.findMany();
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/servers/edit', {
            user,
            req,
            settings,
            server,
            nodes,
            images,
            users,
          });
        } catch (error: unknown) {
          logger.error('Error fetching server for editing:', error);
          res.redirect('/admin/servers');
          return;
        }
      },
    );

    router.post(
      '/admin/servers/edit/:id',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }

          const serverId = getParamAsNumber(req.params.id);
          if (isNaN(serverId)) {
            res.status(400).json({ error: 'Invalid server ID' });
            return;
          }

          const server = await prisma.server.findUnique({
            where: { id: serverId },
            include: { node: true, image: true },
          });

          if (!server) {
            res.status(404).json({ error: 'Server not found' });
            return;
          }

          const {
            name,
            description,
            nodeId,
            imageId,
            Memory,
            Cpu,
            Storage,
            ownerId,
            allowStartupEdit,
            Suspended,
            StartCommand,
            ports,
          } = req.body;

          // Validate required fields
          if (!name || !nodeId || !imageId || !Memory || !Cpu || !Storage || !ownerId) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
          }

          // Check if suspension status is changing
          const currentSuspendedState = server.Suspended;
          const newSuspendedState = Suspended === 'true';
          const suspensionChanged = currentSuspendedState !== newSuspendedState;

          const selectedImage = await prisma.images.findUnique({ where: { id: parseInt(imageId) } });
          if (!selectedImage) {
            res.status(400).json({ error: 'Image not found' });
            return;
          }

          const submittedPorts = normalizeServerPorts(ports);
          const minPorts = parseImagePortRequirements(selectedImage.portRequirements).length;
          const allocatedPorts = server.nodeId === parseInt(nodeId)
            ? JSON.parse(server.node.allocatedPorts || '[]')
            : JSON.parse((await prisma.node.findUnique({ where: { id: parseInt(nodeId) } }))?.allocatedPorts || '[]');
          const existingServers = await prisma.server.findMany({
            where: { nodeId: parseInt(nodeId), NOT: { id: serverId } },
          });
          const portError = validatePortAssignments(submittedPorts, allocatedPorts, getUsedExternalPorts(existingServers), minPorts);
          if (portError) {
            res.status(400).json({ error: portError });
            return;
          }

          await prisma.server.update({
            where: { id: serverId },
            data: {
              name,
              description,
              ownerId: parseInt(ownerId),
              nodeId: parseInt(nodeId),
              imageId: parseInt(imageId),
              Memory: parseInt(Memory),
              Cpu: parseInt(Cpu),
              Storage: parseInt(Storage),
              StartCommand,
              Ports: serializeServerPorts(submittedPorts),
              Suspended: newSuspendedState,
            },
          });

          // Update allowStartupEdit field using raw SQL
          await prisma.$executeRaw`UPDATE "Server" SET "allowStartupEdit" = ${allowStartupEdit === 'true'} WHERE "id" = ${serverId}`;

          // If server is being suspended, stop it
          if (suspensionChanged && newSuspendedState) {
            try {
              logger.info(`Stopping server ${server.UUID} due to suspension`);

              const stopRequestData = {
                method: 'POST',
                url: `${daemonSchemeSync()}://${server.node.address}:${server.node.port}/container/stop`,
                auth: {
                  username: 'CynexGP',
                  password: server.node.key,
                },
                headers: {
                  'Content-Type': 'application/json',
                },
                data: {
                  id: String(server.UUID),
                  stopCmd: server.image?.stop || 'stop',
                },
              };

              await axios(stopRequestData);
              logger.info(`Server ${server.UUID} stopped successfully due to suspension`);
            } catch (stopError) {
              logger.error(`Error stopping server ${server.UUID} during suspension:`, stopError);
              // Continue with the update even if stopping fails
            }
          }

          logger.info(`Server ${serverId} updated successfully`);
          res.status(200).json({ success: true });
        } catch (error: unknown) {
          logger.error('Error updating server:', error);
          res.status(500).json({ error: 'Failed to update server' });
          return;
        }
      },
    );

    router.get(
      '/admin/servers/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const users = await prisma.users.findMany();
          const nodes = await prisma.node.findMany();
          const images = await prisma.images.findMany();
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/servers/create', {
            user,
            req,
            settings,
            nodes,
            images,
            users,
          });
        } catch (error: unknown) {
          logger.error('Error fetching data for server creation:', error);
          return res.redirect('/login');
        }
      },
    );

    router.post(
      '/admin/servers/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        const {
          name,
          description,
          nodeId,
          Ports,
          ports,
          Memory,
          Cpu,
          Storage,
          ownerId,
          softwareType,
          softwareVersion,
          javaVersion,
          flags,
          eula,
          onlineMode,
          whitelist,
          autoRestart,
        } = req.body;

        const userId = parseInt(ownerId, 10);
        if (!name || !nodeId || !Memory || !Cpu || !Storage || isNaN(userId)) {
          res.status(400).send('Missing required fields');
          return;
        }

        try {
          const node = await prisma.node.findUnique({
            where: { id: parseInt(nodeId, 10) },
          });

          if (!node) {
            res.status(400).send('Selected node not found');
            return;
          }

          let allocatedPorts: number[] = [];
          try {
            if (node.allocatedPorts) {
              allocatedPorts = JSON.parse(node.allocatedPorts);
            }
          } catch (error) {
            logger.error('Error parsing allocated ports:', error);
          }
          if (allocatedPorts.length === 0) {
            allocatedPorts = [25565, 25566, 25567, 25568, 25569];
          }

          const existingServers = await prisma.server.findMany({
            where: { nodeId: parseInt(nodeId, 10) },
          });
          const submittedPorts = ports ? normalizeServerPorts(ports) : parseServerPorts(`[{"Port":"${Ports || '25565'}","primary":true}]`);
          const portError = validatePortAssignments(submittedPorts, allocatedPorts, getUsedExternalPorts(existingServers), 1);
          if (portError) {
            res.status(400).send(portError);
            return;
          }

          const Port = serializeServerPorts(submittedPorts);
          const soft = (softwareType || 'paper').toLowerCase();
          const ver = softwareVersion || '1.21.4';
          const java = javaVersion || '21';
          const startFlags = flags || '-Xms128M -Xmx{{SERVER_MEMORY}}M';
          const startupCommand = `java ${startFlags} -jar server.jar nogui`;

          // Find or create default image record
          let image = await prisma.images.findFirst({ where: { name: { contains: soft } } });
          if (!image) {
            image = await prisma.images.findFirst();
          }
          if (!image) {
            image = await prisma.images.create({
              data: {
                name: 'Minecraft Server',
                description: 'Native Minecraft Server',
                startup: startupCommand,
              },
            });
          }

          const createdServer = await prisma.server.create({
            data: {
              name: name.trim(),
              description: description ? description.trim() : null,
              ownerId: userId,
              nodeId: parseInt(nodeId, 10),
              imageId: image.id,
              Ports: Port || '[{"Port": "25565:25565", "primary": true}]',
              Memory: parseInt(Memory, 10) || 1024,
              Cpu: parseInt(Cpu, 10) || 100,
              Storage: parseInt(Storage, 10) || 20480,
              softwareType: soft,
              softwareVersion: ver,
              javaVersion: java,
              StartCommand: startupCommand,
              Installing: true,
              Queued: true,
            },
          });

          // Trigger deployment via QueueManager
          const primaryPort = submittedPorts[0]?.externalPort || 25565;
          const { QueueManager } = await import('../../services/QueueManager');
          QueueManager.triggerDeployment(createdServer.UUID, [primaryPort]);

          logger.info(`Admin created server ${createdServer.name} (${createdServer.UUID})`);
          res.status(200).send('Server created successfully');
        } catch (error: unknown) {
          logger.error('Error creating server:', error);
          res.status(500).send('Error creating server');
        }
      },
    );

    router.get(
      '/admin/server/delete/:id',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        const { id } = req.params;

        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            res.redirect('/login');
            return;
          }

          const serverId = getParamAsNumber(id);
          if (isNaN(serverId)) {
            res.status(400).send('Invalid server ID');
            return;
          }

          const server = await prisma.server.findUnique({
            where: { id: serverId },
            include: { node: true, image: true, owner: true },
          });

          if (!server) {
            res.status(404).send('Server not found');
            return;
          }

          const force = req.query.force === 'true';

          try {
            if (!force) {
              logger.info(`Deleting container ${server.UUID} on node ${server.node.address}:${server.node.port}`);

              try {
                const response = await axios.delete(
                  `${daemonSchemeSync()}://${server.node.address}:${server.node.port}/container`,
                  {
                    auth: {
                      username: 'CynexGP',
                      password: server.node.key,
                    },
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    data: {
                      id: server.UUID,
                    },
                  },
                );

                if (response.status !== 200) {
                  throw new Error(`Daemon returned status ${response.status}: ${JSON.stringify(response.data)}`);
                }

                logger.info(`Successfully deleted container ${server.UUID} on daemon`);
              } catch (error: unknown) {
                logger.error('Error deleting container on daemon:', error);

                const daemonError = error as any;
                const isNotFoundError =
                  daemonError.response &&
                  (daemonError.response.status === 404 ||
                   (daemonError.response.data && daemonError.response.data.error &&
                    typeof daemonError.response.data.error === 'string' &&
                    daemonError.response.data.error.includes('not exist')));

                if (!isNotFoundError) {
                  throw new Error(`Daemon unreachable${daemonError?.message ? `: ${String(daemonError.message)}` : ''}. Use ?force=true to remove from panel only.`, { cause: error });
                } else {
                  logger.warn(`Container ${server.UUID} not found on daemon, proceeding with database cleanup`);
                }
              }
            }

            logger.info(`Deleting server ${serverId} from database`);
            await prisma.$transaction(async (tx) => {
              await tx.sftpCredential.deleteMany({
                where: { serverId: server.UUID },
              });
              await tx.backup.deleteMany({
                where: { serverId: server.UUID },
              });
              await tx.serverFolderMember.deleteMany({
                where: { serverUUID: server.UUID },
              });
              await tx.server.delete({ where: { id: serverId } });
            });

            logger.info(`Server ${serverId} successfully deleted`);
            res.redirect('/admin/servers');
            return;
          } catch (error: unknown) {
            logger.error('Error deleting server:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            res.status(500).send(`Failed to delete server: ${errorMessage}`);
            return;
          }
        } catch (error: unknown) {
          logger.error('Error in delete server route:', error);
          res.status(500).send('Error deleting server');
          return;
        }
      },
    );

    return router;
  },
};


export default adminModule;
