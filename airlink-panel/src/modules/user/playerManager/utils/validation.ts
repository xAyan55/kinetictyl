import { PLAYER_MANAGER_CONFIG } from '../config';

export type Action = 'op' | 'ban' | 'ipban' | 'kill';

const VALID_ACTIONS = new Set<string>(PLAYER_MANAGER_CONFIG.VALID_ACTIONS);

export function validateAction(value: unknown): value is Action {
  return typeof value === 'string' && VALID_ACTIONS.has(value);
}

export function sanitizePlayerName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Player name is required');
  }

  const cleaned = value.replace(/[\n\r]/g, '').trim();

  if (!PLAYER_MANAGER_CONFIG.MINECRAFT_USERNAME_RE.test(cleaned)) {
    throw new Error('Invalid player name format');
  }

  return cleaned;
}

export function sanitizeReason(value: unknown): string | undefined {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const cleaned = value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  if (!cleaned) return undefined;

  return cleaned.slice(0, PLAYER_MANAGER_CONFIG.MAX_REASON_LENGTH);
}
