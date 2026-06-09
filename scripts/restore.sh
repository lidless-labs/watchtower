#!/usr/bin/env bash
#
# Restore a Watchtower operations backup created by scripts/backup.sh.
#
set -euo pipefail

APP_DIR="${WATCHTOWER_APP_DIR:-/opt/watchtower}"
ETC_DIR="${WATCHTOWER_ETC_DIR:-/etc/watchtower}"
STATE_DIR="${WATCHTOWER_STATE_DIR:-/var/lib/watchtower}"
PRE_RESTORE_DIR="${WATCHTOWER_BACKUP_DIR:-/var/backups/watchtower}"
FORCE=false
ARCHIVE=""

usage() {
    cat <<USAGE
Usage: $0 --archive PATH [--force]

Restores config, bootstrap token, and runtime CSV/state data. Without --force,
the script prints the archive contents and exits before writing files.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --archive)
            ARCHIVE="${2:-}"
            shift 2
            ;;
        --force)
            FORCE=true
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

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
    echo "A valid --archive path is required." >&2
    usage >&2
    exit 2
fi

echo "Archive contents:"
tar -tzf "$ARCHIVE" | sed 's#^\./#  #'

if [[ "$FORCE" != "true" ]]; then
    echo ""
    echo "Dry run only. Re-run with --force to restore these files."
    exit 0
fi

if [[ $EUID -ne 0 ]]; then
    echo "Restore must run as root so file owners and modes can be preserved." >&2
    exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$PRE_RESTORE_DIR"
"$(dirname "$0")/backup.sh" --output "$PRE_RESTORE_DIR/pre-restore-$timestamp.tar.gz" >/dev/null

tmpdir="$(mktemp -d)"
cleanup() {
    rm -rf "$tmpdir"
}
trap cleanup EXIT

tar -C "$tmpdir" -xzf "$ARCHIVE"

# Stop the service before swapping config/state out from under it so a
# concurrent settings write cannot corrupt the restored files.
service_was_running=false
if systemctl is-active --quiet watchtower 2>/dev/null; then
    service_was_running=true
    systemctl stop watchtower
fi

restore_path() {
    local src="$1"
    local dest="$2"
    if [[ -e "$tmpdir/$src" ]]; then
        mkdir -p "$(dirname "$dest")"
        if [[ -d "$tmpdir/$src" ]]; then
            rm -rf "$dest"
        fi
        cp -a "$tmpdir/$src" "$dest"
    fi
}

restore_path "opt/watchtower/config/config.yaml" "$APP_DIR/config/config.yaml"
restore_path "opt/watchtower/config/topology.yaml" "$APP_DIR/config/topology.yaml"
restore_path "opt/watchtower/data" "$APP_DIR/data"
restore_path "etc/watchtower/bootstrap.env" "$ETC_DIR/bootstrap.env"
restore_path "var/lib/watchtower" "$STATE_DIR"

if id watchtower >/dev/null 2>&1; then
    chown -R watchtower:watchtower "$APP_DIR/config" "$APP_DIR/data" "$STATE_DIR" 2>/dev/null || true
fi
chmod 600 "$APP_DIR/config/config.yaml" 2>/dev/null || true
chmod 600 "$ETC_DIR/bootstrap.env" 2>/dev/null || true

if [[ "$service_was_running" == "true" ]]; then
    systemctl start watchtower
elif systemctl list-unit-files watchtower.service >/dev/null 2>&1; then
    systemctl restart watchtower
fi

echo "Restore complete. Pre-restore backup written under $PRE_RESTORE_DIR."
