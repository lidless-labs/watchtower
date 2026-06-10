# Watchtower Agent Instructions

NOC dashboard (React 18 + TypeScript + Vite frontend, FastAPI + Python 3.12 backend) that talks to live monitoring infrastructure: LibreNMS, Proxmox, InfluxDB, Redis. Treat every script and endpoint as potentially touching production.

## Definition of Done

Before reporting any change complete, ALL of these must pass:

```bash
cd backend && ruff check app tests && pytest -q
cd frontend && npm run lint && npm run test -- --run && npm run build
```

Backend changes require the backend line; frontend changes require the frontend line; cross-cutting changes require both. Report actual command output, not paraphrase. If anything fails, report the failure verbatim and do not claim success. Tests marked `integration` self-skip when external services are unreachable; a skip is not a failure, but never add a skip to dodge one.

## Rules

- Before citing any command, endpoint, config key, or API behavior: read the source first (`backend/app/`, `frontend/src/`, `scripts/`, `docs/release.md`). If you cannot verify it in the repo, say so instead of stating it.
- When a test or lint gate fails: fix the root cause or report the failure. Never delete, weaken, `xfail`, skip, or loosen an assertion to get green.
- When blocked by sandboxing, missing tools, network, or auth: stop and report the exact blocker (command + error). Do not work around it silently.
- When editing auth, settings, or websocket code: run the relevant test files (`backend/tests/test_auth.py`, `test_authz.py`, `test_route_authz.py`, `test_websocket_*.py`) before the full suite to fail fast.
- When adding a route: protect it with `require_admin`, `require_operator`, or `require_viewer` from `backend/app/auth.py`. No unauthenticated routes except existing health/ready/login/bootstrap paths.
- When touching `.gitignore` or committed files: never commit `CLAUDE.md`, `.claude/`, `.env*`, config with real hostnames, or anything else the ignore file excludes.

## Prohibitions

- Never push. Pushing is the owner's call, made explicitly per session.
- Never use `git push --no-verify`. The `hooks/pre-push` content-guard hook scans for leaks against `policies/public-repo.json`; bypassing it can publish secrets. If it blocks, fix the leak or use an inline `<!-- content-guard: allow <rule-id> -->` tag only with the owner's approval.
- Never invent CLI flags, npm scripts, or pytest options. Check `frontend/package.json`, `backend/pytest.ini`, and the script's `--help`/source first.
- Never hardcode secrets, tokens, or real infrastructure hostnames in code, tests, or docs.

## Live Infrastructure Safety

These scripts touch a live install. Do not run them against live unless the user explicitly asks in this session:

- `scripts/smoke-live.sh`: hits a running service (`/health`, auth, admin diagnostics, websocket); `--write-settings` performs a real settings write.
- `scripts/update.sh`: pulls code, rebuilds, restarts services on the host.
- `scripts/restore.sh`: overwrites live config and state from a backup.
- `scripts/backup.sh`, `scripts/setup-influxdb.sh`: read/provision live state.

For backend testing, use the unit suite (fakeredis doubles are wired in; `fakeredis[lua]` is required for ratelimit EVAL scripts). Never point tests, curl, or ad hoc scripts at the production LibreNMS, Proxmox, InfluxDB, or Redis instances.

## Auth Conventions (backend/app/auth.py)

- Browser auth: HttpOnly `watchtower_session` cookie (samesite=strict, secure mirrors request scheme). API clients use `Authorization: Bearer`; the header takes precedence over the cookie.
- Tokens: HS256 JWT signed with `config.auth.jwt_secret`, carrying `sub`, `role`, `iat`, `exp`, and `ver`. A `ver` mismatch with `config.auth.token_version` returns 401, so bumping `token_version` invalidates all tokens. Preserve this on any auth change.
- Passwords: bcrypt only, via `hash_password`/`verify_password`. Never log or echo passwords, hashes, JWTs, or `jwt_secret`.
- Roles: admin > operator > viewer via `require_role`; roles outside the enum get 403, never a silent grant. Keep that fail-closed behavior.
- `jwt_secret` defaults to a placeholder and is length-validated for production. Never commit a real secret or weaken `validate_jwt_secret_for_runtime`.

## Memory Handoff

At the end of any substantial task, write a handoff note to `.claude/memory-handoffs/` using that directory's `TEMPLATE.md`. Record durable discoveries, gotchas, and decisions made. Do not wait to be reminded.
