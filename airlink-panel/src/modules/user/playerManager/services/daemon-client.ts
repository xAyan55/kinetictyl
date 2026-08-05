import axios from 'axios';
import { daemonSchemeSync } from '../../../../handlers/utils/core/daemonRequest';
import { PLAYER_MANAGER_CONFIG } from '../config';

export interface ServerNode {
  address: string;
  port: number;
  key: string;
}

export async function sendConsoleCommand(
  node: ServerNode,
  serverId: string,
  command: string,
): Promise<void> {
  await axios.post(
    `${daemonSchemeSync()}://${node.address}:${node.port}/container/command`,
    { id: serverId, command },
    {
      auth: { username: 'CynexGP', password: node.key },
      timeout: PLAYER_MANAGER_CONFIG.ACTION_TIMEOUT,
    },
  );
}

export interface OnlinePlayer {
  name: string;
  uuid: string;
}

export async function fetchOnlinePlayers(
  node: ServerNode,
  serverId: string,
  primaryPort: number,
): Promise<OnlinePlayer[]> {
  const response = await axios({
    method: 'GET',
    url: `${daemonSchemeSync()}://${node.address}:${node.port}/minecraft/players`,
    params: { id: serverId, host: node.address, port: primaryPort },
    auth: { username: 'CynexGP', password: node.key },
    timeout: PLAYER_MANAGER_CONFIG.DAEMON_PLAYERS_TIMEOUT,
  });

  if (Array.isArray(response.data?.players)) {
    return response.data.players as OnlinePlayer[];
  }

  return [];
}
