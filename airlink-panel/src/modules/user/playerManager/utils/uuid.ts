export function isOfflineModeUuid(uuid: string): boolean {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) return false;
  const version = parseInt(hex.charAt(12), 16);
  return version !== 4;
}
