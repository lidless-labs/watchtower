"""Tests for settings status reporting."""

from __future__ import annotations

import pytest
import yaml
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


pytestmark = pytest.mark.asyncio


async def test_settings_status_reports_partial_librenms_config(
    wired_redis_cache,
    monkeypatch,
    tmp_path,
):
    """A URL without credentials should be reported as status data, not a 400."""
    from app import config as config_module
    from app.auth import UserRole, create_token
    from app.routers import settings

    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text(
        yaml.safe_dump({"data_sources": {"librenms": {"url": "http://librenms.local"}}}),
        encoding="utf-8",
    )
    monkeypatch.setenv("CONFIG_PATH", str(cfg_path))

    config_module.config.auth.jwt_secret = "settings-status-secret-minimum-32-bytes"
    token = create_token({"username": "admin", "role": UserRole.ADMIN.value})

    application = FastAPI()
    application.include_router(settings.router, prefix="/api")

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/settings/status",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["librenms"]["configured"] is True
    assert data["librenms"]["connected"] is False
    assert data["librenms"]["error"] == "url and api_key are required"
