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
from app.polling.librenms import LibreNMSClient
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


async def test_librenms_client_normalizes_each_log_kind(monkeypatch):
    fixtures = {
        "eventlog": {
            "datetime": "2026-11-28 12:34:56",
            "type": "interface",
            "severity": "3",
            "message": "Ethernet1/1 changed state to down",
        },
        "syslog": {
            "timestamp": "2026-11-28 12:35:10",
            "program": "LINK-STATE",
            "msg": "Ethernet1/1 changed state to up",
            "level": "5",
            "priority": "189",
            "facility": "local7",
            "tag": "router",
        },
        "alertlog": {
            "time_logged": "2026-11-28 12:36:22",
            "state": 1,
            "details": "CPU threshold exceeded",
            "rule_id": 42,
        },
    }
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        kind = request.url.path.split("/")[4]
        return httpx.Response(200, json={"status": "ok", "logs": [fixtures[kind]]})

    _mock_librenms(monkeypatch, handler)
    async with LibreNMSClient() as client:
        normalized = {
            kind: await client.get_device_logs("router.example.com", kind)
            for kind in fixtures
        }

    assert normalized["eventlog"][0].model_dump() == {
        "timestamp": "2026-11-28 12:34:56",
        "type": "interface",
        "severity": "3",
        "message": "Ethernet1/1 changed state to down",
    }
    assert normalized["syslog"][0].model_dump() == {
        "timestamp": "2026-11-28 12:35:10",
        "type": "LINK-STATE",
        "severity": "5",
        "message": "Ethernet1/1 changed state to up",
    }
    assert normalized["alertlog"][0].model_dump() == {
        "timestamp": "2026-11-28 12:36:22",
        "type": None,
        "severity": "1",
        "message": "Rule 42: alert - CPU threshold exceeded",
    }
    assert len(requests) == 3
    assert all(request.method == "GET" for request in requests)


async def test_device_logs_use_descending_order_and_cache_results(
    wired_redis_cache, monkeypatch
):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "status": "ok",
                "logs": [
                    {
                        "timestamp": "2026-11-28 12:34:56",
                        "program": "LINK-STATE",
                        "msg": "Ethernet1/1 changed state to down",
                        "level": "5",
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
        params = {"kind": "syslog", "limit": 200, "start": 2}
        response = await client.get(
            "/api/device/fixture-router/logs", params=params, headers=_headers()
        )
        cached_response = await client.get(
            "/api/device/fixture-router/logs", params=params, headers=_headers()
        )

    assert response.status_code == 200
    assert response.json() == [
        {
            "timestamp": "2026-11-28 12:34:56",
            "type": "LINK-STATE",
            "severity": "5",
            "message": "Ethernet1/1 changed state to down",
        }
    ]
    assert cached_response.json() == response.json()
    assert len(requests) == 1
    assert requests[0].method == "GET"
    assert b"/api/v0/logs/syslog/router%2Fedge.example.com" in requests[0].url.raw_path
    assert dict(requests[0].url.params) == {
        "limit": "200",
        "start": "2",
        "sortorder": "DESC",
    }
    cache_keys = [
        key async for key in wired_redis_cache.scan_iter("watchtower:device_logs:*")
    ]
    assert len(cache_keys) == 1
    assert await wired_redis_cache.ttl(cache_keys[0]) > 0


async def test_device_logs_default_params_and_device_id_fallback(
    wired_redis_cache, monkeypatch
):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": "ok", "logs": []})

    await redis_cache.set(CACHE_DEVICES, [{"device_id": 7}])
    monkeypatch.setattr(devices_module, "get_device_with_live_data", _known_device)
    _mock_librenms(monkeypatch, handler)

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get(
            "/api/device/fixture-router/logs", headers=_headers()
        )

    assert response.status_code == 200
    assert response.json() == []
    assert len(requests) == 1
    assert requests[0].url.path == "/api/v0/logs/eventlog/7"
    assert dict(requests[0].url.params) == {
        "limit": "50",
        "start": "0",
        "sortorder": "DESC",
    }


async def test_device_logs_with_date_filters_skip_cache(wired_redis_cache, monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": "ok", "logs": []})

    await redis_cache.set(CACHE_DEVICES, [{"device_id": 7, "hostname": "router.example.com"}])
    monkeypatch.setattr(devices_module, "get_device_with_live_data", _known_device)
    _mock_librenms(monkeypatch, handler)

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        for _ in range(2):
            response = await client.get(
                "/api/device/fixture-router/logs",
                params={"from": "2026-11-28 12:00:00", "to": "2026-11-28 13:00:00"},
                headers=_headers(),
            )
            assert response.status_code == 200

    assert len(requests) == 2
    assert dict(requests[0].url.params) == {
        "limit": "50",
        "start": "0",
        "sortorder": "DESC",
        "from": "2026-11-28 12:00:00",
        "to": "2026-11-28 13:00:00",
    }
    assert [
        key async for key in wired_redis_cache.scan_iter("watchtower:device_logs:*")
    ] == []


async def test_invalid_cached_payload_is_refetched(wired_redis_cache, monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": "ok", "logs": []})

    await redis_cache.set(CACHE_DEVICES, [{"device_id": 7, "hostname": "router.example.com"}])
    monkeypatch.setattr(devices_module, "get_device_with_live_data", _known_device)
    _mock_librenms(monkeypatch, handler)

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        first = await client.get("/api/device/fixture-router/logs", headers=_headers())
        cache_keys = [
            key async for key in wired_redis_cache.scan_iter("watchtower:device_logs:*")
        ]
        assert first.status_code == 200
        assert len(cache_keys) == 1
        await redis_cache.set(cache_keys[0], [{"malformed": True}], ttl=30)
        second = await client.get("/api/device/fixture-router/logs", headers=_headers())
        await redis_cache.set(cache_keys[0], "not-json", ttl=30)
        third = await client.get("/api/device/fixture-router/logs", headers=_headers())

    assert second.status_code == 200
    assert second.json() == []
    assert third.status_code == 200
    assert third.json() == []
    assert len(requests) == 3


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
