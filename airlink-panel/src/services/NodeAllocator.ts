import prisma from '../db';
import logger from '../handlers/logger';

export class NodeAllocator {
  /**
   * Finds the best node for deployment based on resource availability.
   * Compares the total resources defined on the nodes against the sum of resources
   * allocated to servers currently deployed on those nodes.
   */
  static async findBestNode(requiredMemory: number, requiredStorage: number): Promise<any | null> {
    try {
      const nodes = await prisma.node.findMany({
        include: {
          servers: true,
        },
      });

      if (nodes.length === 0) {
        logger.warn('NodeAllocator: No nodes available in the database.');
        return null;
      }

      let bestNode: any = null;
      let maxAvailableMemory = -1;

      for (const node of nodes) {
        // Calculate allocated resources on this node
        const allocatedMemory = node.servers.reduce((sum, s) => sum + s.Memory, 0);
        const allocatedStorage = node.servers.reduce((sum, s) => sum + s.Storage, 0);

        const availableMemory = node.ram - allocatedMemory;
        const availableStorage = node.disk - allocatedStorage;

        // Check if node has enough resources
        if (availableMemory >= requiredMemory && availableStorage >= requiredStorage) {
          if (availableMemory > maxAvailableMemory) {
            maxAvailableMemory = availableMemory;
            bestNode = node;
          }
        }
      }

      if (!bestNode) {
        // Fallback to the node with the absolute lowest server count if none met the hard resource math
        logger.warn('NodeAllocator: No node has sufficient unallocated resources. Falling back to least loaded node.');
        let minServerCount = Infinity;
        for (const node of nodes) {
          if (node.servers.length < minServerCount) {
            minServerCount = node.servers.length;
            bestNode = node;
          }
        }
      }

      return bestNode;
    } catch (error) {
      logger.error('NodeAllocator: Failed to allocate best node', error);
      return null;
    }
  }
}
