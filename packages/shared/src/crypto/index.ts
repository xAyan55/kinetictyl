import { createCipheriv, createDecipheriv, randomBytes, createHash, pbkdf2Sync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Encrypts clear text using AES-256-GCM with key derived from app secret.
 */
export function encryptSecret(plainText: string, secretKey: string): string {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(secretKey, salt, 100000, 32, 'sha256');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: salt (16) + iv (12) + authTag (16) + encrypted ciphertext
  const result = Buffer.concat([salt, iv, authTag, encrypted]);
  return result.toString('base64');
}

/**
 * Decrypts AES-256-GCM encrypted base64 payload.
 */
export function decryptSecret(cipherTextBase64: string, secretKey: string): string {
  const buffer = Buffer.from(cipherTextBase64, 'base64');
  
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 28);
  const authTag = buffer.subarray(28, 44);
  const encrypted = buffer.subarray(44);

  const key = pbkdf2Sync(secretKey, salt, 100000, 32, 'sha256');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Computes a SHA-256 hex hash for a given string or Buffer.
 */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
