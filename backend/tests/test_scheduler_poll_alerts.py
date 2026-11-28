from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from importlib import import_module

from app.polling.librenms import LibreNMSAlert

scheduler = import_module("app.polling.scheduler")


class FakeLibreNMSClient:
    alerts = []
    fail = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get_active_alerts(self):
        if type(self).fail:
            raise RuntimeError("fixture polling failure")
        return type(self).alerts


@pytest.fixture(autouse=True)
def polling_client(monkeypatch):
    FakeLibreNMSClient.alerts = []
    FakeLibreNMSClient.fail = False
    monkeypatch.setattr(scheduler, "LibreNMSClient", FakeLibreNMSClient)

    def close_history(coro, operation):
        coro.close()

    monkeypatch.setattr(scheduler, "_fire_and_forget_history", close_history)


def alert(alert_id: int, state: int = 1) -> LibreNMSAlert:
    return LibreNMSAlert(
        id=alert_id, device_id=7, rule_id=3, state=state,
        severity="critical", title=f"Alert {alert_id}", hostname="switch-a.example.com",
    )


@pytest.mark.asyncio
async def test_poll_alerts_caches_current_alerts_and_broadcasts_new(wired_redis_cache, monkeypatch):
    FakeLibreNMSClient.alerts = [alert(1), alert(2, state=2)]
    broadcast = AsyncMock()
    monkeypatch.setattr(scheduler, "broadcast_new_alerts", broadcast)

    await scheduler.poll_alerts()

    cached = await scheduler.redis_cache.get_json(scheduler.CACHE_ALERTS)
    assert [item["id"] for item in cached] == [1, 2]
    assert [item["id"] for item in broadcast.await_args.args[0]] == [1]


@pytest.mark.asyncio
async def test_poll_alerts_does_not_broadcast_existing_alert(wired_redis_cache, monkeypatch):
    await scheduler.redis_cache.set(scheduler.CACHE_ALERTS, [{"id": 1, "state": 1}])
    FakeLibreNMSClient.alerts = [alert(1)]
    broadcast = AsyncMock()
    monkeypatch.setattr(scheduler, "broadcast_new_alerts", broadcast)

    await scheduler.poll_alerts()
    broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_poll_alerts_broadcasts_new_active_but_not_acknowledged(wired_redis_cache, monkeypatch):
    FakeLibreNMSClient.alerts = [alert(3), alert(4, state=2)]
    broadcast = AsyncMock()
    monkeypatch.setattr(scheduler, "broadcast_new_alerts", broadcast)

    await scheduler.poll_alerts()
    assert [item["id"] for item in broadcast.await_args.args[0]] == [3]


@pytest.mark.asyncio
async def test_poll_alerts_detects_resolved_ids(wired_redis_cache, monkeypatch):
    await scheduler.redis_cache.set(scheduler.CACHE_ALERTS, [{"id": 1, "state": 1}, {"id": 2, "state": 1}])
    FakeLibreNMSClient.alerts = [alert(2)]
    resolved = AsyncMock()
    monkeypatch.setattr(scheduler, "broadcast_resolved_alerts", resolved)

    await scheduler.poll_alerts()
    resolved.assert_awaited_once_with([1])


@pytest.mark.asyncio
async def test_poll_alerts_ack_overlay_preserves_ack_until_remote_confirms(wired_redis_cache, monkeypatch):
    await scheduler.redis_cache.sadd(scheduler.CACHE_ALERT_ACK_OVERLAY, "5")
    FakeLibreNMSClient.alerts = [alert(5, state=1)]
    broadcast = AsyncMock()
    monkeypatch.setattr(scheduler, "broadcast_new_alerts", broadcast)

    await scheduler.poll_alerts()
    assert (await scheduler.redis_cache.get_json(scheduler.CACHE_ALERTS))[0]["state"] == 2
    assert await scheduler.redis_cache.smembers(scheduler.CACHE_ALERT_ACK_OVERLAY) == {"5"}
    broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_poll_alerts_clears_overlay_after_remote_ack_confirmation(wired_redis_cache):
    await scheduler.redis_cache.sadd(scheduler.CACHE_ALERT_ACK_OVERLAY, "5")
    FakeLibreNMSClient.alerts = [alert(5, state=2)]

    await scheduler.poll_alerts()

    assert await scheduler.redis_cache.smembers(scheduler.CACHE_ALERT_ACK_OVERLAY) == set()


@pytest.mark.asyncio
async def test_poll_alerts_clears_overlay_when_alert_resolves(wired_redis_cache):
    await scheduler.redis_cache.sadd(scheduler.CACHE_ALERT_ACK_OVERLAY, "5")
    FakeLibreNMSClient.alerts = []

    await scheduler.poll_alerts()

    assert await scheduler.redis_cache.smembers(scheduler.CACHE_ALERT_ACK_OVERLAY) == set()


@pytest.mark.asyncio
async def test_poll_alerts_empty_previous_cache_is_supported(wired_redis_cache):
    FakeLibreNMSClient.alerts = []
    await scheduler.poll_alerts()
    assert await scheduler.redis_cache.get_json(scheduler.CACHE_ALERTS) == []


@pytest.mark.asyncio
async def test_poll_alerts_failure_is_logged_and_previous_cache_preserved(wired_redis_cache, caplog):
    previous = [{"id": 9, "state": 1}]
    await scheduler.redis_cache.set(scheduler.CACHE_ALERTS, previous)
    FakeLibreNMSClient.fail = True

    await scheduler.poll_alerts()

    assert await scheduler.redis_cache.get_json(scheduler.CACHE_ALERTS) == previous
    assert "Failed to poll alerts" in caplog.text


@pytest.mark.asyncio
async def test_poll_device_status_caches_devices_and_changes(wired_redis_cache, monkeypatch):
    from app.polling.librenms import LibreNMSDevice

    class Client(FakeLibreNMSClient):
        async def get_devices(self):
            return [LibreNMSDevice(device_id=7, hostname="switch-a.example.com", ip="192.0.2.10", status=0)]

    monkeypatch.setattr(scheduler, "LibreNMSClient", Client)
    await scheduler.redis_cache.set(scheduler.CACHE_DEVICE_STATUS, {"7": {"status": "up"}})
    changes = AsyncMock()
    monkeypatch.setattr(scheduler, "broadcast_status_changes", changes)
    await scheduler.poll_device_status()

    assert (await scheduler.redis_cache.get_json(scheduler.CACHE_DEVICE_STATUS))["7"]["status"] == "down"
    changes.assert_awaited_once()


@pytest.mark.asyncio
async def test_poll_interfaces_skips_missing_device_cache(wired_redis_cache):
    await scheduler.poll_interfaces()
    assert await scheduler.redis_cache.get_json(scheduler.CACHE_DEVICES) is None
