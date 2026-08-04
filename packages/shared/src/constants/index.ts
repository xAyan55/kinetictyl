export enum ServerStatus {
  INSTALLING = "installing",
  OFFLINE = "offline",
  STARTING = "starting",
  RUNNING = "running",
  STOPPING = "stopping",
  CRASHED = "crashed",
  SUSPENDED = "suspended",
}

export enum UserRole {
  ADMIN = "admin",
  USER = "user",
}

export enum StepType {
  DOWNLOAD = "download",
  UNZIP = "unzip",
  REMOVE = "remove",
}

export const DEFAULT_PORTS = {
  PANEL_HTTP: 8080,
  AGENT_HTTP: 8081,
  SFTP: 2022,
  MINECRAFT_START: 25565,
  MINECRAFT_END: 25600,
};

export const PERMISSIONS = {
  SERVER_START: "server.start",
  SERVER_STOP: "server.stop",
  SERVER_CONSOLE: "server.console",
  SERVER_FILES: "server.files",
  SERVER_BACKUP: "server.backup",
  SERVER_SETTINGS: "server.settings",
};
