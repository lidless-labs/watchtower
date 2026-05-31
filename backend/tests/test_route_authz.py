"""Route-level authz coverage for the real FastAPI app wiring."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app import config as config_module
from app.auth import create_token
from app.main import app as watchtower_app

TEST_JWT_SECRET = "route-authz-test-secret-32-bytes"


def _make_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _headers(role: str) -> dict[str, str]:
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = create_token({"username": f"user-{role}", "role": role})
    return {"Authorization": f"Bearer {token}"}


async def test_read_routes_require_authentication():
    async with _make_client(watchtower_app) as client:
        response = await client.get("/api/devices")

    assert response.status_code == 401


async def test_settings_routes_reject_viewer():
    async with _make_client(watchtower_app) as client:
        response = await client.get("/api/settings", headers=_headers("viewer"))

    assert response.status_code == 403


async def test_diagnostics_routes_reject_viewer():
    async with _make_client(watchtower_app) as client:
        response = await client.post("/api/diagnostics/poll/now", headers=_headers("viewer"))

    assert response.status_code == 403


async def test_operator_mutation_routes_reject_viewer():
    async with _make_client(watchtower_app) as client:
        alert_response = await client.post("/api/alert/1/acknowledge", headers=_headers("viewer"))
        speedtest_response = await client.post("/api/speedtest/trigger", headers=_headers("viewer"))

    assert alert_response.status_code == 403
    assert speedtest_response.status_code == 403


async def test_admin_notification_test_route_rejects_operator():
    async with _make_client(watchtower_app) as client:
        response = await client.post("/api/notifications/test/email", headers=_headers("operator"))

    assert response.status_code == 403
