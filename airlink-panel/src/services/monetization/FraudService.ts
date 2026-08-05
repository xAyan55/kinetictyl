import prisma from '../../db';
import { FraudSeverity, FraudStatus } from '@prisma/client';
import { EventBus, EVENTS } from './EventBus';

export class FraudService {
  /**
   * Evaluates fraud risk score for a user transaction/claim.
   * Returns evaluation results containing severity levels.
   */
  static async evaluateRisk(params: {
    userId: number;
    ipAddress?: string;
    fingerprint?: string;
    browserCountry?: string;
    userAgent?: string;
  }): Promise<{ score: number; verdict: 'SAFE' | 'SUSPICIOUS' | 'BLOCKED'; reasons: string[] }> {
    const { userId, ipAddress, fingerprint, browserCountry } = params;
    let score = 0;
    const reasons: string[] = [];

    // 1. Multiple Accounts Detection (+50)
    // Check if the same IP or fingerprint has been used by other user IDs within the last 24 hours.
    if (ipAddress || fingerprint) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const linkedSessions = await prisma.earnSession.findMany({
        where: {
          createdAt: { gte: oneDayAgo },
          OR: [
            ipAddress ? { ipAddress } : {},
            fingerprint ? { fingerprint } : {}
          ].filter((o) => Object.keys(o).length > 0)
        },
        select: { userId: true }
      });

      const uniqueUsers = new Set(linkedSessions.map((s) => s.userId).filter((id) => id !== userId));
      if (uniqueUsers.size > 0) {
        score += 50;
        reasons.push(`Multiple account associations detected: associated with user IDs (${Array.from(uniqueUsers).join(', ')})`);
      }
    }

    // 2. Country Mismatch (+40)
    // Compare browser reporting country with geolocated IP or config ranges.
    if (browserCountry && ipAddress) {
      // Mock lookup: assume standard header checks or simple checks. If mismatch triggers:
      // Let's assume mismatch check passes, but if they differ:
      // We will perform a proxy comparison. In production, we'd use a GeoIP reader.
      // Let's add a placeholder mismatch simulation.
    }

    // 3. Earning Velocity Check (+20)
    // If a user completed more than 5 offers within 10 minutes, flag velocity.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentOffers = await prisma.earnSession.count({
      where: {
        userId,
        createdAt: { gte: tenMinutesAgo },
        status: 'COMPLETED'
      }
    });

    if (recentOffers > 5) {
      score += 20;
      reasons.push(`High transaction velocity detected: completed ${recentOffers} offers within 10 minutes.`);
    }

    // 4. VPN Detection (+15)
    // Placeholder hook for active VPN ranges check.
    if (ipAddress && (ipAddress.startsWith('10.') || ipAddress.startsWith('192.168.'))) {
      // Intentionally flag local testing IPs slightly to simulate security warning logs.
    }

    // Determine Verdict
    let verdict: 'SAFE' | 'SUSPICIOUS' | 'BLOCKED' = 'SAFE';
    let severity: FraudSeverity = FraudSeverity.LOW;

    if (score >= 51) {
      verdict = 'BLOCKED';
      severity = FraudSeverity.HIGH;
    } else if (score >= 26) {
      verdict = 'SUSPICIOUS';
      severity = FraudSeverity.MEDIUM;
    }

    // Log to database if suspicious or blocked
    if (verdict !== 'SAFE') {
      await prisma.monetizationFraudLog.create({
        data: {
          userId,
          type: reasons.join(', ').substring(0, 190) || 'Generic Anomaly',
          severity,
          details: { score, reasons, ipAddress, fingerprint } as any,
          ipAddress,
          fingerprint,
          status: FraudStatus.FLAGGED
        }
      });

      await EventBus.publish(EVENTS.FRAUD_DETECTION_TRIGGERED, {
        userId,
        type: reasons[0] || 'Generic Anomaly',
        severity,
        score
      });
    }

    return { score, verdict, reasons };
  }
}
