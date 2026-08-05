import prisma from '../db';
import logger from '../handlers/logger';
import { NodeAllocator } from './NodeAllocator';
import { QueueManager } from './QueueManager';
import { ResourceService } from './ResourceService';
import { ConfigService } from './config/ConfigService';
import { AllocationType } from '@prisma/client';
import {
  getUsedExternalPorts,
  parseImagePortRequirements,
  serializeServerPorts,
} from '../handlers/utils/server/ports';

function pickAvailablePorts(allocatedPorts: number[], usedPorts: number[], count: number): number[] {
  const picked: number[] = [];
  for (const port of allocatedPorts) {
    if (!usedPorts.includes(port)) picked.push(port);
    if (picked.length === count) return picked;
  }
  return picked;
}

export interface ProvisionOptions {
  name: string;
  description?: string;
  nodeId?: number;
  imageId?: number;
  memory?: number;
  cpu?: number;
  storage?: number;
  javaVersion?: string;
  softwareType?: string;
  softwareVersion?: string;
}

export class ServerProvisioner {
  static async provisionServer(userId: number, options: ProvisionOptions) {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found.');

    // 1. Resolve resource limits
    const defaults = await ConfigService.defaults();
    const [availMem, availCpu, availDisk] = await Promise.all([
      ResourceService.getAvailable(userId, AllocationType.RAM),
      ResourceService.getAvailable(userId, AllocationType.CPU),
      ResourceService.getAvailable(userId, AllocationType.DISK),
    ]);
    const maxMem = availMem > 0 ? availMem : (defaults.defaultMemory || 2048);
    const maxCpu = availCpu > 0 ? availCpu : (defaults.defaultCpu || 200);
    const maxStor = availDisk > 0 ? availDisk : (defaults.defaultDisk || 10240);

    let memory = Math.min(options.memory || 1024, maxMem);
    let cpu = Math.min(options.cpu || 100, maxCpu);
    let storage = Math.min(options.storage || 5120, maxStor);

    // 2. Resolve Node (Auto-create local node if none exists)
    let node: any = null;
    if (options.nodeId) {
      node = await prisma.node.findUnique({ where: { id: options.nodeId } });
    } else {
      let existingNodes = await prisma.node.findMany();
      if (existingNodes.length === 0) {
        node = await prisma.node.create({
          data: {
            name: 'Local Node',
            address: '127.0.0.1',
            port: 3001,
            key: 'default_key_change_me_12345',
            ram: 16384,
            cpu: 800,
            disk: 102400,
            allocatedPorts: JSON.stringify([25565, 25566, 25567, 25568, 25569, 25570]),
            sftpPort: 3003,
          },
        });
      } else {
        node = await NodeAllocator.findBestNode(memory, storage);
        if (!node) node = existingNodes[0];
      }
    }

    if (!node) {
      throw new Error('No suitable node available for deployment.');
    }

    // 3. Resolve Ports
    let allocatedPorts: number[] = [];
    try {
      if (node.allocatedPorts) allocatedPorts = JSON.parse(node.allocatedPorts);
    } catch {
      allocatedPorts = [25565, 25566, 25567, 25568, 25569];
    }

    const existingServers = await prisma.server.findMany({ where: { nodeId: node.id } });
    const assignedPorts = pickAvailablePorts(allocatedPorts, getUsedExternalPorts(existingServers), 1);

    const primaryPort = assignedPorts[0] || (25565 + existingServers.length);
    const portsJson = serializeServerPorts([
      {
        name: 'Primary Port',
        internalPort: primaryPort,
        externalPort: primaryPort,
        primary: true,
      },
    ]);

    // 4. Resolve Image/Egg template
    let imageId = options.imageId || 1;
    let image = await prisma.images.findFirst({ where: { id: imageId } });
    if (!image) {
      image = await prisma.images.create({
        data: {
          name: 'Paper Minecraft',
          description: 'High performance Paper Minecraft Server',
          startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui',
        },
      });
    }

    // 5. Create Server Record
    const server = await prisma.server.create({
      data: {
        name: options.name.trim(),
        description: options.description?.trim() || null,
        ownerId: user.id,
        nodeId: node.id,
        imageId: image.id,
        Ports: portsJson,
        Memory: memory,
        Cpu: cpu,
        Storage: storage,
        javaVersion: options.javaVersion || '17',
        softwareType: options.softwareType || 'paper',
        softwareVersion: options.softwareVersion || 'latest',
        StartCommand: image.startup,
        Installing: true,
        Queued: true,
      },
    });

    // 6. Trigger deployment via QueueManager
    logger.info(`ServerProvisioner: Queued Minecraft server ${server.UUID} for installation.`);
    QueueManager.triggerDeployment(server.UUID, [primaryPort]);

    return server;
  }
}
