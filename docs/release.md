# Release Checklist

Use tags for production installs so `WATCHTOWER_REPO_REF` can point at an immutable release instead of `main`.

## Versioning

Use tags shaped like `v1.2.3`.

- Patch: bug fixes, security fixes, docs, operational scripts.
- Minor: new user-visible features or compatible API additions.
- Major: breaking install, API, config, or data changes.

## Preflight

Run:

```bash
cd backend && python -m pip install -r requirements.txt -r requirements-dev.txt
ruff check app tests && pytest -q
cd ../frontend && npm ci && npm run lint && npm run test -- --run && npm run build
```

For production-impacting changes, run a fresh install smoke using `WATCHTOWER_SOURCE_DIR` on a disposable host or CT.

## Tag

```bash
git tag -a v1.2.3 -m "v1.2.3"
git push origin v1.2.3
```

The `Release` workflow validates the tag and uploads a source archive plus SHA-256 checksum as workflow artifacts.

## Install A Tagged Release

```bash
WATCHTOWER_REPO_REF=v1.2.3 bash install/install.sh
```

After install or upgrade, run:

```bash
scripts/smoke-live.sh --base-url http://127.0.0.1:8000 --token "$WATCHTOWER_TOKEN"
```

If first-login bootstrap is still pending:

```bash
scripts/smoke-live.sh \
  --base-url http://127.0.0.1:8000 \
  --username admin \
  --password 'set-a-new-admin-password' \
  --bootstrap-token "$WATCHTOWER_BOOTSTRAP_TOKEN" \
  --write-settings
```
