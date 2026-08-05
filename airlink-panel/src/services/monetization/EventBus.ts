import logger from '../../handlers/logger';

export interface EventPayload<T = any> {
  name: string;
  version: string;
  correlationId: string;
  timestamp: Date;
  metadata: Record<string, any>;
  data: T;
}

export interface EventListener<T = any> {
  priority: number; // Higher runs first
  handle(event: EventPayload<T>): Promise<void>;
}

export const EVENTS = {
  COINS_AWARDED: 'coins.awarded',
  OFFER_COMPLETED: 'offer.completed',
  AFK_STARTED: 'afk.started',
  AFK_ENDED: 'afk.ended',
  STREAK_CLAIMED: 'streak.claimed',
  CONFIG_UPDATED: 'config.updated',
  FRAUD_DETECTION_TRIGGERED: 'fraud.triggered'
};

export class EventBus {
  private static listeners = new Map<string, EventListener[]>();
  private static dlq: Array<{ event: EventPayload; error: any; timestamp: Date }> = [];

  static subscribe<T = any>(eventName: string, listener: EventListener<T>): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    const list = this.listeners.get(eventName)!;
    list.push(listener);
    // Sort descending by priority
    list.sort((a, b) => b.priority - a.priority);
  }

  static async publish<T = any>(
    name: string,
    data: T,
    metadata: Record<string, any> = {},
    version = '1.0.0',
    correlationId = `corr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  ): Promise<void> {
    const event: EventPayload<T> = {
      name,
      version,
      correlationId,
      timestamp: new Date(),
      metadata,
      data
    };

    const eventListeners = this.listeners.get(name) || [];
    
    // Execute listeners sequentially based on priority
    for (const listener of eventListeners) {
      let attempt = 0;
      const maxRetries = 3;
      const backoffMs = 1000;
      let success = false;

      while (attempt < maxRetries && !success) {
        try {
          await listener.handle(event);
          success = true;
        } catch (err: any) {
          attempt++;
          logger.error(
            `[EventBus] Error in listener for event ${name} (correlationId: ${correlationId}), attempt ${attempt}/${maxRetries}:`,
            err
          );
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
          } else {
            // Push to Dead Letter Queue (DLQ)
            this.dlq.push({ event, error: err, timestamp: new Date() });
            logger.error(`[EventBus] Event ${name} moved to DLQ (correlationId: ${correlationId})`);
          }
        }
      }
    }
  }

  static getDLQ(): Array<{ event: EventPayload; error: any; timestamp: Date }> {
    return this.dlq;
  }

  static clearDLQ(): void {
    this.dlq = [];
  }
}
