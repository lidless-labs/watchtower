# Production Hardening

This checklist captures the deployment assumptions that the installer and runtime enforce.

## Install Source

By default, `install/install.sh` installs from `https://github.com/solomonneas/watchtower.git` at `main`.

Supported overrides:

- `WATCHTOWER_REPO_URL`: Git remote to fetch.
- `WATCHTOWER_REPO_REF`: branch, tag, or ref to fetch. Defaults to `main`.
- `WATCHTOWER_SOURCE_DIR`: local source directory to copy into `/opt/watchtower`. This is intended for smoke tests and controlled offline installs.

Example:

```bash
WATCHTOWER_SOURCE_DIR=/tmp/watchtower-src bash /tmp/watchtower-src/install/install.sh
```

## First Login

Production first-login bootstrap requires `WATCHTOWER_BOOTSTRAP_TOKEN`. The installer creates `/etc/watchtower/bootstrap.env` with mode `0600` and wires it into `watchtower.service`.

Use the printed first-login URL once, set a strong admin password, then treat the bootstrap token as spent operationally. The backend only honors bootstrap while no admin password hash exists.

## Secrets And Config

- Keep `/opt/watchtower/config/config.yaml` mode `0600`.
- Replace placeholder JWT secrets before production use, or let first startup generate and persist a random secret.
- Rotating the admin password increments the token version and invalidates existing sessions.
- Do not put integration API keys in logs, tickets, screenshots, or shell history.

## Service Boundary

The installer binds Uvicorn to `127.0.0.1:8000` and exposes the app through nginx on port 80. The systemd service uses `NoNewPrivileges=true`, `ProtectSystem=strict`, and explicit write paths for config and runtime data.

Keep Redis local unless you intentionally move it. If Redis is remote, set `REDIS_URL` through a systemd drop-in and validate `/ready`.

## Validation Commands

Run these after install or upgrade:

```bash
systemctl status watchtower --no-pager
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/ready
journalctl -u watchtower -n 100 --no-pager
```

After logging in as admin, check `/api/diagnostics/system` for Redis, config file, scheduler, and runtime details. The endpoint is admin-only and redacts secrets.

## Upgrade Flow

1. Back up `/opt/watchtower/config/config.yaml`.
2. Run the installer with the target `WATCHTOWER_REPO_REF` or source directory.
3. Confirm `/health`, `/ready`, and `/api/diagnostics/system`.
4. Review `journalctl -u watchtower -n 100 --no-pager` before leaving the host.
