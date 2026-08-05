import { Router, Request, Response } from 'express';
import prisma from '../../../../../db';
import logger from '../../../../../handlers/logger';
import { validateAction, sanitizePlayerName, sanitizeReason } from '../../utils/validation';
import { sendConsoleCommand, fetchOnlinePlayers } from '../../services/daemon-client';

function extractPrimaryPort(server: { Ports: string }): number | null {
  try {
    const ports: Array<{ primary?: boolean; Port?: string }> = JSON.parse(server.Ports || '[]');
    const primary = ports.find((p) => p.primary);
    if (!primary?.Port) return null;
    const portNum = parseInt(primary.Port.split(':')[1], 10);
    return Number.isNaN(portNum) ? null : portNum;
  } catch {
    return null;
  }
}

export function createActionRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.post('/action', async (req: Request, res: Response) => {
    try {
      const serverId = String(req.params.id);

      const server = await prisma.server.findUnique({
        where: { UUID: serverId },
        include: { node: true },
      });

      if (!server) {
        res.status(404).json({ success: false, error: 'Server not found' });
        return;
      }

      const { uuid, action: rawAction, reason: rawReason } = req.body as Record<string, unknown>;

      if (typeof uuid !== 'string' || !uuid.trim()) {
        res.status(400).json({ success: false, error: 'Player UUID is required' });
        return;
      }

      if (!validateAction(rawAction)) {
        res.status(400).json({ success: false, error: 'Invalid action' });
        return;
      }

      const action: string = rawAction;
      const reason = sanitizeReason(rawReason);
      let playerName: string;
      let playerNameSource: 'online-list' | 'client';

      const primaryPort = extractPrimaryPort(server);
      if (!primaryPort) {
        res.status(400).json({ success: false, error: 'No primary port configured' });
        return;
      }

      let onlinePlayers: Array<{ name: string; uuid: string }> = [];
      try {
        onlinePlayers = await fetchOnlinePlayers(server.node, serverId, primaryPort);
      } catch {
        if (action === 'ipban') {
          res.status(400).json({ success: false, error: 'Cannot verify player online status — daemon unreachable' });
          return;
        }
      }

      const onlinePlayer = onlinePlayers.find((p) => p.uuid === uuid);

      if (action === 'ipban' && !onlinePlayer) {
        res.status(400).json({ success: false, error: 'Player must be online to IP ban' });
        return;
      }

      if (onlinePlayer) {
        playerName = onlinePlayer.name;
        playerNameSource = 'online-list';
      } else {
        try {
          playerName = sanitizePlayerName(req.body.playerName);
        } catch {
          res.status(400).json({ success: false, error: 'Invalid player name' });
          return;
        }
        playerNameSource = 'client';
      }

      const command = reason
        ? `${action} ${playerName} ${reason}`
        : `${action} ${playerName}`;

      try {
        await sendConsoleCommand(server.node, serverId, command);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Daemon command failed';
        logger.error(`Player action failed [${action}] server=${serverId} player=${playerName}: ${msg}`);
        res.status(502).json({ success: false, error: 'Failed to send command to server' });
        return;
      }

      logger.info(
        `Player action: user=${req.session?.user?.id} server=${serverId} uuid=${uuid} name=${playerName} action=${action} reason=${reason || 'none'} nameSource=${playerNameSource}`,
      );

      res.json({ success: true, data: { action, playerName } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      logger.error('Player action route error:', error);
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
