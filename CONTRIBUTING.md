# Contributing to Watchtower

Watchtower is a self-hosted NOC dashboard for homelab and small-network operators. It is a work in progress, and patches are welcome. Before you start, please skim this file so we both spend our time on the right things.

## What kinds of changes land easily

- **Bug fixes** in the API routers, polling jobs, integration clients (LibreNMS, Proxmox, Netdisco), or the React frontend.
- **Integration robustness**: better handling of timeouts, partial responses, and version differences from LibreNMS or Proxmox.
- **Frontend polish**: clearer status views, topology rendering, accessibility, responsive layout.
- **Docs**: setup steps, configuration reference, deployment notes.
- **Test coverage** for any of the above.

## What needs a conversation first

- **A new integration or data source.** Open an issue describing the user story first. Each integration is a long-term maintenance surface.
- **Changes to the config schema** (`config/config.example.yaml`) or the WebSocket message format. These break existing deployments, so they need a heads-up and a migration note.
- **New runtime dependencies.** Both halves keep their dependency lists lean on purpose; justify additions.

## What does not land

- Real hostnames, IPs, device names, account IDs, tokens, or live credentials in code, config examples, tests, or screenshots. This is a homelab project and the whole point is to keep that out of a public repo. Use `192.0.2.x` (RFC 5737) and generic names like `librenms.example.internal`.
- Commits with AI co-authorship trailers (`Co-Authored-By: <model>`). Conventional commits only.

## Local dev

```bash
git clone https://github.com/solomonneas/watchtower.git
cd watchtower

# backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

# frontend
cd ../frontend
npm install
```

Bring up Redis and InfluxDB with `docker compose up -d` (set the InfluxDB password and token in `.env` first; see `.env.example`). Run the backend with `uvicorn app.main:app --reload` and the frontend with `npm run dev`.

## Before you push

Run the single verification gate from the repo root:

```bash
./scripts/verify
```

It runs `ruff check app tests`, `pytest -q`, then the frontend `npm run lint`, `npm run test -- --run`, and `npm run build`. CI runs the same checks plus Playwright browser smoke tests and a `pip-audit` / `npm audit` pass, so green locally usually means green in CI.

The backend tests use `fakeredis`, so you do not need a live Redis to run `pytest`.

## A pre-push content-guard hook ships with the repo

`hooks/pre-push` scans the working tree for leaked secrets, personal paths, and real hostnames before a push leaves your machine, using [content-guard](https://github.com/solomonneas/content-guard). If a push is blocked, fix the leak rather than bypassing the hook. Enable it once with:

```bash
git config core.hooksPath hooks
```

## Filing issues

Please use the templates under `.github/ISSUE_TEMPLATE/`. Before posting logs or config, remove tokens, real hostnames, real device IPs, and unredacted absolute paths.

## License

By contributing you agree that your contribution is licensed under the MIT License, same as the rest of the repo.
