import prisma from '../db';
import logger from '../handlers/logger';
import { TwoTierCacheStore } from '../modules/user/pluginManager/services/cache-store';
import { ModrinthClient } from '../modules/user/pluginManager/services/modrinth-client';

export class PluginMetadataService {
  private static clientInstance: ModrinthClient | null = null;

  static getClient(): ModrinthClient {
    if (!this.clientInstance) {
      const cache = new TwoTierCacheStore(prisma);
      this.clientInstance = new ModrinthClient(cache, logger);
    }
    return this.clientInstance;
  }

  static async getPluginDetails(projectId: string) {
    try {
      const client = this.getClient();
      const project = await client.getProject(projectId);
      const versions = await client.getProjectVersions(projectId);
      return {
        project,
        versions,
        success: true,
      };
    } catch (error) {
      logger.error(`PluginMetadataService: Failed to fetch details for ${projectId}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static async searchPlugins(query: string, page = 1, category?: string) {
    try {
      const client = this.getClient();
      const categories = category ? [category] : undefined;
      const results = await client.searchPlugins(query, page, 'relevance', categories);
      return {
        results,
        success: true,
      };
    } catch (error) {
      logger.error('PluginMetadataService: Search error', error);
      return {
        success: false,
        results: { hits: [], total_hits: 0, offset: 0, limit: 20 },
      };
    }
  }
}
