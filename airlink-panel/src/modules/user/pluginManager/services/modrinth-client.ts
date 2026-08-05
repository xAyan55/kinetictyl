import axios, { AxiosInstance } from 'axios';
import { CacheStore } from './cache-store';
import {
  ModrinthProject,
  ModrinthProjectSchema,
  ModrinthSearchResponse,
  ModrinthSearchResponseSchema,
  ModrinthVersion,
  ModrinthVersionSchema,
} from '../types/modrinth-api';
import { PLUGIN_MANAGER_CONFIG, PluginManagerSortIndex } from '../config';

export interface ModrinthClientConfig {
  apiBase: string;
  userAgent: string;
  searchLimit: number;
  cacheDuration: number;
  retryAttempts: number;
  retryDelay: number;
  requestTimeout: number;
}

export class ModrinthClient {
  private http: AxiosInstance;
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly cache: CacheStore,
    private readonly logger: { warn: (message: string, ...args: unknown[]) => void },
    private readonly config: ModrinthClientConfig = {
      apiBase: PLUGIN_MANAGER_CONFIG.MODRINTH_API_BASE,
      userAgent: PLUGIN_MANAGER_CONFIG.USER_AGENT,
      searchLimit: PLUGIN_MANAGER_CONFIG.SEARCH_LIMIT,
      cacheDuration: PLUGIN_MANAGER_CONFIG.CACHE_DURATION,
      retryAttempts: PLUGIN_MANAGER_CONFIG.RETRY_ATTEMPTS,
      retryDelay: PLUGIN_MANAGER_CONFIG.RETRY_DELAY,
      requestTimeout: PLUGIN_MANAGER_CONFIG.REQUEST_TIMEOUT,
    },
  ) {
    this.http = axios.create({
      baseURL: this.config.apiBase,
      headers: {
        'User-Agent': this.config.userAgent,
        Accept: 'application/json',
      },
      timeout: this.config.requestTimeout,
      validateStatus: (status) => status < 500,
    });
  }

  private buildCacheKey(endpoint: string, params?: Record<string, unknown>): string {
    return `plugin-manager:${endpoint}:${JSON.stringify(params || {})}`;
  }

  private async requestWithRetry<T>(
    endpoint: string,
    params?: Record<string, unknown>,
    validator?: (data: unknown) => T,
  ): Promise<T> {
    const cacheKey = this.buildCacheKey(endpoint, params);
    const cached = await this.cache.get(cacheKey);
    if (cached !== null) {
      console.log(`[MODRINTH] CACHE HIT: ${endpoint}`);
      return cached as T;
    }
    console.log(`[MODRINTH] CACHE MISS: ${endpoint}`);

    if (this.inFlight.has(cacheKey)) {
      console.log(`[MODRINTH] DEDUP (in-flight): ${endpoint}`);
      return this.inFlight.get(cacheKey)! as Promise<T>;
    }

    const promise = this.doRequest<T>(cacheKey, endpoint, params, validator);
    this.inFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async doRequest<T>(
    cacheKey: string,
    endpoint: string,
    params?: Record<string, unknown>,
    validator?: (data: unknown) => T,
  ): Promise<T> {
    let lastError: Error | null = null;
    console.log(`[MODRINTH] REQUEST: GET ${endpoint} params=${JSON.stringify(params || {})}`);

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt += 1) {
      try {
        const response = await this.http.get(endpoint, { params });
        console.log(`[MODRINTH] RESPONSE: ${endpoint} status=${response.status}`);

        if (response.status === 429) {
          const retryAfter = Number.parseInt(String(response.headers['retry-after'] || '5'), 10);
          console.log(`[MODRINTH] RATE LIMITED (429), retrying in ${retryAfter}s`);
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        if (response.status >= 400) {
          console.log(`[MODRINTH] ERROR: ${endpoint} returned ${response.status}`);
          throw new Error(`Modrinth API returned ${response.status}: ${response.statusText}`);
        }

        const data = validator ? validator(response.data) : (response.data as T);
        await this.cache.set(cacheKey, data, this.config.cacheDuration);
        console.log(`[MODRINTH] REQUEST OK: ${endpoint} (cached)`);
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (axios.isAxiosError(error) && error.response?.status && error.response.status >= 400 && error.response.status < 500) {
          console.log(`[MODRINTH] CLIENT ERROR: ${endpoint} status=${error.response.status} ${error.response.statusText}`);
          throw lastError;
        }
        if (attempt < this.config.retryAttempts - 1) {
          const delay = this.config.retryDelay * 2 ** attempt;
          console.log(`[MODRINTH] RETRY ${attempt + 1}/${this.config.retryAttempts} after ${delay}ms: ${endpoint}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.log(`[MODRINTH] ALL RETRIES EXHAUSTED: ${endpoint}`);
    throw lastError ?? new Error('Modrinth request failed');
  }

  async searchPlugins(
    query: string,
    page = 1,
    sort: PluginManagerSortIndex = 'relevance',
    categories?: string[],
  ): Promise<ModrinthSearchResponse> {
    const params: Record<string, unknown> = {
      query: query.trim(),
      offset: Math.max(0, (page - 1) * this.config.searchLimit),
      limit: Math.min(this.config.searchLimit, 100),
      index: sort,
      facets: JSON.stringify([['project_type:plugin']]),
    };

    if (categories?.length) {
      params.facets = JSON.stringify([
        ['project_type:plugin'],
        categories.map((category) => `categories:${category}`),
      ]);
    }

    return this.requestWithRetry('/search', params, (data) => {
      const result = ModrinthSearchResponseSchema.parse(data);
      return {
        hits: result.hits || [],
        total_hits: result.total_hits || 0,
        offset: result.offset || 0,
        limit: result.limit || this.config.searchLimit,
      };
    });
  }

  async getProject(projectId: string): Promise<ModrinthProject> {
    console.log(`[MODRINTH] getProject: ${projectId}`);
    return this.requestWithRetry(
      `/project/${encodeURIComponent(projectId.trim())}`,
      undefined,
      (data) => {
        const project = ModrinthProjectSchema.parse(data);
        console.log(`[MODRINTH] getProject: "${project.title}" type=${project.project_type}`);
        return project;
      },
    );
  }

  async getProjectVersions(projectId: string): Promise<ModrinthVersion[]> {
    console.log(`[MODRINTH] getProjectVersions: ${projectId}`);
    const versions = await this.requestWithRetry<ModrinthVersion[]>(
      `/project/${encodeURIComponent(projectId.trim())}/version`,
      undefined,
      (data) => {
        if (!Array.isArray(data)) {
          console.log(`[MODRINTH] getProjectVersions: not an array, got ${typeof data}`);
          return [];
        }
        console.log(`[MODRINTH] getProjectVersions: ${data.length} versions returned`);
        return data.map((entry) => ModrinthVersionSchema.parse(entry));
      },
    );
    return versions;
  }

  async getVersion(versionId: string): Promise<ModrinthVersion> {
    console.log(`[MODRINTH] getVersion: ${versionId}`);
    return this.requestWithRetry(
      `/version/${encodeURIComponent(versionId.trim())}`,
      undefined,
      (data) => {
        const version = ModrinthVersionSchema.parse(data);
        console.log(`[MODRINTH] getVersion: ${version.version_number} loaders=[${version.loaders.join(',')}] game_versions=[${version.game_versions.join(',')}]`);
        return version;
      },
    );
  }
}
