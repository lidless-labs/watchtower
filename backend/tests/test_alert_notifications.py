"""Alert polling owns notification transitions, independently of HTTP reads."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import get_current_user
from app.main import app, shutdown_notification_worker
from app.models.device import DeviceStatus
from app.polling import aggregator
from app.polling.librenms import LibreNMSAlert
from app.services.notification_service import notification_service

# Import the module rather than the package's scheduler singleton.
import importlib
polling = importlib.import_module("app.polling.scheduler")


@pytest.fixture
async def alert_poll(monkeypatch, wired_redis_cache):
    upstream = AsyncMock()
    upstream.__aenter__.return_value = upstream
    upstream.get_active_alerts.return_value = []
    monkeypatch.setattr(polling, "LibreNMSClient", lambda: upstream)
    topology = SimpleNamespace(devices={})
    monkeypatch.setattr(aggregator, "get_aggregated_topology", AsyncMock(return_value=topology))
    dispatch = AsyncMock()
    monkeypatch.setattr(notification_service, "dispatch", dispatch)
    try:
        yield upstream, topology, dispatch
    finally:
        await shutdown_notification_worker()


def upstream_alert(state=1):
    return LibreNMSAlert(id=7, device_id=3, rule_id=1, state=state,
                         hostname="example", severity="critical")


async def drain():
    await shutdown_notification_worker()


async def test_headless_poll_notifies_new_and_cleared_alert_once(alert_poll):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1
    assert dispatch.call_args.kwargs["alert_id"] == "librenms-7"
    assert dispatch.call_args.kwargs["alert_type"] == "alert"

    # Stopping and restarting the worker preserves the Redis baseline.
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1
    upstream.get_active_alerts.return_value = []
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 2
    assert dispatch.call_args.kwargs["is_recovery"] is True
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 2


async def test_acknowledged_alert_is_still_open(alert_poll):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    await polling.poll_alerts()
    await drain()
    dispatch.reset_mock()
    upstream.get_active_alerts.return_value = [upstream_alert(state=2)]
    await polling.poll_alerts()
    await drain()
    dispatch.assert_not_awaited()


async def test_generated_device_alerts_notify_without_browser(alert_poll):
    _, topology, dispatch = alert_poll
    topology.devices["example"] = SimpleNamespace(
        status=DeviceStatus.DOWN, display_name="Example", ip=None, last_seen=None)
    await polling.poll_alerts()
    await drain()
    assert dispatch.call_args.kwargs["alert_id"] == "device-down-example"
    topology.devices.clear()
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 2
    assert dispatch.call_args.kwargs["is_recovery"] is True


async def test_get_alerts_is_read_only_even_with_status_filter(alert_poll):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    await polling.poll_alerts()
    await drain()
    dispatch.reset_mock()
    app.dependency_overrides[get_current_user] = lambda: {"username": "example", "role": "viewer"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://example") as client:
            for suffix in ("", "?status=acknowledged", "?status=active", ""):
                response = await client.get(f"/api/alerts{suffix}")
                assert response.status_code == 200
        await drain()
        dispatch.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()


async def test_failed_poll_keeps_previous_notification_state(alert_poll):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    await polling.poll_alerts()
    await drain()
    dispatch.reset_mock()
    upstream.get_active_alerts.side_effect = RuntimeError("upstream unavailable")
    await polling.poll_alerts()
    await drain()
    dispatch.assert_not_awaited()
    upstream.get_active_alerts.side_effect = None
    await polling.poll_alerts()
    await drain()
    dispatch.assert_not_awaited()


async def test_concurrent_pollers_do_not_duplicate_notifications(alert_poll):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    await asyncio.gather(polling.poll_alerts(), polling.poll_alerts())
    await drain()
    assert dispatch.await_count == 1


async def test_notification_collection_failure_preserves_events_and_retries(alert_poll, monkeypatch):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    collector = aggregator.get_aggregated_topology
    monkeypatch.setattr(aggregator, "get_aggregated_topology", AsyncMock(side_effect=RuntimeError("snapshot unavailable")))
    broadcast = AsyncMock()
    monkeypatch.setattr(polling, "broadcast_new_alerts", broadcast)
    await polling.poll_alerts()
    broadcast.assert_awaited_once()
    dispatch.assert_not_awaited()
    monkeypatch.setattr(aggregator, "get_aggregated_topology", collector)
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1


async def test_first_seen_acknowledged_alert_does_not_notify(alert_poll):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert(state=2)]
    await polling.poll_alerts()
    await drain()
    dispatch.assert_not_awaited()


async def test_alert_without_hostname_uses_device_id(alert_poll):
    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert().model_copy(update={"hostname": None})]
    await polling.poll_alerts()
    await drain()
    assert dispatch.call_args.kwargs["device"] == "3"


async def test_scheduler_stop_waits_for_inflight_alert_producer(alert_poll):
    upstream, _, dispatch = alert_poll
    started = asyncio.Event()
    finish = asyncio.Event()

    async def pending_alerts():
        started.set()
        await finish.wait()
        return [upstream_alert()]

    upstream.get_active_alerts.side_effect = pending_alerts
    task = asyncio.create_task(polling.poll_alerts())
    await started.wait()
    stop_task = asyncio.create_task(polling.PollingScheduler().stop())
    try:
        await asyncio.sleep(0)
        assert not stop_task.done()
    finally:
        finish.set()
        await task
        await stop_task
        await drain()
    assert dispatch.await_count == 1


async def test_upstream_acknowledgement_never_looks_like_recovery(alert_poll, monkeypatch):
    from contextlib import asynccontextmanager
    from httpx import MockTransport, Response
    from app.polling.librenms import LibreNMSClient

    _, _, dispatch = alert_poll
    current_state = 1
    requests = []

    def respond(request):
        requests.append(request)
        included = str(current_state) in request.url.params.get("state", "").split(",")
        records = [upstream_alert(state=current_state).model_dump()] if included else []
        return Response(200, json={"status": "ok", "count": len(records), "alerts": records})

    @asynccontextmanager
    async def client():
        upstream = LibreNMSClient(base_url="https://example", api_key="example")
        async with AsyncClient(transport=MockTransport(respond), base_url="https://example/api/v0") as transport:
            upstream._client = transport
            yield upstream

    monkeypatch.setattr(polling, "LibreNMSClient", client)
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1
    current_state = 2
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1
    assert [r.url.params.get("state") for r in requests] == ["1,2", "1,2"]


@pytest.mark.parametrize("kind", ["error", "partial", "oversized"])
async def test_invalid_upstream_snapshot_does_not_send_false_recovery(alert_poll, monkeypatch, kind):
    from contextlib import asynccontextmanager
    from httpx import MockTransport, Response
    from app.polling.librenms import LibreNMSClient

    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1
    payload = {"status": "ok", "count": 0, "alerts": []}
    if kind == "error":
        payload["status"] = "error"
    elif kind == "partial":
        payload["count"] = 1
    else:
        payload["padding"] = "x" * (2 * 1024 * 1024)

    @asynccontextmanager
    async def client():
        upstream = LibreNMSClient(base_url="https://example", api_key="example")
        transport = MockTransport(lambda _: Response(200, json=payload))
        async with AsyncClient(transport=transport, base_url="https://example/api/v0") as http:
            upstream._client = http
            yield upstream

    monkeypatch.setattr(polling, "LibreNMSClient", client)
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1


async def test_recovery_waits_for_persisted_baseline_and_retries_once(alert_poll, monkeypatch):
    from redis.exceptions import ConnectionError
    from app.services.alert_service import CACHE_NOTIFICATION_ALERTS

    upstream, _, dispatch = alert_poll
    upstream.get_active_alerts.return_value = [upstream_alert()]
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1
    upstream.get_active_alerts.return_value = []
    original_set = polling.redis_cache.set

    async def failed_baseline_write(key, value, ttl=None):
        if key == CACHE_NOTIFICATION_ALERTS:
            raise ConnectionError("example transient write failure")
        await original_set(key, value, ttl)

    monkeypatch.setattr(polling.redis_cache, "set", failed_baseline_write)
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 1
    monkeypatch.setattr(polling.redis_cache, "set", original_set)
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 2
    assert dispatch.call_args.kwargs["is_recovery"] is True
    await polling.poll_alerts()
    await drain()
    assert dispatch.await_count == 2
