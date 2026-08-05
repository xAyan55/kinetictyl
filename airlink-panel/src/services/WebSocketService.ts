import { WebSocket } from 'ws';
import logger from '../handlers/logger';

export class WebSocketService {
  private static connections = new Map<number, Set<WebSocket>>();

  static register(userId: number, ws: WebSocket) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(ws);

    ws.on('close', () => {
      const userConns = this.connections.get(userId);
      if (userConns) {
        userConns.delete(ws);
        if (userConns.size === 0) {
          this.connections.delete(userId);
        }
      }
    });
  }

  static sendToUser(userId: number, event: string, data: any) {
    const userConns = this.connections.get(userId);
    if (!userConns) return;
    const message = JSON.stringify({ event, data });
    userConns.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    });
  }

  static broadcast(event: string, data: any) {
    const message = JSON.stringify({ event, data });
    this.connections.forEach((userConns) => {
      userConns.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(message);
        }
      });
    });
  }
}
