# Backup And Restore

Use `scripts/backup.sh` before upgrades and before large settings changes.

The backup archive contains:

- `/opt/watchtower/config/config.yaml`
- `/opt/watchtower/config/topology.yaml`, if present
- `/etc/watchtower/bootstrap.env`, if present
- `/var/lib/watchtower`, if present
- `/opt/watchtower/data`, if present

## Backup

```bash
sudo scripts/backup.sh
```

To choose a path:

```bash
sudo scripts/backup.sh --output /var/backups/watchtower/watchtower-before-upgrade.tar.gz
```

Archives are written with mode `0600` because they may contain secrets.

## Restore

Always inspect first:

```bash
sudo scripts/restore.sh --archive /var/backups/watchtower/watchtower-before-upgrade.tar.gz
```

Then restore:

```bash
sudo scripts/restore.sh --archive /var/backups/watchtower/watchtower-before-upgrade.tar.gz --force
```

The restore script creates a pre-restore backup under `/var/backups/watchtower` before writing files, preserves file metadata from the archive, fixes expected Watchtower ownership where possible, and restarts `watchtower.service` when systemd knows about it.

## Override Paths

For non-standard installs:

```bash
WATCHTOWER_APP_DIR=/opt/watchtower \
WATCHTOWER_ETC_DIR=/etc/watchtower \
WATCHTOWER_STATE_DIR=/var/lib/watchtower \
WATCHTOWER_BACKUP_DIR=/var/backups/watchtower \
sudo -E scripts/backup.sh
```
