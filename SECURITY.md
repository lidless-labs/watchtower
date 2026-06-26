# Security Policy

## Supported versions

Watchtower is a work in progress. Only the latest commit on the `main` branch receives security fixes. There are no published releases to pin to yet; track `main` if you deploy it.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems. Email **me@solomonneas.dev** with: <!-- content-guard: allow pii/email -->

- A short description of the issue.
- Steps to reproduce (or a minimal proof of concept).
- The commit you tested against.
- Whether you would like to be credited in the release notes.

You should get an acknowledgment within 72 hours. If you do not, please follow up; the mail may have been filtered.

## In scope

- Authentication or authorization flaws in the FastAPI backend (JWT handling, role checks, session expiry).
- Injection, path traversal, or SSRF in the API routers, the polling jobs, or the integration clients (LibreNMS, Proxmox, Netdisco).
- Credentials, tokens, or webhook secrets leaking from `config/config.yaml` into logs, API responses, or the frontend bundle.
- WebSocket endpoints (`/ws/updates`) that bypass authentication or leak data across sessions.
- Cross-site scripting or CSRF in the React frontend.

## Deployment is the operator's responsibility

Watchtower reads live credentials for LibreNMS, Proxmox, and notification channels from `config/config.yaml`. That file is not committed and is yours to protect.

- Keep `config/config.yaml`, `.env`, and any backups (`./scripts/backup.sh` output) off public storage. They contain API keys and tokens.
- The bundled `docker-compose.yml` binds Redis and InfluxDB to the loopback interface only. Do not expose those ports to a network you do not trust.
- Set a real `jwt_secret` and a strong admin password before exposing the dashboard. The shipped placeholder is not a credential.
- `verify_ssl: false` on the Proxmox integration is for self-signed homelab certs. Prefer a valid cert where you can.

## Out of scope

- Issues that require an attacker to already have shell access, the contents of `config/config.yaml`, or write access to the deployment host.
- Bugs in LibreNMS, Proxmox, InfluxDB, or Redis; report those to their respective projects.
- A deployment exposed to the public internet without authentication in front of it. Watchtower assumes it sits on a trusted network or behind a reverse proxy you control.

## Disclosure

We aim to ship a fix within 14 days of confirming a valid report. A coordinated disclosure timeline can be negotiated for issues that need longer.
