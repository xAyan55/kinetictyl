Product Requirements Document — Kinetictyl

Version: 1.0 · Status: Draft · Product type: Self-hosted Minecraft game server management panel

Overview

Kinetictyl is a web-based control panel for creating, running, and managing Minecraft servers without Docker. Each Minecraft server runs as a native OS process spawned directly via an installed OpenJDK runtime (java -jar ...). The panel follows the Pterodactyl operating model — admins provision servers and allocate them to users; users manage but never create servers — while removing the container layer entirely for simplicity and lower overhead.

Core value proposition: the isolation/complexity trade-off of Docker is replaced with lightweight process supervision, making Kinetictyl ideal for home labs, small hosts, and VPS setups where Docker is unavailable or unwanted.

Goals and Non-Goals
Goals
• Run Minecraft servers as supervised native Java processes (no containers, no Docker daemon dependency).
• Pterodactyl-style role separation: admins create/assign servers; users only manage assigned servers.
• First-class integration with the MCJars API (https://mcjars.app) for server software discovery and jar installation.
• Ship with one pre-created local node that auto-detects host RAM, CPU, and disk.
• Provide a full admin area: analytics overview, node management, user management, server provisioning.
• Support multiple Java versions side-by-side (Java 8 / 16 / 17 / 21) mapped per Minecraft version.

Non-Goals (v1)
• No container runtime of any kind.
• No support for non-Minecraft games.
• No billing/invoicing module.
• No user self-service server creation.
• No multi-region node federation beyond simple remote nodes (v1 ships local node; remote nodes are v1.1).

Personas

| Persona | Description | Key needs |
|---|---|---|
| Admin (host owner) | Installs Kinetictyl, owns the hardware | Provision servers, monitor resources, manage users |
| Server owner (user) | Receives a server from admin | Console, files, backups, restarts, players |
| Subuser (v1.1) | Invited by a server owner | Scoped permissions on a single server |

System Architecture

``mermaid
flowchart LR
    U[Browser] -->|HTTPS + WebSocket| P[Kinetictyl Panel<br/>Web App + REST API]
    P --> DB[(Database<br/>SQLite default / MySQL optional)]
    P -->|Node API token| D[Kinetictyl Agent<br/>process supervisor]
    D -->|spawn / stdin / stdout| J1[java -jar server.jar<br/>Server A]
    D --> J2[java -jar server.jar<br/>Server B]
    P -->|version metadata + jar URLs| M[mcjars.app API]
`

The diagram shows two components:

Panel — the web application (UI + REST API + WebSocket gateway). Owns users, servers, nodes, permissions, and analytics.
Agent — a lightweight daemon on each node (bundled with the panel for the default local node). Responsibilities:
   - Spawn Java processes with configured flags (-Xms, -Xmx, extra JVM args).
   - Capture stdout/stderr and stream to the panel over WebSocket; forward console input to stdin.
   - Enforce graceful stop (stop command → wait → SIGTERM → SIGKILL escalation).
   - Report per-process CPU/RAM and per-server disk usage.
   - Execute install pipelines (download jar, run installers, write eula.txt).
   - Perform backups (tar/zip of the server directory).

No-Docker isolation strategy (must-have):
• Each server runs in its own directory: /var/lib/kinetictyl/servers/<uuid>/.
• All file operations are path-validated against the server root (zip-slip guarded, symlink escape blocked).
• Optional (Linux): run each server process under a dedicated unprivileged system user, and apply cgroup v2 CPU/memory limits and ulimit caps when available. Degrade gracefully on Windows (Job Objects) or when unsupported.
• Panel-enforced disk quotas: a background size indexer blocks disk-growing operations for servers over quota.

Java runtime management:
• The agent detects installed OpenJDK versions and can download managed runtimes (Adoptium/Temurin) into /var/lib/kinetictyl/runtimes/.
• MC version → Java version mapping is derived from the MCJars API (version.java field), with per-server override in advanced settings.

Feature Requirements
5.1 Authentication

Routes: /auth/register, /auth/login

Layout: Split-screen design. Left half: static hero image served from /images/bgs/auth.jpg (cover-fit, subtle dark gradient overlay with the Kinetictyl wordmark). Right half: the form card. On viewports < 900 px the image collapses and only the form renders.

Register (/auth/register)
• Fields: Username (3–32 chars, alphanumeric + ), Email, Password, Confirm Password.
• Password policy: minimum 8 characters, checked against a common-password blocklist; UI copy instructs it should be unique to this website.
• First registered account becomes the admin automatically; admin may then disable public registration (setting: ALLOWREGISTRATION, default on for first-run, prompt to disable after).
• Passwords hashed with bcrypt (cost ≥ 12) or argon2id.

Login (/auth/login)
• Fields: Email or Username, Password, "Remember me".
• Rate limiting: 5 failed attempts per account per 15 min → temporary lockout; per-IP throttling as well.
• Session: HTTP-only, SameSite=Strict cookies; sessions stored server-side; CSRF tokens on all state-changing requests.
• v1.1: TOTP two-factor authentication.

Acceptance criteria
• Registering with a 7-char password fails with an inline validation message.
• Successful login redirects to /; unauthenticated access to any panel route redirects to /auth/login.

5.2 Server List (/)
• Grid/list of all servers assigned to the logged-in user (owned + shared).
• Each card shows: server name, node, MC version + software type (e.g., Paper 1.21.4), live status pill (Online / Offline / Starting / Stopping), live CPU %, RAM used / limit, disk used / quota, player count x/y, and the connection address ip:port with a copy button.
• Status and metrics update in real time via WebSocket (poll fallback every 10 s).
• Clicking a card opens Server Management at /server/<uuid>.
• Empty state: "No servers yet — an administrator must assign one to your account." (No create button for non-admins, ever.)

5.3 Server Management (/server/<uuid>)

Tabbed interface, gated per-tab by permissions:

| Tab | Contents |
|---|---|
| Console | Live scrolling log (ANSI color parsed), command input with history, Start / Restart / Stop / Kill buttons (Kill requires confirm), mini CPU/RAM/TPS sparkline |
| Files | Browser-based file manager scoped to server root: browse, upload (drag-drop), download, rename, delete, in-browser editor with syntax highlighting for .properties/.yml/.json/.toml, archive/unarchive. SFTP credentials shown under Settings |
| Backups | Create / restore / download / delete backups; per-server backup slot limit set by admin; restore requires server offline |
| Schedules | Cron-based tasks: send command, restart, create backup. Cron helper UI |
| Startup | View/edit JVM flags within admin-set bounds; -Xms/-Xmx sliders capped at allocation; Java runtime override dropdown (auto / 8 / 16 / 17 / 21) |
| Version | Change software type/version via MCJars catalog (see §5.6); changing version triggers reinstall of the jar only, world data preserved; forced backup prompt first |
| Settings | Rename server, view SFTP details, reinstall server (destructive, double-confirm) |
| Activity | Audit log of actions on this server (who, what, when) |

Process lifecycle rules
• Stop = send configured stop command (stop) → wait up to 60 s → SIGTERM → 15 s → SIGKILL.
• Crash detection: non-zero exit while status = running → auto-restart with exponential backoff, max 3 attempts in 10 min, then mark Crashed.
• EULA: on first install the agent writes eula.txt with eula=true after the user accepts a EULA checkbox in the UI.

5.4 Account Page (/account)

Update Password card — three inputs, in this order:
• Current Password
• New Password — helper text: "The new password should be at least 8 characters in length and unique to this website." Live strength meter; server-side re-validation.
• Confirm New Password — must match.
• On success: rotate all other active sessions, show toast.

Update Email Address card:
• Email — new address, format-validated, uniqueness-checked.
• Confirm Password — current password required to authorize the change.
• v1.1: confirmation link sent to the new address before switch takes effect.

Additional account features:
• API Keys — create/revoke personal API tokens (shown once), with per-key last-used timestamp.
• Active Sessions — list of sessions (IP, user agent, last activity) with "revoke" and "revoke all others".
• SSH/SFTP — display of per-server SFTP usernames.
• Appearance — light/dark theme toggle, timezone preference (drives log timestamps).

5.5 Admin Panel (/admin/*)

Visible only to role = admin. Sidebar: Overview · Nodes · Users · Servers · Settings.

5.5.1 Overview (/admin/overview)

Graphical analytics dashboard:
• Stat cards: Total Users, Total Servers, Servers Online, Total Nodes.
• System resource charts (live, per node, 60 s granularity, 24 h retention shown):
  - CPU usage % (line chart)
  - RAM used vs total (area chart)
  - Disk used vs total (gauge/bar)
  - Network I/O (line, v1.1)
• Allocation view: RAM/disk allocated to servers vs physically available (overallocation highlighted in amber/red).
• Recent activity feed (last 20 audit events panel-wide).
• Panel version + update-available banner.

5.5.2 Nodes (/admin/nodes)
• Default node: on first boot the installer auto-creates a node named local pointing at the host machine, with auto-fetched RAM, CPU cores, and disk capacity (re-scanned every 5 min and on demand via "Refresh resources").
• Node list: name, FQDN/IP, status (heartbeat), RAM alloc/total, disk alloc/total, server count.
• Node detail: edit name/address, set overallocation % for RAM/disk, define port allocation ranges (e.g., 25565–25600), view servers on node, regenerate agent token.
• Add remote node (v1.1): generates an agent install command + auth token.

5.5.3 Users (/admin/users)
• Searchable table: username, email, role, server count, 2FA status, created date.
• Create user (with optional "require password change on first login"), edit, suspend, delete (blocked while user owns servers — must reassign first).
• Promote/demote admin role.

5.5.4 Servers (/admin/servers)

Only admins create servers. Creation wizard:

Owner — pick the user.
Node & allocation — pick node; pick a free port from the node's range; validate remaining RAM/disk against overallocation policy.
Software — type + version picker backed by MCJars (§5.6).
Resources — RAM limit (drives -Xmx; -Xms defaulted equal), disk quota, CPU limit % (cgroup where supported, advisory elsewhere), backup slot count.
Startup — generated command preview: java -Xms{M}M -Xmx{M}M {extraflags} -jar server.jar nogui; optional Aikar's-flags preset toggle.
Create → server enters Installing state; agent runs the install pipeline; transitions to Offline when done.

Admin server table additionally supports: reassign owner, transfer node (v1.1), suspend (blocks start + user access), force reinstall, delete (with "also delete files" checkbox).

5.5.5 Settings (/admin/settings)

Panel name/branding, registration toggle, default backup limits, SMTP config (optional, for password reset emails), MCJars base URL override (for self-hosted mirrors).

5.6 Minecraft Version Provider — MCJars Integration

All server software metadata and jar acquisition come from https://mcjars.app (per the provided OpenAPI spec, v3 endpoints preferred; v1/v2 equivalents are deprecated).

Endpoints used:

| Purpose | Endpoint |
|---|---|
| List supported software types (grouped: recommended/established/experimental) | GET /api/v2/types |
| List versions for a type (paginated, searchable) | GET /api/v3/builds/types/{type}/versions?fields=created&fields=java&page=1&perpage=50&search= |
| List builds for a version | GET /api/v3/builds/types/{type}/versions/{version} |
| Get latest build (supports latest / latest-snapshot) | GET /api/v3/builds/types/{type}/versions/{version}/latest |
| Identify an unknown jar by hash | POST /api/v3/builds/search (sha256 of jar) |

Supported ServerType values (from the spec): VANILLA, PAPER, PURPUR, SPIGOT, PUFFERFISH, FOLIA, FABRIC, QUILT, FORGE, NEOFORGE, SPONGE, MOHIST, ARCLIGHT, LEAVES, LEAF, CANVAS, DIVINEMC, ... plus proxies VELOCITY, BUNGEECORD, WATERFALL. v1 UI surfaces the recommended group prominently (Vanilla, Paper, Purpur, Fabric, Forge, NeoForge, Velocity) with an "show all" expander for the rest.

Install pipeline: each MCJars build returns an installation array of step groups; each step is one of:
• download — { url, file, size } → agent downloads to server root, verifies size (and hash when provided).
• unzip — { file, location } → extract with zip-slip guard.
• remove — { location } → delete path (validated inside server root).

The agent executes step groups sequentially, streaming progress to the creation/console UI. The version.java field from the API response selects the Java runtime automatically.

Caching & resilience: panel caches type/version lists for 15 min; if mcjars.app is unreachable, cached catalog is served with a stale banner, and installs fail gracefully with retry.

Roles & Permission Model (Pterodactyl-style)

| Capability | Admin | Server owner | Subuser (v1.1) |
|---|---|---|---|
| Create/delete servers | ✅ | ❌ | ❌ |
| Manage nodes/users | ✅ | ❌ | ❌ |
| Start/stop/console | ✅ (any) | ✅ (own) | per-grant |
| Files/backups/schedules | ✅ (any) | ✅ (own) | per-grant |
| Change version/startup | ✅ | ✅ within admin-set bounds | per-grant |
| Change RAM/disk/CPU limits | ✅ | ❌ | ❌ |

Every permission is enforced server-side on every request — never UI-only.

Data Model (core entities)
• User — id, username, email, passwordhash, role, totpsecret?, createdat
• Session — id, userid, ip, useragent, expiresat
• ApiKey — id, userid, tokenhash, lastusedat
• Node — id, name, address, agenttokenhash, cpucores, ramtotal, disktotal, ramoverallocpct, diskoverallocpct, portrange, islocal
• Server — id (uuid), name, ownerid, nodeid, type (ServerType), versionid, builduuid, port, ramlimit, disklimit, cpulimit, javaoverride?, status, suspended, createdat
• Backup — id, serverid, filename, size, checksum, createdat
• Schedule / Task — cron, action, payload, lastrun, enabled
• AuditLog — actorid, serverid?, action, metadata, ip, createdat
• MetricSample — nodeid/serverid, cpu, ram, disk, timestamp (rolled up: 1 min → 1 h → 1 day)

Default DB: SQLite (zero-config, matching the no-Docker simplicity goal); MySQL/PostgreSQL optional via config.

Security Requirements
• All secrets (agent tokens, SFTP passwords) encrypted at rest (AES-256-GCM, key derived from APP_SECRET).
• Panel binds to 127.0.0.1 by default; exposing on 0.0.0.0 is explicit opt-in with a docs warning to put TLS in front (or built-in Let's Encrypt in v1.1).
• CSP, X-Frame-Options: DENY, nosniff headers on every response; WebSockets authenticate the session cookie on upgrade with Origin checks.
• File manager and install pipeline: strict path canonicalization, symlink resolution, archive extraction size caps.
• Console command input sanitized (no shell interpolation — commands go to the Java process stdin only; the agent never invokes a shell with user input).
• Jar downloads restricted to URLs returned by the configured MCJars host.
• Locked-out admin recovery: CLI maintenance command kinetictyl user:reset-password <username>`.

Non-Functional Requirements

| Area | Requirement |
|---|---|
| Panel footprint | ≤ 300 MB RAM idle (excluding game servers) |
| Console latency | Log line visible in browser < 250 ms after emission |
| Scale (v1) | 1 node, 50 servers, 100 users without degradation |
| Metrics overhead | Agent sampling ≤ 2% of one core |
| Browser support | Last 2 versions of Chrome/Firefox/Edge/Safari; responsive ≥ 360 px |
| OS support | Linux x64/arm64 primary; Windows Server best-effort |
| Backup/restore | 5 GB world backup completes < 5 min on SSD |

Milestones

| Phase | Scope |
|---|---|
| M1 — Core | Auth, session security, local node auto-provision, admin server creation, MCJars install pipeline, console + start/stop, server list |
| M2 — Management | File manager, SFTP, backups, schedules, account page, startup editor, version switcher |
| M3 — Admin depth | Overview analytics with charts, user management, audit logs, disk quota enforcement, suspend |
| M4 — Hardening | cgroup limits, crash-loop handling, 2FA, remote nodes, subusers, email flows |

Open Questions
Should CPU limits be hard (cgroup) or advisory-only on platforms without cgroup v2? (Proposed: hard where available, advisory elsewhere, surfaced in the node UI.)
Modpack support (CurseForge/Modrinth import) — v1.1 or v2?
Should proxy types (Velocity/BungeeCord) get a special "network" grouping UI in v1, or be treated as ordinary servers?

One architectural point worth flagging early to whoever implements this: without Docker, the dedicated-system-user-per-server + cgroup approach in §4 is the single most important security control — a malicious plugin in one server must not be able to read another server's files or the panel database, and directory permissions alone won't guarantee that if everything runs as the same user.