<div align="center">
  <h1>⚡ Kinetictyl</h1>
  <p><b>Lightweight, Docker-Free Self-Hosted Minecraft Server Management Panel</b></p>
  <p><i>The simplicity and role-separation of Pterodactyl, built for native OS OpenJDK process supervision.</i></p>
</div>

---

## 🚀 Overview

**Kinetictyl** is an open-source, web-based control panel for creating, running, and managing Minecraft servers directly on the host operating system without container runtimes (such as Docker).

Each Minecraft server process is spawned natively via an installed OpenJDK runtime (`java -jar ...`). By removing container overhead, Kinetictyl delivers lightweight process supervision and instant startup times, making it ideal for home labs, VPS instances, and host environments where Docker is unavailable or unwanted.

---

## ✨ Features

- **Docker-Free Process Supervision**: Native Java child process management directly on OpenJDK runtimes (Java 8 / 11 / 16 / 17 / 21) with `stop` escalation timers and crash auto-restarts.
- **Pterodactyl Role Separation**: Admins provision servers and allocate hardware resources; users manage assigned servers (Console, File Manager, Backups, Schedules).
- **MCJars Integration**: First-class integration with [mcjars.app](https://mcjars.app) for real-time catalog discovery, version selection, and automated installation pipelines (`download`, `unzip`, `remove`).
- **Integrated SFTP SSH Server**: Embedded SFTP daemon (listening on port `2022`) allowing direct, secure file management via FileZilla / WinSCP confined to the server directory root.
- **Strict Security Guards**: Canonicalized path validation (`validatePath`) preventing path traversal outside server root boundaries and Zip-slip archive extraction protection.
- **Pterodactyl-Style Flat UI**: High-contrast, responsive dark dashboard built with React, Vite, and Vanilla CSS, featuring live console streams over WebSocket.
- **PM2 Orchestration**: Ready out-of-the-box for production deployment using PM2 process management (`ecosystem.config.js`).

---

## 🏗 Monorepo Architecture

Kinetictyl is structured as a TypeScript monorepo using npm workspaces:

```
kinetictyl/
├── ecosystem.config.js          # PM2 Orchestration configuration
├── packages/
│   └── shared/                  # Shared schemas, AES-256-GCM crypto, Zod validators, TypeScript types
├── apps/
│   ├── agent/                   # Agent Daemon: Java process supervisor & integrated SFTP server (Ports 8081 & 2022)
│   └── panel/                   # Panel Web Server: Express REST API, WebSocket gateway, Prisma DB, Vite React frontend (Port 8080)
│       └── frontend/            # React + Vite client frontend
```

---

## ⚙️ Quick Start

### Prerequisites

- **Node.js**: v20.0.0 or higher
- **npm**: v9.0.0 or higher
- **Java OpenJDK**: Java 17 or 21 installed on host system PATH

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/xAyan55/kinetictyl.git
   cd kinetictyl
   ```

2. **Install workspace dependencies**:
   ```bash
   npm install
   cd apps/panel/frontend && npm install && cd ../../..
   ```

3. **Initialize the SQLite database**:
   ```bash
   npm run db:push --workspace=@kinetictyl/panel
   ```

4. **Build all packages**:
   ```bash
   npm run build
   ```

5. **Start the Panel and Agent**:
   ```bash
   # Running via PM2 (Recommended)
   npm run start

   # Or running individual processes manually:
   node apps/agent/dist/index.js   # Agent (Port 8081 & SFTP Port 2022)
   node apps/panel/dist/index.js   # Panel (Port 8080)
   ```

6. **Access the Control Panel**:
   Open `http://localhost:8080` in your browser. The first registered account automatically receives the **Administrator** role.

---

## 🛡 Security Architecture

- **Path Canonicalization Guard**: Every file manager operation and archive extraction passes through `validatePath`, resolving absolute paths and verifying they reside inside the assigned server directory.
- **Process Isolation**: Spawns processes directly under unprivileged system users (`kt-server-<uuid>`) with systemd cgroups/scopes on Linux and Windows Job Objects on Windows.
- **Crypto Secrets**: Sensitive keys encrypted at rest using AES-256-GCM with PBKDF2 key derivation.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
