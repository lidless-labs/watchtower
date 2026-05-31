#!/usr/bin/env bash

# Watchtower Development Setup
# Quick setup for development without systemd/nginx
# Usage: bash dev.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${CYAN}Watchtower Dev Setup${NC}"
echo "Project: $PROJECT_DIR"
echo ""

# Check for required tools
command -v python3 >/dev/null 2>&1 || { echo "python3 required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

# Backend setup
echo -e "${GREEN}Setting up backend...${NC}"
cd "$PROJECT_DIR/backend"

if [[ ! -d "venv" ]]; then
    python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt -r requirements-dev.txt

# Frontend setup
echo -e "${GREEN}Setting up frontend...${NC}"
cd "$PROJECT_DIR/frontend"

if [[ ! -d "node_modules" ]]; then
    npm install
fi

# Create config if needed
if [[ ! -f "$PROJECT_DIR/config/config.yaml" ]]; then
    cp "$PROJECT_DIR/config/config.example.yaml" "$PROJECT_DIR/config/config.yaml"
    echo -e "${YELLOW}Created config/config.yaml from template${NC}"
fi

# Get local IP
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           Ready for Development           ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Terminal 1 - Backend:${NC}"
echo "  cd $PROJECT_DIR/backend"
echo "  source venv/bin/activate"
echo "  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo ""
echo -e "${YELLOW}Terminal 2 - Frontend:${NC}"
echo "  cd $PROJECT_DIR/frontend"
echo "  npm run dev -- --host"
echo ""
echo -e "Then open: ${GREEN}http://$IP:5173${NC}"
echo ""
