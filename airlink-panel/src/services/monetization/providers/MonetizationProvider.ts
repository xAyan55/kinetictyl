import { Request } from 'express';
import { RewardType } from '@prisma/client';

export interface MonetizationProvider {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  reloadConfiguration(config: Record<string, any>): Promise<void>;
  
  validateConfiguration(config: Record<string, any>): Promise<void>;
  generateLink(user: any, offer: any, targetUrl: string, options?: any): Promise<string>;
  verifyCallback(req: Request): Promise<boolean>;
  healthCheck(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN'; responseTime: number; error?: string }>;
  renderConfigurationFields(): Array<{ key: string; label: string; type: string; default?: any }>;
  getStatistics(): Promise<Record<string, any>>;

  // Capability checks
  supportsReward(type: RewardType): boolean;
  supportsWebhook(): boolean;
  supportsClientScript(): boolean;
}
