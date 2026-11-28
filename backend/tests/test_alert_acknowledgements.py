from __future__ import annotations

import asyncio
import importlib
import json
from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app import config as config_module
from app.auth import create_token
from app.cache import redis_cache
from app.models.alert import AlertStatus
from app.models.device import DeviceStatus
from app.polling import librenms
from app.polling.librenms import LibreNMSClient
from app.polling.scheduler import (
    CACHE_ACKNOWLEDGED_ALERTS,
    CACHE_ALERT_ACK_OVERLAY,
    CACHE_ALERTS,
    poll_alerts,
    poll_device_status,
)
from app.routers import alerts as alerts_module

scheduler_module = importlib.import_module("app.polling.scheduler")

TEST_JWT_SECRET = "alert-ack-test-secret-32-bytes-long"


def _headers(role: str = "operator") -> dict[str, str]:
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = create_token({"username": "alert-test", "role": role})
    return {"Authorization": f"Bearer {token}"}


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(alerts_module.router, prefix="/api")
    return app


def _mock_librenms(monkeypatch, handler):
    real_async_client = httpx.AsyncClient
    mock_transport = httpx.MockTransport(handler)

    monkeypatch.setattr(
        librenms,
        "get_settings",
        lambda: SimpleNamespace(
            librenms_url="http://librenms.example.internal",
            librenms_api_key="fixture-api-token",
        ),
    )
    monkeypatch.setattr(
        librenms.httpx,
        "AsyncClient",
        lambda **kwargs: real_async_client(transport=mock_transport, **kwargs),
    )


async def test_acknowledging_librenms_alert_uses_one_put(wired_redis_cache, monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": "ok"})

    _mock_librenms(monkeypatch, handler)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.post("/api/alert/librenms-17/acknowledge", headers=_headers())

    assert response.status_code == 200
    assert len(requests) == 1
    assert requests[0].method == "PUT"
    assert requests[0].url.path == "/api/v0/alerts/17"
    assert json.loads(requests[0].read()) == {"note": "", "until_clear": True}


async def test_librenms_acknowledgement_failure_is_reported(wired_redis_cache, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"status": "error"})

    _mock_librenms(monkeypatch, handler)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.post("/api/alert/librenms-17/acknowledge", headers=_headers())

    assert response.status_code == 502
    assert response.json()["detail"]


async def test_librenms_acknowledgement_api_error_is_reported(wired_redis_cache, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "error", "message": "ack rejected"})

    _mock_librenms(monkeypatch, handler)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.post("/api/alert/librenms-17/acknowledge", headers=_headers())

    assert response.status_code == 502


async def test_missing_librenms_alert_is_not_acknowledged(wired_redis_cache, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"status": "error", "message": "No Alert by that ID"},
        )

    _mock_librenms(monkeypatch, handler)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.post("/api/alert/librenms-17/acknowledge", headers=_headers())

    assert response.status_code == 404
    assert await redis_cache.smembers(CACHE_ALERT_ACK_OVERLAY) == set()


async def test_acknowledge_alert_sends_note_and_until_clear(wired_redis_cache, monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": "ok"})

    _mock_librenms(monkeypatch, handler)
    async with LibreNMSClient() as client:
        await client.acknowledge_alert(17, note="fixture note", until_clear=False)

    assert json.loads(requests[0].read()) == {"note": "fixture note", "until_clear": False}


async def test_resolving_librenms_alert_unmutes_it(wired_redis_cache, monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": "ok"})

    _mock_librenms(monkeypatch, handler)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.post("/api/alert/librenms-17/resolve", headers=_headers())

    assert response.status_code == 200
    assert len(requests) == 1
    assert requests[0].method == "PUT"
    assert requests[0].url.path == "/api/v0/alerts/unmute/17"
    assert json.loads(requests[0].read()) == {}


async def test_librenms_acknowledged_alert_is_listed_as_acknowledged(wired_redis_cache, monkeypatch):
    await redis_cache.set(CACHE_ALERTS, [{"id": 17, "state": 2, "hostname": "fixture-node"}])
    monkeypatch.setattr(
        alerts_module,
        "get_aggregated_topology",
        _empty_topology,
    )
    monkeypatch.setattr(alerts_module, "_notify_new_alerts", _skip_notifications)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.get("/api/alerts")

    assert response.status_code == 200
    assert response.json()[0]["status"] == AlertStatus.ACKNOWLEDGED.value


async def _empty_topology():
    return SimpleNamespace(devices={})


async def _skip_notifications(_alerts):
    return None


async def test_local_acknowledgement_persists_in_redis(wired_redis_cache, monkeypatch):
    monkeypatch.setattr(alerts_module, "get_aggregated_topology", _down_topology)
    monkeypatch.setattr(alerts_module, "_notify_new_alerts", _skip_notifications)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.post("/api/alert/device-down-fixture-node/acknowledge", headers=_headers())
        alerts_response = await client.get("/api/alerts")
        acknowledged = await redis_cache.smembers(alerts_module.CACHE_ACKNOWLEDGED_ALERTS)
        resolve_response = await client.post("/api/alert/device-down-fixture-node/resolve", headers=_headers())

    assert response.status_code == 200
    assert acknowledged == {"device-down-fixture-node"}
    assert alerts_response.status_code == 200
    assert alerts_response.json()[0]["status"] == AlertStatus.ACKNOWLEDGED.value
    assert resolve_response.status_code == 200
    assert await redis_cache.smembers(alerts_module.CACHE_ACKNOWLEDGED_ALERTS) == set()


async def _down_topology():
    device = SimpleNamespace(
        status=DeviceStatus.DOWN,
        display_name="fixture-node",
        ip="192.0.2.10",
        last_seen=None,
    )
    return SimpleNamespace(devices={"fixture-node": device})


async def test_poll_alerts_requests_and_caches_states_one_and_two(wired_redis_cache, monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "alerts": [
                    {
                        "id": 1,
                        "device_id": 7,
                        "rule_id": 2,
                        "state": 1,
                        "hostname": "fixture-node",
                    },
                    {
                        "id": 2,
                        "device_id": 7,
                        "rule_id": 2,
                        "state": 2,
                        "hostname": "fixture-node",
                    },
                ]
            },
        )

    _mock_librenms(monkeypatch, handler)
    await poll_alerts()

    cached_alerts = await redis_cache.get_json(CACHE_ALERTS)
    assert len(requests) == 1
    assert requests[0].method == "GET"
    assert requests[0].url.params["state"] == "1,2"
    assert {alert["state"] for alert in cached_alerts} == {1, 2}


async def test_acknowledgement_overlay_survives_a_stale_poll_until_librenms_confirms(
    wired_redis_cache,
    monkeypatch,
):
    await redis_cache.set(CACHE_ALERTS, [{"id": 17, "state": 1, "hostname": "fixture-node"}])
    poll_state = 1
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal poll_state
        requests.append(request)
        if request.method == "PUT":
            return httpx.Response(200, json={"status": "ok"})
        return httpx.Response(
            200,
            json={
                "alerts": [
                    {
                        "id": 17,
                        "device_id": 7,
                        "rule_id": 2,
                        "state": poll_state,
                        "hostname": "fixture-node",
                    }
                ]
            },
        )

    _mock_librenms(monkeypatch, handler)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        response = await client.post("/api/alert/librenms-17/acknowledge", headers=_headers())

    assert response.status_code == 200
    assert (await redis_cache.get_json(CACHE_ALERTS))[0]["state"] == 2
    await poll_alerts()
    assert (await redis_cache.get_json(CACHE_ALERTS))[0]["state"] == 2
    assert await redis_cache.smembers(CACHE_ALERT_ACK_OVERLAY) == {"17"}

    # Simulate a poll that had already passed its overlay read before the ack
    # write and then overwrote the cache with its stale state-1 response.
    await redis_cache.set(CACHE_ALERTS, [{"id": 17, "state": 1, "hostname": "fixture-node"}])
    monkeypatch.setattr(alerts_module, "get_aggregated_topology", _empty_topology)
    monkeypatch.setattr(alerts_module, "_notify_new_alerts", _skip_notifications)
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        alerts_response = await client.get("/api/alerts")
    assert alerts_response.json()[0]["status"] == AlertStatus.ACKNOWLEDGED.value

    poll_state = 2
    await poll_alerts()
    assert (await redis_cache.get_json(CACHE_ALERTS))[0]["state"] == 2
    assert await redis_cache.smembers(CACHE_ALERT_ACK_OVERLAY) == set()


async def test_successful_device_poll_clears_ack_for_recovered_device(
    wired_redis_cache,
    monkeypatch,
):
    await redis_cache.sadd(CACHE_ACKNOWLEDGED_ALERTS, "device-down-7")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "devices": [
                    {"device_id": 7, "hostname": "fixture-node", "status": 1}
                ]
            },
        )

    _mock_librenms(monkeypatch, handler)
    await poll_device_status()

    assert await redis_cache.smembers(CACHE_ACKNOWLEDGED_ALERTS) == set()


async def test_network_summary_counts_only_unacknowledged_alerts(wired_redis_cache, monkeypatch):
    await redis_cache.set(
        CACHE_ALERTS,
        [{"id": 1, "state": 1}, {"id": 2, "state": 2}],
    )
    summary = {}
    history_coroutines = []

    async def write_network_summary(**kwargs):
        summary.update(kwargs)

    monkeypatch.setattr(
        scheduler_module.history_writer,
        "write_network_summary",
        write_network_summary,
    )
    monkeypatch.setattr(
        scheduler_module,
        "_fire_and_forget_history",
        lambda coro, operation: history_coroutines.append(coro),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"devices": [{"device_id": 7, "hostname": "fixture-node", "status": 1}]},
        )

    _mock_librenms(monkeypatch, handler)
    await poll_device_status()
    await asyncio.gather(*history_coroutines)

    assert summary["active_alerts"] == 1
