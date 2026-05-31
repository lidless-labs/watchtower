#!/usr/bin/env bash
#
# Live smoke test for an installed Watchtower service.
#
set -euo pipefail

BASE_URL="${WATCHTOWER_BASE_URL:-http://127.0.0.1:8000}"
TOKEN="${WATCHTOWER_TOKEN:-}"
USERNAME="${WATCHTOWER_USERNAME:-admin}"
PASSWORD="${WATCHTOWER_PASSWORD:-}"
BOOTSTRAP_TOKEN="${WATCHTOWER_BOOTSTRAP_TOKEN:-}"
WRITE_SETTINGS=false
PYTHON_BIN="${WATCHTOWER_PYTHON:-/opt/watchtower/backend/venv/bin/python}"

usage() {
    cat <<USAGE
Usage: $0 [--base-url URL] [--token TOKEN]
       $0 [--base-url URL] --username USER --password PASS [--bootstrap-token TOKEN] [--write-settings]

Checks /health, /ready, authenticated /api/auth/me, admin diagnostics, and
WebSocket ping/pong. --write-settings also verifies an authenticated settings
write by patching polling.device_status to its current value.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --base-url)
            BASE_URL="${2:-}"
            shift 2
            ;;
        --token)
            TOKEN="${2:-}"
            shift 2
            ;;
        --username)
            USERNAME="${2:-}"
            shift 2
            ;;
        --password)
            PASSWORD="${2:-}"
            shift 2
            ;;
        --bootstrap-token)
            BOOTSTRAP_TOKEN="${2:-}"
            shift 2
            ;;
        --write-settings)
            WRITE_SETTINGS=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

BASE_URL="${BASE_URL%/}"
if [[ ! -x "$PYTHON_BIN" ]]; then
    PYTHON_BIN="$(command -v python3 || true)"
fi
if [[ -z "$PYTHON_BIN" ]]; then
    echo "Python is required for JSON parsing and WebSocket smoke." >&2
    exit 1
fi

json_get() {
    "$PYTHON_BIN" -c 'import json,sys; data=json.load(sys.stdin); print(data["'"$1"'"])'
}

log() {
    printf '[SMOKE] %s\n' "$1"
}

auth_header=(-H "Authorization: Bearer $TOKEN")

log "Checking liveness"
curl -fsS "$BASE_URL/health" >/dev/null

log "Checking readiness"
curl -fsS "$BASE_URL/ready" >/dev/null

if [[ -z "$TOKEN" ]]; then
    if [[ -z "$PASSWORD" ]]; then
        echo "Provide --token or --password." >&2
        exit 2
    fi

    headers=(-H "Content-Type: application/json")
    if [[ -n "$BOOTSTRAP_TOKEN" ]]; then
        headers+=(-H "X-Watchtower-Bootstrap-Token: $BOOTSTRAP_TOKEN")
    fi

    log "Logging in"
    login_body=$(WT_USER="$USERNAME" WT_PASS="$PASSWORD" "$PYTHON_BIN" -c 'import json,os; print(json.dumps({"username": os.environ["WT_USER"], "password": os.environ["WT_PASS"]}))')
    login_json=$(curl -fsS -X POST "$BASE_URL/api/auth/login" "${headers[@]}" --data "$login_body")
    TOKEN=$(printf '%s' "$login_json" | json_get token)
    auth_header=(-H "Authorization: Bearer $TOKEN")
fi

log "Checking authenticated user"
curl -fsS "$BASE_URL/api/auth/me" "${auth_header[@]}" | "$PYTHON_BIN" -c 'import json,sys; data=json.load(sys.stdin); assert data["role"] == "admin", data'

log "Checking diagnostics"
curl -fsS "$BASE_URL/api/diagnostics/system" "${auth_header[@]}" | "$PYTHON_BIN" -c 'import json,sys; data=json.load(sys.stdin); assert data["checks"]["redis"]["ok"] is True, data'

if [[ "$WRITE_SETTINGS" == "true" ]]; then
    log "Checking settings write"
    current=$(curl -fsS "$BASE_URL/api/settings" "${auth_header[@]}" | "$PYTHON_BIN" -c 'import json,sys; data=json.load(sys.stdin); print(data.get("polling", {}).get("device_status", 30))')
    body=$(WT_DEVICE_STATUS="$current" "$PYTHON_BIN" -c 'import json,os; print(json.dumps({"device_status": int(os.environ["WT_DEVICE_STATUS"])}))')
    curl -fsS -X PATCH "$BASE_URL/api/settings/polling" "${auth_header[@]}" -H "Content-Type: application/json" --data "$body" >/dev/null
fi

log "Checking WebSocket"
WT_BASE_URL="$BASE_URL" WT_TOKEN="$TOKEN" "$PYTHON_BIN" <<'PY'
import asyncio
import json
import os
from urllib.parse import urlparse, urlunparse

import websockets


async def main():
    base = os.environ["WT_BASE_URL"]
    parsed = urlparse(base)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    ws_url = urlunparse((scheme, parsed.netloc, "/ws/updates", "", f"token={os.environ['WT_TOKEN']}", ""))
    async with websockets.connect(ws_url) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert first["type"] == "connected", first
        await ws.send(json.dumps({"type": "ping"}))
        pong = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert pong["type"] == "pong", pong


asyncio.run(main())
PY

log "Live smoke passed"
