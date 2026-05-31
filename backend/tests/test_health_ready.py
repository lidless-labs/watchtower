"""Health and readiness endpoint tests."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app import config as config_module
from app.main import app as watchtower_app

TEST_JWT_SECRET = "ready-test-jwt-secret-32-bytes-ok"


def _make_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_health_is_liveness_without_dependency_checks():
    async with _make_client(watchtower_app) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


async def test_ready_reports_dependency_success(wired_redis_cache):
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.settings.dev_mode = False

    async with _make_client(watchtower_app) as client:
        response = await client.get("/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["redis"]["ok"] is True
    assert body["checks"]["jwt_secret"]["ok"] is True


async def test_ready_reports_weak_jwt_secret_in_production(wired_redis_cache):
    config_module.config.auth.jwt_secret = "short-secret"
    config_module.settings.dev_mode = False

    async with _make_client(watchtower_app) as client:
        response = await client.get("/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["jwt_secret"]["ok"] is False
