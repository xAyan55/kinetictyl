import { AgentDaemon } from './daemon.js';

const agentPort = Number(process.env.AGENT_PORT) || 8081;
const sftpPort = Number(process.env.SFTP_PORT) || 2022;
const serverRootDir = process.env.SERVER_ROOT_DIR || './data/servers';
const runtimeDir = process.env.RUNTIME_DIR || './data/runtimes';

const daemon = new AgentDaemon(agentPort, sftpPort, serverRootDir, runtimeDir);
daemon.start();
