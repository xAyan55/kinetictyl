export const PLAYER_MANAGER_CONFIG = {
  ACTION_TIMEOUT: 10_000,
  ONLINE_LIST_CACHE_MS: 5_000,
  MINECRAFT_USERNAME_RE: /^[a-zA-Z0-9_]{3,16}$/,
  MAX_REASON_LENGTH: 256,
  VALID_ACTIONS: ['op', 'ban', 'ipban', 'kill'] as const,
  DAEMON_PLAYERS_TIMEOUT: 8_000,
} as const;

export type PlayerAction = typeof PLAYER_MANAGER_CONFIG.VALID_ACTIONS[number];
