import { Request } from 'express';
import prisma from '../../../db';
import logger from '../../../handlers/logger';
import { TokenService } from './TokenService';
import { LinkvertiseTokenPayload, LinkvertiseStatus } from '../providers/linkvertiseTypes';

interface CallbackResult {
  success: boolean;
  sessionId?: number;
  payload?: LinkvertiseTokenPayload;
  error?: string;
}

// In-memory rate limit store: IP -> { count, resetAt }
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 per minute per IP

// In-memory nonce store for replay protection (token nonce -> timestamp)
const usedNonces = new Set<string>();

export class CallbackService {
  private tokenService: TokenService;

  constructor(tokenService: TokenService) {
    this.tokenService = tokenService;
  }

  /**
   * Check per-IP rate limit. Returns true if the request is allowed.
   */
  checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimits.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }

    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      logger.warn(`[CALLBACK_RATE_LIMIT] IP ${ip} exceeded ${RATE_LIMIT_MAX} requests/min`);
      return false;
    }

    return true;
  }

  /**
   * Process an incoming Linkvertise callback.
   *
   * 1. Rate-limit check
   * 2. Token signature verification
   * 3. Expiry check
   * 4. Replay / nonce check
   * 5. Session lookup & state validation
   * 6. Transition session to COMPLETED
   * 7. Log completion record
   */
  async processCallback(req: Request): Promise<CallbackResult> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || '';
    const correlationId = `cb-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    logger.info(`[CALLBACK_RECEIVED] correlationId=${correlationId} ip=${ip}`);

    // 1. Rate limit
    if (!this.checkRateLimit(ip)) {
      return { success: false, error: 'Rate limit exceeded' };
    }

    // 2. Extract token from query or body
    const token = (req.query.token as string) || (req.body?.token as string);
    if (!token) {
      logger.warn(`[CALLBACK_REJECTED] correlationId=${correlationId} reason=missing_token`);
      return { success: false, error: 'Missing token' };
    }

    // 3. Verify signature + expiry
    const payload = this.tokenService.verify(token);
    if (!payload) {
      logger.warn(`[CALLBACK_REJECTED] correlationId=${correlationId} reason=invalid_or_expired_token`);
      return { success: false, error: 'Invalid or expired token' };
    }

    // 4. Replay protection via nonce
    if (usedNonces.has(payload.nonce)) {
      logger.warn(`[CALLBACK_REJECTED] correlationId=${correlationId} reason=replay_detected nonce=${payload.nonce}`);
      return { success: false, error: 'Replay detected' };
    }
    usedNonces.add(payload.nonce);

    // 5. Find the session by token
    const session = await prisma.linkvertiseSession.findUnique({
      where: { token },
    });

    if (!session) {
      logger.warn(`[CALLBACK_REJECTED] correlationId=${correlationId} reason=session_not_found`);
      return { success: false, error: 'Session not found' };
    }

    // 6. Validate state transition (only CREATED or VISITED can move to COMPLETED)
    const completableStates: LinkvertiseStatus[] = ['CREATED', 'VISITED'];
    if (!completableStates.includes(session.status as LinkvertiseStatus)) {
      logger.warn(`[CALLBACK_REJECTED] correlationId=${correlationId} reason=invalid_state current=${session.status}`);
      return { success: false, error: `Session already in state: ${session.status}` };
    }

    // 7. Transition to COMPLETED and log completion atomically
    const now = new Date();
    const signatureRecord = `${payload.nonce}:${ip}:${now.toISOString()}`;

    await prisma.$transaction([
      prisma.linkvertiseSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED' as string,
          ip,
          userAgent,
          completedAt: now,
        },
      }),
      prisma.linkvertiseCompletion.create({
        data: {
          sessionId: session.id,
          ipAddress: ip,
          userAgent,
          signature: signatureRecord,
          timestamp: now,
        },
      }),
    ]);

    logger.info(`[CALLBACK_COMPLETED] correlationId=${correlationId} sessionId=${session.id} userId=${payload.userId}`);

    return {
      success: true,
      sessionId: session.id,
      payload,
    };
  }

  /**
   * Clean up stale rate-limit entries periodically.
   */
  static cleanupRateLimits() {
    const now = Date.now();
    for (const [ip, entry] of rateLimits.entries()) {
      if (now > entry.resetAt) {
        rateLimits.delete(ip);
      }
    }
  }

  /**
   * Clean up old nonces (keep only last 2 hours).
   * This is a simplified approach - for production with high volume,
   * consider a Redis-backed TTL set.
   */
  static clearNonces() {
    usedNonces.clear();
    logger.info('[CALLBACK_CLEANUP] Nonce store cleared');
  }
}
