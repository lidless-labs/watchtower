"""Interactive docs and the OpenAPI schema must not be exposed in production.

The default settings.dev_mode is False, so the app imported here is built in
its production configuration. Swagger/ReDoc/openapi.json map every route for an
unauthenticated caller, so they must 404 unless dev_mode is on.
"""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient

from app import config as config_module
from app.main import app as watchtower_app


def _make_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=watchtower_app), base_url="http://test")


def test_dev_mode_default_is_production():
    # Guards the assumption the rest of this module relies on.
    assert config_module.settings.dev_mode is False


async def test_openapi_schema_not_exposed_in_production():
    async with _make_client() as client:
        response = await client.get("/openapi.json")
    assert response.status_code == 404


async def test_swagger_docs_not_exposed_in_production():
    async with _make_client() as client:
        response = await client.get("/docs")
    assert response.status_code == 404


async def test_redoc_not_exposed_in_production():
    async with _make_client() as client:
        response = await client.get("/redoc")
    assert response.status_code == 404
