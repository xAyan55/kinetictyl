import type { WebSocket } from 'ws';

export type WsData = {
  route: 'container' | 'containerstatus' | 'containerevents';
  containerId: string;
  authed: boolean;
};

export const openConnections = new Set<WebSocket>();
