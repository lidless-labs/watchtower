#!/usr/bin/env bash
#
# InfluxDB Setup for Watchtower
# Sets up InfluxDB container and creates downsampling tasks.
#
# Usage:
#   ./scripts/setup-influxdb.sh                    # Use defaults
#   ./scripts/setup-influxdb.sh --token mytoken    # Custom admin token
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Defaults (match docker-compose.yml)
INFLUX_URL="${INFLUXDB_URL:-http://localhost:8086}"
INFLUX_ORG="${INFLUXDB_ORG:-watchtower}"
INFLUX_BUCKET="${INFLUXDB_BUCKET:-watchtower}"
INFLUX_TOKEN="${INFLUXDB_TOKEN:-watchtower-dev-token}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SETUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Parse args
for arg in "$@"; do
    case $arg in
        --token)  shift; INFLUX_TOKEN="$1" ;;
        --url)    shift; INFLUX_URL="$1" ;;
        --help|-h)
            echo "Usage: $0 [--token TOKEN] [--url URL]"
            exit 0
            ;;
    esac
    shift 2>/dev/null || true
done

echo -e "${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║    INFLUXDB SETUP                    ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# 1. Start container
log "Starting InfluxDB container..."
docker compose up -d influxdb 2>/dev/null || docker-compose up -d influxdb

# Wait for healthy
log "Waiting for InfluxDB to be ready..."
for i in $(seq 1 30); do
    if curl -sf "$INFLUX_URL/health" &>/dev/null; then
        log "InfluxDB is healthy"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: InfluxDB did not become healthy in 30 seconds"
        exit 1
    fi
    sleep 1
done

# 2. Create downsampling buckets
log "Creating retention buckets..."

# Hourly bucket (1 year retention)
docker exec watchtower-influxdb influx bucket create \
    --name watchtower_hourly \
    --retention 8760h \
    --org "$INFLUX_ORG" \
    --token "$INFLUX_TOKEN" 2>/dev/null || warn "watchtower_hourly bucket already exists"

# Daily bucket (5 year retention)
docker exec watchtower-influxdb influx bucket create \
    --name watchtower_daily \
    --retention 43800h \
    --org "$INFLUX_ORG" \
    --token "$INFLUX_TOKEN" 2>/dev/null || warn "watchtower_daily bucket already exists"

# 3. Create downsampling tasks
log "Creating downsampling tasks..."

# Hourly aggregation task
HOURLY_TASK='option task = {name: "downsample_hourly", every: 1h, offset: 5m}

from(bucket: "watchtower")
  |> range(start: -task.every)
  |> filter(fn: (r) => r["_measurement"] == "device_metrics" or r["_measurement"] == "interface_metrics" or r["_measurement"] == "network_summary" or r["_measurement"] == "speedtest_results")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> to(bucket: "watchtower_hourly", org: "'"$INFLUX_ORG"'")'

docker exec watchtower-influxdb influx task create \
    --org "$INFLUX_ORG" \
    --token "$INFLUX_TOKEN" \
    --flux "$HOURLY_TASK" 2>/dev/null || warn "Hourly task may already exist"

# Daily aggregation task
DAILY_TASK='option task = {name: "downsample_daily", every: 1d, offset: 10m}

from(bucket: "watchtower_hourly")
  |> range(start: -task.every)
  |> filter(fn: (r) => r["_measurement"] == "device_metrics" or r["_measurement"] == "interface_metrics" or r["_measurement"] == "network_summary" or r["_measurement"] == "speedtest_results")
  |> aggregateWindow(every: 1d, fn: mean, createEmpty: false)
  |> to(bucket: "watchtower_daily", org: "'"$INFLUX_ORG"'")'

docker exec watchtower-influxdb influx task create \
    --org "$INFLUX_ORG" \
    --token "$INFLUX_TOKEN" \
    --flux "$DAILY_TASK" 2>/dev/null || warn "Daily task may already exist"

# 4. Print config snippet
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗"
echo -e "║    SETUP COMPLETE                    ║"
echo -e "╚══════════════════════════════════════╝${NC}"
echo ""
echo "Add to your config/config.yaml:"
echo ""
echo -e "${GREEN}influxdb:"
echo "  url: \"$INFLUX_URL\""
echo "  token: \"$INFLUX_TOKEN\""
echo "  org: \"$INFLUX_ORG\""
echo "  bucket: \"$INFLUX_BUCKET\""
echo -e "  enabled: true${NC}"
echo ""
echo "InfluxDB UI: $INFLUX_URL (admin / watchtower-admin)"
echo ""
