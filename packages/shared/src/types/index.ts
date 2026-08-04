import { ServerStatus, UserRole } from '../constants/index.js';

export interface UserPayload {
  id: number;
  username: string;
  email: string;
  role: UserRole;
}

export interface ServerDetails {
  id: string;
  name: string;
  ownerId: number;
  nodeId: number;
  type: string;
  version: string;
  buildUuid: string;
  port: number;
  ramLimit: bigint | number;
  diskLimit: bigint | number;
  cpuLimit: number;
  javaOverride?: string | null;
  status: ServerStatus | string;
  suspended: boolean;
  createdAt: Date | string;
  address?: string;
}

export interface NodeStats {
  cpuCores: number;
  ramTotal: bigint | number;
  diskTotal: bigint | number;
  ramAllocated: bigint | number;
  diskAllocated: bigint | number;
  serverCount: number;
}

export interface MetricPoint {
  cpuPct: number;
  ramUsedBytes: number;
  ramLimitBytes: number;
  diskUsedBytes: number;
  diskLimitBytes: number;
  playerCount?: number;
  maxPlayers?: number;
}

export interface WebSocketEvent<T = unknown> {
  event: string;
  args: T[];
}
