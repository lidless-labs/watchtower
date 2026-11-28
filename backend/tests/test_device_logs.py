from __future__ import annotations

from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app import config as config_module
from app.auth import create_token
from app.cache import redis_cache
from app.models.device import Device
from app.polling import librenms
from app.polling.scheduler import CACHE_DEVICES
from app.routers import devices as devices_module

TEST_JWT_SECRET = "device-logs-test-secret-32-bytes-long"


def _headers(role: str = "viewer") -> dict[str, str]:
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = create_token({"username": "logs-test", "role": role})
    return {"Authorization": f"Bearer {token}"}


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(devices_module.router, prefix="/api")
    return app


def _mock_librenms(monkeypatch, handler):
    real_async_client = httpx.AsyncClient
    mock_transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        librenms,
        "get_settings",
        lambda: SimpleNamespace(
            librenms_url="http://librenms.example.com",
            librenms_api_key="fixture-api-token",
        ),
    )
    monkeypatch.setattr(
        librenms.httpx,
        "AsyncClient",
        lambda **kwargs: real_async_client(transport=mock_transport, **kwargs),
    )


def _device() -> Device:
    return Device(id="fixture-router", display_name="Fixture Router", librenms_device_id=7)


async def _known_device(_device_id: str):
    return _device()


async def _unknown_device(_device_id: str):
    return None


async def test_device_logs_use_librenms_and_cache_results(wired_redis_cache, monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "status": "ok",
                "logs": [
                    {
                        "datetime": "2026-11-28 12:34:56",
                        "type": "interface",
                        "severity": "3",
                        "message": "Interface state changed",
                    }
                ],
            },
        )

    await redis_cache.set(
        CACHE_DEVICES,
        [{"device_id": 7, "hostname": "router/edge.example.com"}],
    )
    monkeypatch.setattr(devices_module, "get_device_with_live_data", _known_device)
    _mock_librenms(monkeypatch, handler)

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get(
            "/api/device/fixture-router/logs",
            params={
                "kind": "syslog",
                "limit": 200,
                "start": 2,
                "from": "2026-11-28 12:00:00",
                "to": "2026-11-28 13:00:00",
            },
            headers=_headers(),
        )
        cached_response = await client.get(
            "/api/device/fixture-router/logs",
            params={
                "kind": "syslog",
                "limit": 200,
                "start": 2,
                "from": "2026-11-28 12:00:00",
                "to": "2026-11-28 13:00:00",
            },
            headers=_headers(),
        )

    assert response.status_code == 200
    assert response.json() == [
        {
            "timestamp": "2026-11-28 12:34:56",
            "type": "interface",
            "severity": "3",
            "message": "Interface state changed",
        }
    ]
    assert cached_response.json() == response.json()
    assert len(requests) == 1
    assert requests[0].method == "GET"
    assert b"/api/v0/logs/syslog/router%2Fedge.example.com" in requests[0].url.raw_path
    assert dict(requests[0].url.params) == {
        "limit": "200",
        "start": "2",
        "from": "2026-11-28 12:00:00",
        "to": "2026-11-28 13:00:00",
    }
    cache_keys = [
        key async for key in wired_redis_cache.scan_iter("watchtower:device_logs:*")
    ]
    assert len(cache_keys) == 1
    assert await wired_redis_cache.ttl(cache_keys[0]) > 0


async def test_device_logs_reject_invalid_kind(wired_redis_cache):
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get(
            "/api/device/fixture-router/logs?kind=authlog",
            headers=_headers(),
        )

    assert response.status_code == 422


async def test_device_logs_return_404_for_unknown_device(wired_redis_cache, monkeypatch):
    monkeypatch.setattr(devices_module, "get_device_with_live_data", _unknown_device)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get("/api/device/missing/logs", headers=_headers())

    assert response.status_code == 404


async def test_device_logs_return_short_502_when_librenms_is_unreachable(
    wired_redis_cache, monkeypatch
):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("fixture connection failure", request=request)

    await redis_cache.set(CACHE_DEVICES, [{"device_id": 7, "hostname": "router.example.com"}])
    monkeypatch.setattr(devices_module, "get_device_with_live_data", _known_device)
    _mock_librenms(monkeypatch, handler)

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get("/api/device/fixture-router/logs", headers=_headers())

    assert response.status_code == 502
    assert response.json() == {"detail": "LibreNMS logs are currently unavailable"}
    assert "Traceback" not in response.text
