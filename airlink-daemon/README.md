# Kinetictyl Agent (Daemon)

The Kinetictyl Agent is a lightweight supervisor and node manager that runs on target nodes/servers. It receives commands from the Kinetictyl Panel, manages server processes, handles file operations, streams real-time console logs over WebSockets, and monitors system metrics.

---

## Requirements

- Node.js v20 LTS or later
- Java OpenJDK 17 or 21 (for Minecraft server runtimes)
- pnpm v8+ (`npm install -g pnpm`)

---

## Installation & Setup

### Option 1 — Automatic Installer (Recommended)

The agent is installed automatically when using the official installer script:

```bash
curl -fsSL https://raw.githubusercontent.com/xAyan55/kinetictyl/main/installer.sh -o /tmp/installer.sh && chmod +x /tmp/installer.sh && bash /tmp/installer.sh
```

Manage agent with systemd:

```bash
systemctl start kinetictyl-agent
systemctl stop kinetictyl-agent
systemctl restart kinetictyl-agent
journalctl -u kinetictyl-agent -f
```

### Option 2 — Manual Setup

```bash
git clone https://github.com/xAyan55/kinetictyl.git
cd kinetictyl/airlink-daemon

# Install dependencies
pnpm install

# Build TypeScript source
pnpm run build

# Configure environment variables (.env)
cp example.env .env

# Start the agent
pnpm start
```

---

## Configuration (`.env`)

Configure the agent via environment variables in `.env`:

| Variable | Description |
|----------|-------------|
| `remote` | Full URL of your main Kinetictyl panel (e.g. `http://panel-ip:3000`) |
| `key` | Secret authentication key for node communication |
| `port` | Agent HTTP/WS listening port (default: `3001`) |
| `environment` | Set to `production` or `development` |
| `STATS_INTERVAL` | System stats collection interval in milliseconds (default: `10000`) |

---

## License

GNU General Public License v2 (GPL-2.0) — see [`LICENSE`](LICENSE) for details.

