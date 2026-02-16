#!/usr/bin/env bash
#
# Watchtower Update Script
# Pulls latest code, installs deps, rebuilds frontend, restarts services.
#
# Usage:
#   ./scripts/update.sh              # Full update (pull + deps + build + restart)
#   ./scripts/update.sh --no-pull    # Skip git pull (already pulled manually)
#   ./scripts/update.sh --backend    # Backend only (skip frontend build)
#   ./scripts/update.sh --frontend   # Frontend only (skip backend restart)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[UPDATE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse args
DO_PULL=true
DO_BACKEND=true
DO_FRONTEND=true

for arg in "$@"; do
    case $arg in
        --no-pull)   DO_PULL=false ;;
        --backend)   DO_FRONTEND=false ;;
        --frontend)  DO_BACKEND=false ;;
        --help|-h)
            echo "Usage: $0 [--no-pull] [--backend] [--frontend]"
            exit 0
            ;;
    esac
done

echo -e "${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║    WATCHTOWER UPDATE                 ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# 1. Git pull
if $DO_PULL; then
    log "Pulling latest from origin..."
    BEFORE=$(git rev-parse HEAD)
    git pull --ff-only origin main
    AFTER=$(git rev-parse HEAD)

    if [ "$BEFORE" = "$AFTER" ]; then
        log "Already up to date."
    else
        COMMITS=$(git log --oneline "$BEFORE".."$AFTER" | wc -l)
        log "Updated: $COMMITS new commit(s)"
        echo ""
        git log --oneline "$BEFORE".."$AFTER"
        echo ""
    fi
else
    log "Skipping git pull (--no-pull)"
fi

# 2. Backend dependencies
if $DO_BACKEND; then
    log "Checking backend dependencies..."
    cd "$PROJECT_DIR/backend"

    if [ -f requirements.txt ]; then
        # Check if any new deps need installing
        pip install -q -r requirements.txt 2>/dev/null || {
            warn "pip install failed, trying with --user"
            pip install --user -q -r requirements.txt
        }
        log "Backend deps OK"
    fi

    cd "$PROJECT_DIR"
fi

# 3. InfluxDB container
if $DO_BACKEND && [ -f docker-compose.yml ]; then
    if command -v docker &>/dev/null; then
        if docker ps --format '{{.Names}}' | grep -q 'watchtower-influxdb'; then
            log "InfluxDB container already running"
        else
            log "Starting InfluxDB container..."
            docker compose up -d influxdb 2>/dev/null || docker-compose up -d influxdb 2>/dev/null || {
                warn "Could not start InfluxDB container. Start manually: docker compose up -d influxdb"
            }
        fi
    else
        warn "Docker not found. InfluxDB must be started manually."
    fi
fi

# 4. Frontend build
if $DO_FRONTEND; then
    log "Building frontend..."
    cd "$PROJECT_DIR/frontend"

    if [ ! -d node_modules ]; then
        log "Installing frontend deps (first run)..."
        npm install
    fi

    # Check if deps changed
    if [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
        log "package.json changed, reinstalling deps..."
        npm install
    fi

    npm run build
    log "Frontend built → frontend/dist/"
    cd "$PROJECT_DIR"
fi

# 5. Restart backend
if $DO_BACKEND; then
    log "Restarting backend..."

    # Try systemd first
    if systemctl is-active --quiet watchtower 2>/dev/null; then
        sudo systemctl restart watchtower
        log "Restarted via systemd"

    # Try PM2
    elif command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q 'watchtower'; then
        pm2 restart watchtower
        log "Restarted via PM2"

    # Try finding and killing uvicorn
    elif pgrep -f "uvicorn.*app.main" &>/dev/null; then
        warn "Found running uvicorn. Killing and restarting..."
        pkill -f "uvicorn.*app.main" || true
        sleep 1
        cd "$PROJECT_DIR/backend"
        nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 &>/dev/null &
        log "Restarted uvicorn (PID: $!)"
        cd "$PROJECT_DIR"

    else
        warn "No running backend found. Start manually:"
        echo "  cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000"
    fi
fi

# 6. Summary
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗"
echo -e "║    UPDATE COMPLETE                   ║"
echo -e "╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  Commit:  $(git rev-parse --short HEAD)"
echo -e "  Branch:  $(git branch --show-current)"
echo ""

if $DO_BACKEND; then
    # Quick health check
    sleep 2
    if curl -sf http://localhost:8000/health &>/dev/null; then
        echo -e "  Backend: ${GREEN}● healthy${NC}"
    else
        echo -e "  Backend: ${YELLOW}● starting...${NC} (check in a few seconds)"
    fi
fi

if $DO_FRONTEND; then
    echo -e "  Frontend: ${GREEN}● built${NC} (frontend/dist/)"
fi

echo ""
