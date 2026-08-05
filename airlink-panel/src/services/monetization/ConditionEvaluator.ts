import prisma from '../../db';
import { WalletService } from '../WalletService';

export interface OfferConditions {
  minimumAccountAge?: number;    // in days
  requiredRole?: 'admin' | 'user'; // admin check
  minimumCoins?: number;
  minimumPlaytime?: number;      // in minutes (loginHistory or mock proxy)
  minimumServers?: number;
  allowedCountries?: string[];   // ISO codes
  blockedCountries?: string[];   // ISO codes
  emailVerified?: boolean;
}

export class ConditionEvaluator {
  static async evaluate(userId: number, conditions: any, reqMetadata?: { ip?: string; country?: string }): Promise<{ allowed: boolean; reason?: string }> {
    if (!conditions || typeof conditions !== 'object') {
      return { allowed: true };
    }

    const conds = conditions as OfferConditions;

    // Fetch user details
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { servers: true, loginHistory: true }
    });

    if (!user) {
      return { allowed: false, reason: 'User not found.' };
    }

    // 1. Account Age
    if (conds.minimumAccountAge && conds.minimumAccountAge > 0) {
      const ageDays = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < conds.minimumAccountAge) {
        return { allowed: false, reason: `Account must be at least ${conds.minimumAccountAge} days old.` };
      }
    }

    // 2. Required Role
    if (conds.requiredRole) {
      if (conds.requiredRole === 'admin' && !user.isAdmin) {
        return { allowed: false, reason: 'Only administrators can perform this offer.' };
      }
    }

    // 3. Minimum Coins
    if (conds.minimumCoins && conds.minimumCoins > 0) {
      const balance = await WalletService.getBalance(userId);
      if (balance < conds.minimumCoins) {
        return { allowed: false, reason: `You need a minimum balance of ${conds.minimumCoins} coins.` };
      }
    }

    // 4. Minimum Playtime / Active Time
    if (conds.minimumPlaytime && conds.minimumPlaytime > 0) {
      // Proxy playtime based on active login days or history session duration estimate
      const loginsCount = user.loginHistory.length;
      const estimatedPlaytime = loginsCount * 15; // Assume 15 mins per session
      if (estimatedPlaytime < conds.minimumPlaytime) {
        return { allowed: false, reason: `Minimum dashboard active time of ${conds.minimumPlaytime} minutes is required.` };
      }
    }

    // 5. Minimum Servers
    if (conds.minimumServers && conds.minimumServers > 0) {
      const activeServers = user.servers.filter((s) => !s.Suspended).length;
      if (activeServers < conds.minimumServers) {
        return { allowed: false, reason: `You must own at least ${conds.minimumServers} active servers.` };
      }
    }

    // 6. Geolocation / Country Check
    if (reqMetadata?.country) {
      const country = reqMetadata.country.toUpperCase();
      
      if (conds.allowedCountries && conds.allowedCountries.length > 0) {
        const allowed = conds.allowedCountries.map((c) => c.toUpperCase());
        if (!allowed.includes(country)) {
          return { allowed: false, reason: `This offer is not available in your region (${country}).` };
        }
      }

      if (conds.blockedCountries && conds.blockedCountries.length > 0) {
        const blocked = conds.blockedCountries.map((c) => c.toUpperCase());
        if (blocked.includes(country)) {
          return { allowed: false, reason: `This offer is blocked in your region (${country}).` };
        }
      }
    }

    return { allowed: true };
  }
}
