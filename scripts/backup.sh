#!/usr/bin/env bash
#
# Create a Watchtower operations backup.
#
# Includes:
# - /opt/watchtower/config/config.yaml
# - /opt/watchtower/config/topology.yaml, if present
# - /etc/watchtower/bootstrap.env, if present
# - /var/lib/watchtower, if present
# - /opt/watchtower/data, if present
#
set -euo pipefail

APP_DIR="${WATCHTOWER_APP_DIR:-/opt/watchtower}"
ETC_DIR="${WATCHTOWER_ETC_DIR:-/etc/watchtower}"
STATE_DIR="${WATCHTOWER_STATE_DIR:-/var/lib/watchtower}"
BACKUP_DIR="${WATCHTOWER_BACKUP_DIR:-/var/backups/watchtower}"

usage() {
    cat <<USAGE
Usage: $0 [--output PATH]

Environment overrides:
  WATCHTOWER_APP_DIR      Default: /opt/watchtower
  WATCHTOWER_ETC_DIR      Default: /etc/watchtower
  WATCHTOWER_STATE_DIR    Default: /var/lib/watchtower
  WATCHTOWER_BACKUP_DIR   Default: /var/backups/watchtower
USAGE
}

OUTPUT=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --output)
            OUTPUT="${2:-}"
            shift 2
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

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "$OUTPUT" ]]; then
    mkdir -p "$BACKUP_DIR"
    OUTPUT="$BACKUP_DIR/watchtower-backup-$timestamp.tar.gz"
else
    mkdir -p "$(dirname "$OUTPUT")"
fi

tmpdir="$(mktemp -d)"
cleanup() {
    rm -rf "$tmpdir"
}
trap cleanup EXIT

copy_if_present() {
    local src="$1"
    local dest="$2"
    if [[ -e "$src" ]]; then
        mkdir -p "$(dirname "$tmpdir/$dest")"
        cp -a "$src" "$tmpdir/$dest"
    fi
}

copy_if_present "$APP_DIR/config/config.yaml" "opt/watchtower/config/config.yaml"
copy_if_present "$APP_DIR/config/topology.yaml" "opt/watchtower/config/topology.yaml"
copy_if_present "$APP_DIR/data" "opt/watchtower/data"
copy_if_present "$ETC_DIR/bootstrap.env" "etc/watchtower/bootstrap.env"
copy_if_present "$STATE_DIR" "var/lib/watchtower"

cat > "$tmpdir/MANIFEST.txt" <<MANIFEST
watchtower_backup_created=$timestamp
app_dir=$APP_DIR
etc_dir=$ETC_DIR
state_dir=$STATE_DIR
MANIFEST

tar -C "$tmpdir" -czf "$OUTPUT" .
chmod 600 "$OUTPUT"

echo "Backup written: $OUTPUT"
echo "Contents:"
tar -tzf "$OUTPUT" | sed 's#^\./#  #'
