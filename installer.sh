#!/bin/bash
############################################################################
# Kinetictyl Management Panel Installer
# GNU General Public License v2 — All Rights Reserved
############################################################################

set -uo pipefail

readonly VERSION="1.0.0-Kinetictyl"
readonly LOG="/tmp/kinetictyl-installer.log"
readonly PANEL_REPO="https://github.com/xAyan55/kinetictyl.git"

PNPM_REGISTRY="https://registry.npmjs.org"
PNPM="pnpm"
PNPM_STORE="/root/.pnpm-store"

declare -a ADDONS=(
    "Modrinth|https://github.com/xAyan55/addons.git|modrinth|modrinth"
    "Parachute|https://github.com/xAyan55/addons.git|parachute|parachute"
)

# =============================================================================
# ANSI & Helpers
# =============================================================================
ESC=$'\033'
RESET="${ESC}[0m"
BOLD="${ESC}[1m"
DIM="${ESC}[2m"
REV="${ESC}[7m"
C_GREEN="${ESC}[92m"
C_RED="${ESC}[91m"
C_GRAY="${ESC}[90m"
C_CYAN="${ESC}[96m"
C_YELLOW="${ESC}[93m"
HIDE_CURSOR="${ESC}[?25l"
SHOW_CURSOR="${ESC}[?25h"
CLEAR_SCREEN="${ESC}[2J${ESC}[H"

move_to() { printf "${ESC}[%d;%dH" "$1" "$2"; }
clr_line() { printf "${ESC}[2K"; }

log()  { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }
info() { log "INFO: $*"; }
ok()   { log "OK: $*"; }
warn() { log "WARN: $*"; }

die() {
    printf "%b" "${SHOW_CURSOR}" 2>/dev/null || true
    tput rmcup 2>/dev/null || printf "%b" "${CLEAR_SCREEN}" 2>/dev/null || true
    stty echo 2>/dev/null || true
    printf "\n${BOLD}  error:${RESET} %s\n\n" "$*" >&2
    log "ERROR: $*"
    exit 1
}

# =============================================================================
# OS Detection
# =============================================================================
OS_NAME=""
OS_VER=""
FAM=""
PKG=""

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS_NAME="${NAME:-linux}"
        OS_VER="${VERSION_ID:-0}"
    fi

    if [[ -f /etc/debian_version ]]; then
        FAM="debian"
        PKG="apt-get"
    elif [[ -f /etc/redhat-release || -f /etc/fedora-release ]]; then
        FAM="redhat"
        PKG="dnf"
        command -v dnf &>/dev/null || PKG="yum"
    elif [[ -f /etc/arch-release ]]; then
        FAM="arch"
        PKG="pacman"
    elif [[ -f /etc/alpine-release ]]; then
        FAM="alpine"
        PKG="apk"
    else
        die "Unsupported distribution: ${OS_NAME}"
    fi

    log "OS: ${OS_NAME} ${OS_VER} (family: ${FAM}, pkg: ${PKG})"
}

pkg_install() {
    case "$FAM" in
        debian)
            DEBIAN_FRONTEND=noninteractive apt-get update -qq -y &>/dev/null || true
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" &>/dev/null
            ;;
        redhat) $PKG install -y -q "$@" &>/dev/null ;;
        arch)   pacman -Sy --noconfirm --needed "$@" &>/dev/null ;;
        alpine) apk add --no-cache "$@" &>/dev/null ;;
    esac
}

# =============================================================================
# CLI Args
# =============================================================================
ARG_MODE=""
ARG_NAME=""
ARG_PORT=""
ARG_PANEL_ADDR=""
ARG_DAEMON_PORT=""
ARG_DAEMON_KEY=""
ARG_ADDONS=""

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --panel-only)  ARG_MODE="panel";        shift ;;
            --daemon-only) ARG_MODE="daemon";       shift ;;
            --name)        ARG_NAME="${2:-}";        shift 2 ;;
            --port)        ARG_PORT="${2:-}";        shift 2 ;;
            --panel-addr)  ARG_PANEL_ADDR="${2:-}";  shift 2 ;;
            --daemon-port) ARG_DAEMON_PORT="${2:-}"; shift 2 ;;
            --daemon-key)  ARG_DAEMON_KEY="${2:-}";  shift 2 ;;
            --addons)      ARG_ADDONS="${2:-}";      shift 2 ;;
            *) log "Unknown arg ignored: $1"; shift ;;
        esac
    done
}

noninteractive() {
    [[ -n "${ARG_MODE}${ARG_NAME}${ARG_PORT}${ARG_PANEL_ADDR}${ARG_DAEMON_PORT}${ARG_DAEMON_KEY}${ARG_ADDONS}" ]]
}

# =============================================================================
# Non-interactive UI
# =============================================================================
NI_STEP=0
NI_TOTAL=0
_NI_SPIN_CHARS=('-' '\' '|' '/')

ni_header() {
    printf "\n"
    printf "  _  ___ netictyl\n"
    printf " | |/ (_)_ __   ___| |_(_) ___| |_ _   _ |\n"
    printf " | ' /| | '_ \ / _ \ __| |/ __| __| | | | |\n"
    printf " | . \| | | | |  __/ |_| | (__| |_| |_| | |\n"
    printf " |_|\_\_|_| |_|\___|\__|_|\___|\__|\__,_|_|\n"
    printf "\n"
    printf "  ${BOLD}Kinetictyl Installer${RESET} ${C_GRAY}v${VERSION}${RESET}  ${C_GRAY}%s${RESET}\n\n" "$(date '+%Y-%m-%d %H:%M:%S')"
}

ni_start() { NI_TOTAL="$1"; NI_STEP=0; }

parse_status_line() {
    local line="$1"
    if [[ "$line" =~ "Packages:".*"installed" ]]; then
        echo "pnpm: $(echo "$line" | grep -o '[0-9]* installed' | head -1) packages"
        return
    fi
    if [[ "$line" =~ "Cloning into" ]]; then
        echo "git: cloning repository"
        return
    fi
    if [[ "$line" =~ ^"Get:" ]]; then
        echo "apt: fetching packages"
        return
    fi
    local stripped; stripped=$(echo "$line" | sed 's/^[[:space:]]*//' | tr -cd '[:print:]')
    [[ -n "$stripped" ]] && echo "${stripped}" || echo ""
}

ni_run() {
    local label="$1"; shift
    NI_STEP=$(( NI_STEP + 1 ))
    local fi=0
    local outfile; outfile=$(mktemp /tmp/kt-step-XXXXXX)
    local out_lines=6

    "$@" >"$outfile" 2>&1 &
    local pid=$!

    while kill -0 "$pid" 2>/dev/null; do
        printf "\r  ${C_GRAY}[%02d/%02d]${RESET} %-42s ${_NI_SPIN_CHARS[$fi]}" "$NI_STEP" "$NI_TOTAL" "$label"
        fi=$(( (fi + 1) % 4 ))

        local last_line raw_status
        last_line=$(grep -v '^[[:space:]]*$' "$outfile" 2>/dev/null | tail -1)
        raw_status=$(parse_status_line "$last_line")
        if [[ -n "$raw_status" ]]; then
            printf "\n    ${C_YELLOW}status:${RESET} ${C_GRAY}%-68.68s${RESET}" "$raw_status"
        else
            printf "\n%76s" ""
        fi

        local li=0
        while IFS= read -r line; do
            printf "\n    ${C_GRAY}%-72.72s${RESET}" "$line"
            li=$(( li + 1 ))
        done < <(tail -n${out_lines} "$outfile" 2>/dev/null)
        while [[ $li -lt $out_lines ]]; do
            printf "\n%76s" ""
            li=$(( li + 1 ))
        done
        printf "\033[%dA\r" $(( out_lines + 1 ))
        sleep 0.1
    done

    wait "$pid"
    local status=$?

    local li
    printf "\n%76s" ""
    for (( li = 0; li < out_lines; li++ )); do printf "\n%76s" ""; done
    printf "\033[%dA\r" $(( out_lines + 1 ))

    if [[ $status -eq 0 ]]; then
        printf "\r  ${C_GRAY}[%02d/%02d]${RESET} %-42s ${C_GREEN}done${RESET}\n" "$NI_STEP" "$NI_TOTAL" "$label"
        log "OK: $label"
    else
        printf "\r  ${C_GRAY}[%02d/%02d]${RESET} %-42s ${C_RED}FAIL${RESET}\n" "$NI_STEP" "$NI_TOTAL" "$label"
        local err_tail; err_tail=$(tail -n20 "$outfile" 2>/dev/null || true)
        rm -f "$outfile"
        log "ERROR: $label failed"
        printf "\n${BOLD}  failed:${RESET} %s\n\n%s\n\n" "$label" "$err_tail"
        exit 1
    fi

    rm -f "$outfile"
}

# =============================================================================
# TUI Engine
# =============================================================================
TERM_ROWS=24
TERM_COLS=80
_TUI_ACTIVE=0

tui_measure() {
    TERM_ROWS=$(tput lines  2>/dev/null || echo 24)
    TERM_COLS=$(tput cols   2>/dev/null || echo 80)
    [[ $TERM_ROWS -lt 18 ]] && TERM_ROWS=18
    [[ $TERM_COLS -lt 60 ]] && TERM_COLS=60
}

tui_cleanup() {
    if [[ $_TUI_ACTIVE -eq 1 ]]; then
        _TUI_ACTIVE=0
        printf "%b" "${SHOW_CURSOR}"
        tput rmcup 2>/dev/null || printf "%b" "${CLEAR_SCREEN}"
        stty echo 2>/dev/null || true
    fi
}

tui_init() {
    tui_measure
    tput smcup 2>/dev/null || printf "%b" "${CLEAR_SCREEN}"
    printf "%b" "${HIDE_CURSOR}"
    stty -echo 2>/dev/null || true
    _TUI_ACTIVE=1
    trap 'tui_cleanup; exit 0' EXIT INT TERM
}

tui_box() {
    local row=$1 col=$2 w=$3 h=$4 title="${5:-}"
    local inner=$(( w - 2 ))

    move_to "$row" "$col"
    if [[ -n "$title" ]]; then
        local tlen=${#title}
        if [[ $(( tlen + 4 )) -gt $inner ]]; then
            tlen=$(( inner - 4 ))
            title="${title:0:$tlen}"
        fi
        local dashes=$(( inner - tlen - 2 ))
        local left_pad=$(( dashes / 2 ))
        local right_pad=$(( dashes - left_pad ))
        printf "+"
        [[ $left_pad -gt 0 ]] && printf '%*s' "$left_pad" '' | tr ' ' '-'
        printf " ${BOLD}%s${RESET} " "$title"
        [[ $right_pad -gt 0 ]] && printf '%*s' "$right_pad" '' | tr ' ' '-'
        printf "+"
    else
        printf "+"; printf '%*s' "$inner" '' | tr ' ' '-'; printf "+"
    fi

    local r
    for (( r = 1; r < h - 1; r++ )); do
        move_to $(( row + r )) "$col"
        printf "|%*s|" "$inner" ''
    done

    move_to $(( row + h - 1 )) "$col"
    printf "+"; printf '%*s' "$inner" '' | tr ' ' '-'; printf "+"
}

tui_hline() {
    local row=$1 col=$2 w=$3
    move_to "$row" "$col"
    printf "+"; printf '%*s' $(( w - 2 )) '' | tr ' ' '-'; printf "+"
}

_KEY=""
read_key() {
    local k1 k2 k3
    IFS= read -rsn1 k1
    if [[ "$k1" == $'\x1b' ]]; then
        IFS= read -rsn1 -t 0.05 k2 2>/dev/null || k2=""
        if [[ "$k2" == "[" ]]; then
            IFS= read -rsn1 -t 0.05 k3 2>/dev/null || k3=""
            case "$k3" in
                'A') _KEY="UP"    ;;
                'B') _KEY="DOWN"  ;;
                'C') _KEY="RIGHT" ;;
                'D') _KEY="LEFT"  ;;
                *)   _KEY="ESC"   ;;
            esac
        else
            _KEY="ESC"
        fi
    elif [[ "$k1" == "" || "$k1" == $'\n' || "$k1" == $'\r' ]]; then
        _KEY="ENTER"
    elif [[ "$k1" == $'\x7f' || "$k1" == $'\b' ]]; then
        _KEY="BACKSPACE"
    elif [[ "$k1" == " " ]]; then
        _KEY="SPACE"
    else
        _KEY="$k1"
    fi
}

_INSTALLING=0

_BANNER=(
    "  _  ___ netictyl"
    " | |/ (_)_ __   ___| |_(_) ___| |_ _   _ |"
    " | ' /| | '_ \ / _ \ __| |/ __| __| | | | |"
    " | . \| | | | |  __/ |_| | (__| |_| |_| | |"
    " |_|\_\_|_| |_|\___|\__|_|\___|\__|\__,_|_|"
    ""
    "  GNU General Public License v2 -- All Rights Reserved"
)

draw_banner() {
    local start_row=$1
    local banner_w=${#_BANNER[0]}
    local bx=$(( (TERM_COLS - banner_w) / 2 ))
    [[ $bx -lt 1 ]] && bx=1
    local bi
    for (( bi = 0; bi < ${#_BANNER[@]}; bi++ )); do
        move_to $(( start_row + bi )) "$bx"
        if [[ $bi -ge 6 ]]; then
            printf "${DIM}${C_GRAY}%s${RESET}" "${_BANNER[$bi]}"
        else
            printf "${DIM}%s${RESET}" "${_BANNER[$bi]}"
        fi
    done
}

TUI_RESULT=0

tui_menu() {
    local title="$1"; shift
    local -a items=("$@")
    local count=${#items[@]}
    local selected=0

    tui_measure

    local max_item_len=0
    local i
    for (( i = 0; i < count; i++ )); do
        local iw=${#items[$i]}
        [[ $iw -gt $max_item_len ]] && max_item_len=$iw
    done

    local min_needed=$(( max_item_len + 10 ))
    local preferred=$(( TERM_COLS * 60 / 100 ))
    local box_w=$preferred
    [[ $box_w -lt $min_needed ]] && box_w=$min_needed
    [[ $box_w -lt 60 ]]         && box_w=60
    [[ $box_w -gt $(( TERM_COLS - 4 )) ]] && box_w=$(( TERM_COLS - 4 ))

    local banner_h=7
    local gap=1
    local box_h=$(( count + 6 ))
    local total_h=$(( banner_h + gap + box_h ))

    local box_r=$(( (TERM_ROWS - total_h) / 2 + banner_h + gap ))
    [[ $box_r -lt $(( banner_h + gap + 1 )) ]] && box_r=$(( banner_h + gap + 1 ))
    local box_c=$(( (TERM_COLS - box_w) / 2 ))
    [[ $box_c -lt 1 ]] && box_c=1

    local inner=$(( box_w - 2 ))

    while true; do
        printf "%b" "${CLEAR_SCREEN}"
        draw_banner $(( box_r - banner_h - gap ))
        tui_box "$box_r" "$box_c" "$box_w" "$box_h" "$title"

        move_to $(( box_r + 1 )) $(( box_c + 2 ))
        printf "${DIM}%-${inner}s${RESET}" "arrows/jk move  enter select  0-9 hotkey  esc/q quit"

        tui_hline $(( box_r + 2 )) "$box_c" "$box_w"

        for (( i = 0; i < count; i++ )); do
            move_to $(( box_r + 3 + i )) $(( box_c + 1 ))
            local label=" [${i}] ${items[$i]}"
            if [[ $i -eq $selected ]]; then
                printf "${REV}%-${inner}s${RESET}" "$label"
            else
                printf "%-${inner}s" "$label"
            fi
        done

        move_to $(( box_r + box_h - 2 )) $(( box_c + 2 ))
        printf "${DIM}v${VERSION}${RESET}"

        read_key
        case "$_KEY" in
            UP|k)   [[ $selected -gt 0 ]]              && selected=$(( selected - 1 )) ;;
            DOWN|j) [[ $selected -lt $(( count-1 )) ]] && selected=$(( selected + 1 )) ;;
            ENTER)
                TUI_RESULT=$selected
                return 0
                ;;
            ESC|q|Q)
                if [[ $_INSTALLING -eq 0 ]]; then
                    TUI_RESULT=-1
                    return 1
                fi
                ;;
            [0-9])
                if [[ "${_KEY}" -lt $count ]]; then
                    TUI_RESULT="${_KEY}"
                    return 0
                fi
                ;;
        esac
    done
}

TUI_INPUT=""

tui_input() {
    local prompt="$1" default_val="${2:-}" err_msg="${3:-}"
    tui_measure
    local box_w=60 box_h=9
    local box_r=$(( (TERM_ROWS - box_h) / 2 ))
    local box_c=$(( (TERM_COLS - box_w) / 2 ))
    local inner=$(( box_w - 2 ))

    local val="$default_val"

    while true; do
        printf "%b" "${CLEAR_SCREEN}"
        tui_box "$box_r" "$box_c" "$box_w" "$box_h" "Input"

        move_to $(( box_r + 1 )) $(( box_c + 2 ))
        printf "${BOLD}%-${inner}s${RESET}" "$prompt"

        if [[ -n "$err_msg" ]]; then
            move_to $(( box_r + 2 )) $(( box_c + 2 ))
            printf "${C_RED}%-${inner}s${RESET}" "$err_msg"
        fi

        move_to $(( box_r + 4 )) $(( box_c + 2 ))
        printf "> ${REV}%-${inner}s${RESET}" "$val"

        move_to $(( box_r + 6 )) $(( box_c + 2 ))
        printf "${DIM}%-${inner}s${RESET}" "enter submit  backspace edit"

        read_key
        case "$_KEY" in
            ENTER)
                TUI_INPUT="$val"
                return 0
                ;;
            BACKSPACE)
                [[ ${#val} -gt 0 ]] && val="${val:0:-1}"
                ;;
            ESC)
                TUI_INPUT="$default_val"
                return 0
                ;;
            SPACE)
                val="${val} "
                ;;
            *)
                if [[ ${#_KEY} -eq 1 ]]; then
                    val="${val}${_KEY}"
                fi
                ;;
        esac
    done
}

# =============================================================================
# Dependencies Setup
# =============================================================================
ensure_deps() {
    local deps=(curl wget git openssl unzip tar)
    local missing=()
    for d in "${deps[@]}"; do
        command -v "$d" &>/dev/null || missing+=("$d")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        log "Installing missing base packages: ${missing[*]}"
        pkg_install "${missing[@]}"
    fi
}

setup_node() {
    log "Checking Node.js 20 LTS..."
    if command -v node &>/dev/null; then
        local current_major
        current_major=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
        if [[ "$current_major" == "20" || "$current_major" == "22" ]]; then
            log "Node.js $(node -v) is ready"
        else
            log "Upgrading Node.js to 20 LTS"
            _install_node_20
        fi
    else
        _install_node_20
    fi

    command -v node &>/dev/null || die "Node.js install failed"
    log "Node.js $(node -v) ready"

    if ! command -v pnpm &>/dev/null; then
        npm install -g pnpm pm2 &>/dev/null || die "pnpm/pm2 install failed"
    fi
    PNPM=$(command -v pnpm)
}

_install_node_20() {
    case "$FAM" in
        debian)
            curl -fsSL "https://deb.nodesource.com/setup_20.x" | bash -
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
            ;;
        redhat)
            curl -fsSL "https://rpm.nodesource.com/setup_20.x" | bash -
            $PKG install -y -q nodejs
            ;;
        arch)   pacman -Sy --noconfirm --needed nodejs npm ;;
        alpine) apk add --no-cache nodejs npm ;;
    esac
}

setup_java() {
    log "Checking OpenJDK Java installation..."
    if command -v java &>/dev/null; then
        log "Java already installed: $(java -version 2>&1 | head -1)"
        return 0
    fi

    log "Installing OpenJDK 17/21..."
    case "$FAM" in
        debian)
            DEBIAN_FRONTEND=noninteractive apt-get update -qq -y || true
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-17-jre-headless || \
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq default-jre
            ;;
        redhat) $PKG install -y -q java-17-openjdk-headless || $PKG install -y -q java-latest-openjdk-headless ;;
        arch)   pacman -Sy --noconfirm --needed jre17-openjdk-headless ;;
        alpine) apk add --no-cache openjdk17-jre-headless ;;
    esac

    command -v java &>/dev/null || die "Java OpenJDK installation failed"
    log "Java: $(java -version 2>&1 | head -1)"
}

valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [[ "$1" -ge 1 ]] && [[ "$1" -le 65535 ]]; }

# =============================================================================
# Panel & Agent Installation Phases
# =============================================================================
PANEL_NAME="Kinetictyl"
PANEL_PORT="3000"
PANEL_ADDRESS="127.0.0.1"
DAEMON_PORT="3001"
DAEMON_KEY=""

phase_panel_clone() {
    mkdir -p /var/www
    local tmpdir; tmpdir=$(mktemp -d /tmp/kt-panel-XXXXXX)
    git clone --depth 1 "${PANEL_REPO}" "$tmpdir" || die "Failed to clone repository"

    if [[ -d /var/www/kinetictyl ]]; then
        echo "Overwriting existing Kinetictyl installation..."
        cp -rf "$tmpdir"/* /var/www/kinetictyl/
    else
        mkdir -p /var/www/kinetictyl
        cp -rf "$tmpdir"/* /var/www/kinetictyl/
    fi

    rm -rf "$tmpdir"
    chmod -R 755 /var/www/kinetictyl
}

ensure_swap() {
    local mem_total
    mem_total=$(free -m 2>/dev/null | awk '/Mem:/ {print $2}') || mem_total=2048
    if [[ "$mem_total" -lt 2048 ]]; then
        if ! swapon -s 2>/dev/null | grep -q /swapfile; then
            log "Low RAM ($mem_total MB) detected. Setting up 1GB swapfile..."
            fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 2>/dev/null || true
            chmod 600 /swapfile 2>/dev/null || true
            mkswap /swapfile 2>/dev/null || true
            swapon /swapfile 2>/dev/null || true
        fi
    fi
}

phase_panel_deps() {
    ensure_swap
    cd /var/www/kinetictyl/airlink-panel || die "Panel directory missing"
    NODE_OPTIONS="--max-old-space-size=1024" NODE_ENV=development "$PNPM" install --no-frozen-lockfile --child-concurrency 1 || die "Panel dependency install failed"
}

phase_panel_build() {
    cd /var/www/kinetictyl/airlink-panel || die "Panel directory missing"
    "$PNPM" run migrate:deploy || die "Database migration failed"
    "$PNPM" run build || die "Panel build failed"

    if [[ ! -f /var/www/kinetictyl/airlink-panel/.env ]]; then
        local secret; secret=$(openssl rand -hex 32)
        cat > /var/www/kinetictyl/airlink-panel/.env <<ENVEOF
NAME=${PANEL_NAME}
NODE_ENV=production
URL=http://${PANEL_ADDRESS}:${PANEL_PORT}
PORT=${PANEL_PORT}
DATABASE_URL=file:/var/www/kinetictyl/airlink-panel/storage/dev.db
SESSION_SECRET=${secret}
ENVEOF
    fi
}

phase_daemon_deps() {
    ensure_swap
    cd /var/www/kinetictyl/airlink-daemon || die "Daemon directory missing"
    NODE_OPTIONS="--max-old-space-size=1024" NODE_ENV=development "$PNPM" install --no-frozen-lockfile --child-concurrency 1 || die "Daemon dependency install failed"
}

phase_daemon_build() {
    cd /var/www/kinetictyl/airlink-daemon || die "Daemon directory missing"
    "$PNPM" run build || die "Daemon build failed"

    if [[ ! -f /var/www/kinetictyl/airlink-daemon/.env ]]; then
        cat > /var/www/kinetictyl/airlink-daemon/.env <<ENVEOF
remote=http://${PANEL_ADDRESS}:${PANEL_PORT}
key=${DAEMON_KEY:-default_key_change_me_12345}
port=${DAEMON_PORT}
DEBUG=false
version=1.0.0
environment=production
STATS_INTERVAL=10000
ENVEOF
    fi
}

phase_services_start() {
    cd /var/www/kinetictyl || die "Kinetictyl root missing"

    if command -v pm2 &>/dev/null; then
        pm2 start ecosystem.config.js || true
        pm2 save || true
        pm2 startup || true
    fi

    cat > /etc/systemd/system/kinetictyl-panel.service <<SVCEOF
[Unit]
Description=Kinetictyl Management Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/kinetictyl/airlink-panel
EnvironmentFile=/var/www/kinetictyl/airlink-panel/.env
ExecStart=$(command -v node) dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

    cat > /etc/systemd/system/kinetictyl-agent.service <<SVCEOF
[Unit]
Description=Kinetictyl Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/kinetictyl/airlink-daemon
EnvironmentFile=/var/www/kinetictyl/airlink-daemon/.env
ExecStart=$(command -v node) dist/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload || true
    systemctl enable --now kinetictyl-panel || true
    systemctl enable --now kinetictyl-agent || true
}

# =============================================================================
# Run Installation
# =============================================================================
run_install() {
    ni_header
    ni_start 8
    ni_run "Checking base dependencies"  ensure_deps
    ni_run "Setting up Node.js 20 LTS"  setup_node
    ni_run "Setting up OpenJDK Java"    setup_java
    ni_run "Cloning Kinetictyl"         phase_panel_clone
    ni_run "Installing panel deps"      phase_panel_deps
    ni_run "Building panel"             phase_panel_build
    ni_run "Installing agent deps"      phase_daemon_deps
    ni_run "Building agent & services"  phase_daemon_build
    phase_services_start

    local server_ip
    server_ip=$(hostname -I 2>/dev/null | awk '{print $1}') || server_ip="<server-ip>"

    printf "\n  ${C_GREEN}${BOLD}Kinetictyl Installation Complete!${RESET}\n\n"
    printf "  ${C_GRAY}Panel :${RESET}  http://%s:%s\n" "$server_ip" "$PANEL_PORT"
    printf "  ${C_GRAY}Agent :${RESET}  http://%s:%s\n" "$server_ip" "$DAEMON_PORT"
    printf "  ${C_GRAY}Logs  :${RESET}  %s\n\n" "$LOG"
}

[[ $EUID -eq 0 ]] || { echo "Run as root or with sudo."; exit 1; }

touch "$LOG" || true
log "=== Kinetictyl Installer v${VERSION} started ==="

parse_args "$@"
detect_os
run_install
