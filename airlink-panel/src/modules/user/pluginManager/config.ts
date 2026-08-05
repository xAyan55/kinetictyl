export const PLUGIN_MANAGER_CONFIG = {
  MODRINTH_API_BASE: 'https://api.modrinth.com/v2',
  USER_AGENT: 'CynexGP-PluginManager/1.0',
  CACHE_DURATION: 30 * 60 * 1000,
  MAX_FILE_SIZE: 100 * 1024 * 1024,
  SEARCH_LIMIT: 20,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 2000,
  REQUEST_TIMEOUT: 30000,
  PLUGINS_DIRECTORY: 'plugins',
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_MAX: 10,
} as const;

export const PLUGIN_MANAGER_SORT_INDEX = {
  relevance: 'relevance',
  downloads: 'downloads',
  updated: 'updated',
  newest: 'newest',
} as const;

export type PluginManagerSortIndex = keyof typeof PLUGIN_MANAGER_SORT_INDEX;
