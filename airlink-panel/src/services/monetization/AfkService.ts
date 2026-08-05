import prisma from '../../db';
import { SessionStatus, RewardType } from '@prisma/client';
import { ConfigService } from '../config/ConfigService';
import { EconomyService } from './EconomyService';
import { EventBus, EVENTS } from './EventBus';
import logger from '../../handlers/logger';

export class AfkService {
  private static userActiveTabs = new Map<number, { sessionToken: string; lastActive: number }>(); // userId -> websocket/session token lock

  static async startSession(userId: number, sessionToken: string, ipAddress?: string, userAgent?: string): Promise<{ success: boolean; sessionId?: number; error?: string }> {
    // 1. Multi-tab prevention: check if there's already an active tab lock and if it's still fresh
    const active = this.userActiveTabs.get(userId);
    if (active && active.sessionToken !== sessionToken && (Date.now() - active.lastActive) < 75000) {
      return { success: false, error: 'Multiple AFK tabs detected. Earning is active on another page.' };
    }

    // 2. Pause existing open active sessions in DB
    await prisma.afkSession.updateMany({
      where: { userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.PAUSED, endedAt: new Date() }
    });

    // 3. Create new session
    const session = await prisma.afkSession.create({
      data: {
        userId,
        startedAt: new Date(),
        status: SessionStatus.ACTIVE,
        ipAddress,
        userAgent
      }
    });

    // Set memory lock
    this.userActiveTabs.set(userId, { sessionToken, lastActive: Date.now() });

    await EventBus.publish(EVENTS.AFK_STARTED, { userId, sessionId: session.id });

    return { success: true, sessionId: session.id };
  }

  static async heartbeat(
    userId: number,
    sessionToken: string,
    params: {
      visible: boolean;
      focused: boolean;
      mouseX?: number;
      mouseY?: number;
      keysPressed?: number;
      ipAddress?: string;
    }
  ): Promise<{ success: boolean; coinsAwarded: number; status: string; error?: string }> {
    // Check lock
    const active = this.userActiveTabs.get(userId);
    if (!active || active.sessionToken !== sessionToken) {
      return { success: false, coinsAwarded: 0, status: 'LOCKED', error: 'Lock expired or active on another window.' };
    }

    // Update lastActive timestamp
    active.lastActive = Date.now();

    const session = await prisma.afkSession.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
      orderBy: { startedAt: 'desc' }
    });

    if (!session) {
      return { success: false, coinsAwarded: 0, status: 'NOT_FOUND', error: 'Active AFK session not found.' };
    }

    const now = new Date();
    const durationMs = now.getTime() - session.lastHeartbeat.getTime();
    
    // Heartbeat jitter/timing validation (minimum interval check)
    // E.g. expected heartbeat is 60s, tolerate a minimum of 45s to block timing hacks.
    if (durationMs < 45000) {
      return { success: true, coinsAwarded: 0, status: 'TOO_FAST' };
    }

    // Client visibility/focus check
    if (!params.visible || !params.focused) {
      // Auto pause session in DB due to inactivity
      await prisma.afkSession.update({
        where: { id: session.id },
        data: { status: SessionStatus.PAUSED, endedAt: now }
      });
      this.userActiveTabs.delete(userId);
      return { success: true, coinsAwarded: 0, status: 'PAUSED' };
    }

    // Dynamic configuration caps
    const config = await ConfigService.getAll();
    const monetization = config.monetization || {};
    const coinsPerMinute = Number(monetization.coinsPerAfkMinute || 1);
    const maxMinutesPerDay = Number(monetization.maxAfkMinutesPerDay || 240); // 4 hours limit

    // Validate daily caps
    const minutesToday = await this.getDailyAfkMinutes(userId);
    if (minutesToday >= maxMinutesPerDay) {
      // Cap reached. Auto stop session
      await this.stopSession(userId, sessionToken);
      return { success: false, coinsAwarded: 0, status: 'CAP_REACHED', error: 'Daily AFK earning cap reached.' };
    }

    // Standard heartbeat increments by 1 min
    const earnedCoins = coinsPerMinute;

    await prisma.$transaction(async (tx) => {
      await tx.afkSession.update({
        where: { id: session.id },
        data: {
          lastHeartbeat: now,
          totalMinutes: { increment: 1 },
          coinsEarned: { increment: earnedCoins }
        }
      });

      await EconomyService.awardRewards({
        userId,
        rewards: [{ rewardType: RewardType.COINS, amount: earnedCoins }],
        source: 'AFK Reward Minute',
        referenceId: `afk-heartbeat-${session.id}-${Date.now()}`,
        tx
      });
    });

    return { success: true, coinsAwarded: earnedCoins, status: 'ACTIVE' };
  }

  static async stopSession(userId: number, sessionToken: string): Promise<{ success: boolean }> {
    const active = this.userActiveTabs.get(userId);
    if (active && active.sessionToken === sessionToken) {
      this.userActiveTabs.delete(userId);
    }

    const session = await prisma.afkSession.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
      orderBy: { startedAt: 'desc' }
    });

    if (session) {
      await prisma.afkSession.update({
        where: { id: session.id },
        data: { status: SessionStatus.COMPLETED, endedAt: new Date() }
      });
      await EventBus.publish(EVENTS.AFK_ENDED, { userId, sessionId: session.id });
    }

    return { success: true };
  }

  static async getDailyAfkMinutes(userId: number): Promise<number> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sessions = await prisma.afkSession.findMany({
      where: {
        userId,
        createdAt: { gte: startOfToday }
      }
    });

    return sessions.reduce((sum, s) => sum + s.totalMinutes, 0);
  }

  static clearLocks(): void {
    this.userActiveTabs.clear();
  }
}
