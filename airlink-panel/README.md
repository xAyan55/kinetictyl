> Kinetictyl Panel is stable and ready for production deployment.

# Kinetictyl Panel

**Dedicated Minecraft server & game server management panel**

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)

---

## What is this?

Kinetictyl Panel is a web-based control center for deploying, monitoring, and managing Minecraft and game servers across multiple nodes.

**Features:**
- Modern web interface for administrators and server owners
- Node-based architecture — single control panel managing multiple remote agents/nodes
- Built-in monetization and server management capabilities
- Addon system for extending functionality without modifying core code
- REST & WebSocket APIs for automation and real-time console streaming
- File manager, backups, server logs, and node metrics

---

## Prerequisites

- Node.js v20 LTS or later
- pnpm v8+ (`npm install -g pnpm`)
- Git

---

## Installation

### Option 1 — Automatic Installer (Recommended)

Run the official one-liner on your Linux server (Debian / Ubuntu / RHEL / Arch / Alpine):

```bash
curl -fsSL https://raw.githubusercontent.com/xAyan55/kinetictyl/main/installer.sh -o /tmp/installer.sh && chmod +x /tmp/installer.sh && bash /tmp/installer.sh
```

Manage panel with systemd:

```bash
systemctl start kinetictyl-panel
systemctl stop kinetictyl-panel
systemctl restart kinetictyl-panel
journalctl -u kinetictyl-panel -f
```

### Option 2 — Manual Setup

```bash
cd /var/www
git clone https://github.com/xAyan55/kinetictyl.git
cd kinetictyl/airlink-panel

# Install dependencies (ignoring native compilation)
pnpm install --ignore-scripts

# Configure environment
cp example.env .env
# Edit .env — set PORT, URL, SESSION_SECRET, and DATABASE_URL

# Run setup (database migration + build)
pnpm run setup

# Start the panel
pnpm run start
```

### Running with PM2

```bash
npm install -g pm2
pm2 start "pnpm run start" --name kinetictyl-panel
pm2 save
pm2 startup
```

---

## Configuration

Copy `example.env` to `.env` and fill in the required values:

| Variable | Required | Description |
|----------|----------|-------------|
| `NAME` | No | Panel display name (default: `Kinetictyl`) |
| `NODE_ENV` | Yes | Set to `production` for live deployments |
| `URL` | Yes | Full URL the panel is served from (e.g. `http://your-ip:3000`) |
| `PORT` | Yes | Port to listen on (default: `3000`) |
| `DATABASE_URL` | Yes | SQLite path, e.g. `file:/var/www/kinetictyl/airlink-panel/storage/dev.db` |
| `SESSION_SECRET` | Yes | Random secret key for session security |

---

## Development

```bash
# Install dependencies
pnpm install

# Start in development mode (with hot reload)
pnpm run dev

# Typecheck
pnpm run typecheck

# Build for production
pnpm run build
```

---

## License

GNU General Public License v2 (GPL-2.0) & MIT — see [`LICENSE`](LICENSE) for details.

