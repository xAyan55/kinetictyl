import crypto from 'crypto';
import { LinkvertiseTokenPayload } from '../providers/linkvertiseTypes';
import logger from '../../../handlers/logger';

const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export class TokenService {
  private secret: string;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error('[TokenService] Callback secret must be at least 32 characters.');
    }
    this.secret = secret;
  }

  /**
   * Generate a signed token containing reward metadata.
   * Format: base64url(JSON payload).signature
   */
  generate(userId: number, rewardType: string, campaign: string, placement: string): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload: LinkvertiseTokenPayload = {
      userId,
      rewardType,
      campaign,
      placement,
      expiry: Date.now() + TOKEN_EXPIRY_MS,
      nonce,
    };

    const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(payloadStr);
    const token = `${payloadStr}.${signature}`;

    logger.info(`[LINK_CREATED] Token generated for user=${userId} campaign=${campaign} placement=${placement} nonce=${nonce}`);
    return token;
  }

  /**
   * Verify token integrity and expiry. Returns the decoded payload or null.
   */
  verify(token: string): LinkvertiseTokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) {
      logger.warn('[TOKEN_VERIFY] Malformed token: wrong number of segments');
      return null;
    }

    const [payloadStr, signature] = parts;
    const expectedSig = this.sign(payloadStr);

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      logger.warn('[TOKEN_VERIFY] Signature mismatch');
      return null;
    }

    try {
      const payload: LinkvertiseTokenPayload = JSON.parse(
        Buffer.from(payloadStr, 'base64url').toString('utf8')
      );

      if (Date.now() > payload.expiry) {
        logger.warn(`[TOKEN_VERIFY] Token expired for user=${payload.userId} nonce=${payload.nonce}`);
        return null;
      }

      return payload;
    } catch (err) {
      logger.error('[TOKEN_VERIFY] Failed to parse token payload:', err);
      return null;
    }
  }

  /**
   * Extract payload without verifying signature (for diagnostics only).
   */
  decode(token: string): LinkvertiseTokenPayload | null {
    try {
      const payloadStr = token.split('.')[0];
      return JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  private sign(data: string): string {
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }
}
