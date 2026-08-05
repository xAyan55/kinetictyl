const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateServerId(serverId: unknown): ValidationResult {
  if (typeof serverId !== 'string' || !serverId.trim()) {
    return { valid: false, error: 'Server ID is required' };
  }
  if (!UUID_PATTERN.test(serverId.trim())) {
    return { valid: false, error: 'Invalid server ID format' };
  }
  return { valid: true };
}

export function validateProjectId(projectId: unknown): ValidationResult {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return { valid: false, error: 'Project ID is required' };
  }
  if (!PROJECT_ID_PATTERN.test(projectId.trim())) {
    return { valid: false, error: 'Invalid project ID format' };
  }
  return { valid: true };
}

export function validateVersionId(versionId: unknown): ValidationResult {
  if (typeof versionId !== 'string' || !versionId.trim()) {
    return { valid: false, error: 'Version ID is required' };
  }
  if (!PROJECT_ID_PATTERN.test(versionId.trim())) {
    return { valid: false, error: 'Invalid version ID format' };
  }
  return { valid: true };
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[<>:"|?*\\]/g, '_').replace(/\.\./g, '').trim();
}

export function isJarFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.jar') || filename.toLowerCase().endsWith('.jar.disabled');
}
