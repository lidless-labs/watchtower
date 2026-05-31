"""System diagnostics endpoint coverage."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app import config as config_module
from app.auth import create_token
from app.main import app as watchtower_app

TEST_JWT_SECRET = "diagnostics-system-test-secret-32-bytes"


def _make_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _admin_headers() -> dict[str, str]:
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = create_token({"username": "admin", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


async def test_system_diagnostics_reports_redacted_runtime_state(wired_redis_cache, tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("auth:\n  jwt_secret: diagnostics-system-test-secret-32-bytes\n", encoding="utf-8")
    config_path.chmod(0o600)
    monkeypatch.setattr(config_module.settings, "config_path", str(config_path))

    async with _make_client(watchtower_app) as client:
        response = await client.get("/api/diagnostics/system", headers=_admin_headers())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checks"]["redis"]["ok"] is True
    assert body["checks"]["config_file"]["mode"] == "0o600"
    assert "jwt_secret" not in str(body)


async def test_system_diagnostics_requires_admin():
    async with _make_client(watchtower_app) as client:
        response = await client.get("/api/diagnostics/system")

    assert response.status_code == 401
