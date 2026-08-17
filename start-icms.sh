#!/usr/bin/env bash
# ─── ICMS Full Stack Startup Script ─────────────────────────────────────────
# Run from ANY WSL terminal with just:  icms-start
# Works whether services are already running (Windows) or need to start (WSL)

set -uo pipefail

ICMS_DIR="/mnt/d/CLAUDE"
BE="$ICMS_DIR/icms-backend"
FE="$ICMS_DIR/icms-frontend"
BE_PORT=3001
FE_PORT=5173

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLU='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GRN}  ✅  $*${NC}"; }
warn() { echo -e "${YLW}  ⚠️   $*${NC}"; }
err()  { echo -e "${RED}  ❌  $*${NC}"; }
info() { echo -e "${BLU}  ℹ️   $*${NC}"; }

echo ""
echo -e "${BLU}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLU}║       ICMS — Starting All Services           ║${NC}"
echo -e "${BLU}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── 0. Load nvm (correct Node version) ───────────────────────────────────────
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" --no-use
# Use default or system node
NODE_BIN=$(command -v node 2>/dev/null || true)
if [ -z "$NODE_BIN" ]; then
  err "node not found — install nvm or Node.js first"
  exit 1
fi
info "Node: $(node --version)  |  $(which node)"

# ── 1. Detect Windows host IP (so WSL2 can talk to Windows processes) ─────────
WIN_HOST_IP=$(ip route show default 2>/dev/null | awk '/default/{print $3; exit}' || echo "")
TAILSCALE_IP="100.82.160.77"

# ── 2. Check Docker ───────────────────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
  err "Docker is not running — open Docker Desktop on Windows first, then re-run this script."
  exit 1
fi
ok "Docker is running"

# ── 3. Start icms-pg container ────────────────────────────────────────────────
if docker ps --format '{{.Names}}' | grep -q "^icms-pg$"; then
  ok "PostgreSQL (icms-pg) already running"
else
  info "Starting icms-pg..."
  if docker ps -a --format '{{.Names}}' | grep -q "^icms-pg$"; then
    docker start icms-pg > /dev/null
    ok "icms-pg started"
  else
    warn "icms-pg container not found — creating fresh..."
    docker run -d --name icms-pg -e POSTGRES_PASSWORD=icms123 -e POSTGRES_DB=icms \
      -p 5432:5432 postgres:16-alpine > /dev/null
    ok "icms-pg created & started"
    sleep 5
    info "Loading schema..."
    docker exec -i icms-pg psql -U postgres -d icms < "$BE/schema.sql" > /dev/null 2>&1 || true
    ok "Schema loaded"
  fi
  sleep 2
fi

# ── 4. Run migrations (idempotent — always safe) ─────────────────────────────
info "Running migrations..."
(cd "$BE" && node migrate.js) || { err "Migration failed!"; exit 1; }

# ── Helper: check if a service is reachable ───────────────────────────────────
service_running() {
  local url="$1"
  curl -s --max-time 2 "$url" > /dev/null 2>&1
}

# ── 5. Backend ────────────────────────────────────────────────────────────────
BE_RUNNING=false

# Check if backend is running on Windows (via Windows host IP or Tailscale)
if service_running "http://$WIN_HOST_IP:$BE_PORT/api/health" || \
   service_running "http://localhost:$BE_PORT/api/health" || \
   service_running "http://$TAILSCALE_IP:$BE_PORT/api/health"; then
  ok "Backend already running  → http://localhost:$BE_PORT"
  BE_RUNNING=true
fi

if ! $BE_RUNNING; then
  # Kill any stale WSL backend process
  pkill -f "node.*src/index.js" 2>/dev/null && warn "Killed stale backend" || true
  sleep 1
  info "Starting backend on port $BE_PORT..."
  (cd "$BE" && nohup node src/index.js > "$BE/backend.log" 2>&1 &)
  sleep 3
  if service_running "http://localhost:$BE_PORT/api/health" || \
     service_running "http://$WIN_HOST_IP:$BE_PORT/api/health"; then
    ok "Backend running  → http://localhost:$BE_PORT"
    ok "Logs: $BE/backend.log"
  else
    err "Backend failed to start! Last 20 lines of log:"
    tail -20 "$BE/backend.log" 2>/dev/null || true
    exit 1
  fi
fi

# ── 6. Frontend ───────────────────────────────────────────────────────────────
FE_RUNNING=false

if service_running "http://$WIN_HOST_IP:$FE_PORT" || \
   service_running "http://localhost:$FE_PORT" || \
   service_running "http://$TAILSCALE_IP:$FE_PORT"; then
  ok "Frontend already running  → http://localhost:$FE_PORT"
  FE_RUNNING=true
fi

if ! $FE_RUNNING; then
  pkill -f "node.*vite" 2>/dev/null && warn "Killed stale frontend" || true
  sleep 1
  info "Starting frontend on port $FE_PORT..."
  (cd "$FE" && nohup node node_modules/vite/bin/vite.js --host > "$FE/frontend.log" 2>&1 &)
  sleep 4
  if service_running "http://localhost:$FE_PORT" || \
     service_running "http://$WIN_HOST_IP:$FE_PORT"; then
    ok "Frontend running  → http://localhost:$FE_PORT"
    ok "Logs: $FE/frontend.log"
  else
    err "Frontend failed to start! Last 20 lines of log:"
    tail -20 "$FE/frontend.log" 2>/dev/null || true
    exit 1
  fi
fi

# ── 7. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GRN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GRN}║   🚀  ICMS is LIVE!                                  ║${NC}"
echo -e "${GRN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GRN}║  🌐 App:      http://localhost:$FE_PORT               ║${NC}"
echo -e "${GRN}║  🔗 Network:  http://$TAILSCALE_IP:$FE_PORT          ║${NC}"
echo -e "${GRN}║  🔌 API:      http://localhost:$BE_PORT/api/health    ║${NC}"
echo -e "${GRN}║  🔑 Login:    owner@icms.com  /  owner123             ║${NC}"
echo -e "${GRN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GRN}║  📋 Backend logs:   icms-logs-be                     ║${NC}"
echo -e "${GRN}║  📋 Frontend logs:  icms-logs-fe                     ║${NC}"
echo -e "${GRN}║  🛑 Stop all:       icms-stop                        ║${NC}"
echo -e "${GRN}║  📊 Check status:   icms-status                      ║${NC}"
echo -e "${GRN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
