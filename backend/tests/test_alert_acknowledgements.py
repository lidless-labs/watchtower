"""Upstream acknowledgement transport and durable device alert state."""

from contextlib import asynccontextmanager
import importlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app import config as config_module
from app.auth import create_token
from app.cache import redis_cache
from app.main import app, shutdown_notification_worker
from app.models.device import DeviceStatus
from app.polling import aggregator
from app.polling.librenms import LibreNMSClient
from app.routers import alerts as routes
from app.services.notification_service import notification_service

polling = importlib.import_module("app.polling.scheduler")


@pytest.fixture
async def alert_api(monkeypatch, wired_redis_cache):
    requests = []
    responses = {}

    def handle(request):
        requests.append(request)
        default = {"status": "ok", "alerts": [], "count": 0}
        if request.method == "PUT":
            default = {"status": "ok", "message": "Alert has been unmuted" if "/unmute/" in request.url.path else "Alert has been acknowledged"}
        status, payload = responses.get((request.method, request.url.path), (200, default))
        if isinstance(payload, Exception):
            raise payload
        return httpx.Response(status, json=payload)

    @asynccontextmanager
    async def upstream_client():
        client = LibreNMSClient(base_url="https://example", api_key="example")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle), base_url="https://example/api/v0", timeout=30) as transport:
            client._client = transport
            yield client

    monkeypatch.setattr(routes, "LibreNMSClient", upstream_client, raising=False)
    monkeypatch.setattr(polling, "LibreNMSClient", upstream_client)
    topology = SimpleNamespace(devices={})
    collect_topology = AsyncMock(return_value=topology)
    monkeypatch.setattr(aggregator, "get_aggregated_topology", collect_topology)
    monkeypatch.setattr(routes, "get_aggregated_topology", collect_topology)
    monkeypatch.setattr(notification_service, "dispatch", AsyncMock())
    config_module.config.auth.jwt_secret = "example-signing-key-only-for-tests-32-bytes"
    config_module.config.auth.token_version = 1
    token = create_token({"username": "example", "role": "operator"})
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://example", headers={"Authorization": f"Bearer {token}"}) as api:
            yield api, upstream_client, requests, responses, topology
    finally:
        await shutdown_notification_worker()


async def test_acknowledge_and_resolve_use_exactly_one_upstream_put_each(alert_api):
    api, _, requests, _, _ = alert_api
    await redis_cache.set(polling.CACHE_ALERTS, [{"id": 7, "device_id": 3, "hostname": "example", "state": 1}])
    response = await api.post("/api/alert/librenms-7/acknowledge")
    assert response.status_code == 200
    assert [(r.method, r.url.path) for r in requests] == [("PUT", "/api/v0/alerts/7")]
    assert json.loads(requests[0].content) == {"note": "", "until_clear": True}
    listing = await api.get("/api/alerts")
    assert listing.json()[0]["status"] == "acknowledged"
    requests.clear()
    response = await api.post("/api/alert/librenms-7/resolve")
    assert response.status_code == 200
    assert [(r.method, r.url.path) for r in requests] == [("PUT", "/api/v0/alerts/unmute/7")]
    assert json.loads(requests[0].content) == {"note": ""}
    listing = await api.get("/api/alerts")
    assert listing.json()[0]["status"] == "active"


@pytest.mark.parametrize("action,path", [("acknowledge", "/api/v0/alerts/7"), ("resolve", "/api/v0/alerts/unmute/7")])
@pytest.mark.parametrize("status,payload", [(403, {"status": "error"}), (200, {"status": "error", "message": "rejected"}), (200, {"unexpected": "response"}), (200, {"status": "ok", "message": "No Alert by that ID"}), (200, {"status": "ok", "message": "No alert by that ID"})])
async def test_upstream_rejection_never_becomes_local_success(alert_api, action, path, status, payload):
    api, _, requests, responses, _ = alert_api
    responses[("PUT", path)] = status, payload
    await redis_cache.set(polling.CACHE_ALERTS, [{"id": 7, "device_id": 3, "hostname": "example", "state": 1}])
    response = await api.post(f"/api/alert/librenms-7/{action}")
    assert response.status_code == 502
    assert len(requests) == 1
    assert (await redis_cache.get_json(polling.CACHE_ALERTS))[0]["state"] == 1


async def test_client_acknowledgement_options_are_sent_as_json(alert_api):
    _, upstream, requests, _, _ = alert_api
    async with upstream() as client:
        await client.acknowledge_alert(7, note="Example note", until_clear=False)
    assert json.loads(requests[0].content) == {"note": "Example note", "until_clear": False}


async def test_polling_includes_active_and_acknowledged_states(alert_api):
    api, _, requests, responses, _ = alert_api
    active = {"id": 7, "device_id": 3, "rule_id": 1, "state": 1, "hostname": "example"}
    acknowledged = {**active, "id": 8, "state": 2}
    # Both open states come from one snapshot, avoiding transitions between GETs.
    responses[("GET", "/api/v0/alerts")] = 200, {"status": "ok", "count": 2, "alerts": [active, acknowledged]}
    await polling.poll_alerts()
    assert [(r.method, r.url.params.get("state")) for r in requests] == [("GET", "1,2")]
    response = await api.get("/api/alerts")
    statuses = {a["id"]: a["status"] for a in response.json()}
    assert statuses == {"librenms-7": "active", "librenms-8": "acknowledged"}
    assert {a["state"] for a in await redis_cache.get_json(polling.CACHE_ALERTS)} == {1, 2}


async def test_device_down_acknowledgement_survives_module_reload(alert_api):
    api, _, requests, _, topology = alert_api
    topology.devices["example"] = SimpleNamespace(status=DeviceStatus.DOWN, display_name="Example", ip=None, last_seen=None)
    response = await api.post("/api/alert/device-down-example/acknowledge")
    assert response.status_code == 200
    importlib.reload(routes)
    response = await api.get("/api/alerts")
    assert response.json()[0]["status"] == "acknowledged"
    assert requests == []
    response = await api.post("/api/alert/device-down-example/resolve")
    assert response.status_code == 200
    response = await api.get("/api/alerts")
    assert response.json()[0]["status"] == "active"


@pytest.mark.parametrize("action", ["acknowledge", "resolve"])
async def test_viewer_cannot_mutate_either_source(alert_api, action):
    api, _, requests, _, _ = alert_api
    token = create_token({"username": "example", "role": "viewer"})
    api.headers["Authorization"] = f"Bearer {token}"
    for alert_id in ("librenms-7", "device-down-example"):
        response = await api.post(f"/api/alert/{alert_id}/{action}")
        assert response.status_code == 403
    assert requests == []


@pytest.mark.parametrize("alert_id", ["librenms-example", "librenms-0", "example", "device-down-example"])
async def test_invalid_alert_ids_cannot_reach_upstream(alert_api, alert_id):
    api, _, requests, _, _ = alert_api
    response = await api.post(f"/api/alert/{alert_id}/acknowledge")
    assert response.status_code == 404
    assert requests == []


async def test_upstream_timeout_is_reported_without_local_ack(alert_api):
    api, _, requests, responses, _ = alert_api
    responses[("PUT", "/api/v0/alerts/7")] = 200, httpx.ReadTimeout("example timeout")
    response = await api.post("/api/alert/librenms-7/acknowledge")
    assert response.status_code == 504
    assert len(requests) == 1


@pytest.mark.parametrize("payload", [{"status": "ok", "count": 2, "alerts": []}, {"status": "error", "alerts": []}])
async def test_incomplete_or_failed_listing_does_not_clear_cache(alert_api, payload):
    _, _, _, responses, _ = alert_api
    previous = [{"id": 7, "device_id": 3, "state": 1}]
    await redis_cache.set(polling.CACHE_ALERTS, previous)
    responses[("GET", "/api/v0/alerts")] = 200, payload
    await polling.poll_alerts()
    assert await redis_cache.get_json(polling.CACHE_ALERTS) == previous


async def test_alert_response_size_is_bounded(alert_api):
    _, upstream, _, responses, _ = alert_api
    responses[("GET", "/api/v0/alerts")] = 200, {"status": "ok", "alerts": [], "padding": "x" * (2 * 1024 * 1024)}
    async with upstream() as client:
        with pytest.raises(httpx.HTTPError, match="size limit"):
            await client.get_active_alerts()


async def test_successful_upstream_write_remains_success_when_cache_is_unavailable(alert_api, monkeypatch):
    api, _, requests, _, _ = alert_api
    monkeypatch.setattr(redis_cache, "_client", None)
    response = await api.post("/api/alert/librenms-7/acknowledge")
    assert response.status_code == 200
    assert response.json()["status"] == "acknowledged"
    assert response.json()["cache_updated"] is False
    assert len(requests) == 1


async def test_device_recovery_expires_ack_for_the_next_outage(alert_api):
    api, _, _, responses, topology = alert_api
    device = SimpleNamespace(status=DeviceStatus.DOWN, display_name="Example", ip=None, last_seen=None)
    topology.devices["example"] = device
    assert (await api.post("/api/alert/device-down-example/acknowledge")).status_code == 200
    device.status = DeviceStatus.UP
    responses[("GET", "/api/v0/devices")] = 200, {"devices": [{"device_id": 3, "hostname": "example", "status": 1}]}
    await polling.poll_device_status()
    device.status = DeviceStatus.DOWN
    response = await api.get("/api/alerts")
    assert response.json()[0]["status"] == "active"


@pytest.mark.parametrize("cached", [["example"], [{"id": 8, "state": 1}], []])
async def test_successful_upstream_write_is_not_failed_by_unusable_cache(alert_api, cached):
    api, _, requests, _, _ = alert_api
    await redis_cache.set(polling.CACHE_ALERTS, cached)
    response = await api.post("/api/alert/librenms-7/acknowledge")
    assert response.status_code == 200
    assert response.json()["cache_updated"] is False
    assert len(requests) == 1


async def test_missing_ack_store_does_not_hide_down_device(alert_api, monkeypatch):
    from redis.exceptions import ResponseError
    api, _, _, _, topology = alert_api
    topology.devices["example"] = SimpleNamespace(status=DeviceStatus.DOWN, display_name="Example", ip=None, last_seen=None)
    monkeypatch.setattr(redis_cache, "smembers", AsyncMock(side_effect=ResponseError("example store unavailable")))
    response = await api.get("/api/alerts")
    assert response.status_code == 200
    assert [(a["id"], a["status"]) for a in response.json()] == [("device-down-example", "active")]
