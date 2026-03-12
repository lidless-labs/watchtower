"""Alert API routes - Real alerts from LibreNMS and device status."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime
from fastapi import APIRouter, HTTPException

from ..cache import redis_cache
from ..config import get_config, settings
from ..polling.aggregator import get_aggregated_topology
from ..polling.scheduler import CACHE_ALERTS
from ..models.alert import Alert, AlertStatus, AlertSeverity, AlertSummary
from ..models.device import DeviceStatus
from ..services.notification_service import notification_service

logger = logging.getLogger("watchtower.alerts")

router = APIRouter()

# In-memory acknowledgment tracking (persists until service restart)
_acknowledged_alerts: set[str] = set()
# Track previously seen alert IDs for notification dispatch
_previously_seen_alerts: set[str] = set()

_NOTIFICATION_QUEUE_MAXSIZE = 1000
_NOTIFICATION_WORKER_CONCURRENCY = 5
_NOTIFICATION_DRAIN_TIMEOUT = 10.0
_notification_queue: asyncio.Queue[Callable[[], Awaitable[None]]] = asyncio.Queue(maxsize=_NOTIFICATION_QUEUE_MAXSIZE)
_notification_worker_tasks: list[asyncio.Task[None]] = []
_notification_worker_lock = asyncio.Lock()


async def _notification_worker(semaphore: asyncio.Semaphore) -> None:
    """Process queued notification jobs with bounded concurrency."""
    try:
        while True:
            async with semaphore:
                job_factory = await _notification_queue.get()
                try:
                    await job_factory()
                except Exception:
                    logger.exception("Failed to dispatch queued alert notification")
                finally:
                    _notification_queue.task_done()
    except asyncio.CancelledError:
        raise


async def ensure_notification_worker() -> None:
    """Start the queue worker once for the process lifetime."""
    global _notification_worker_tasks

    if _notification_worker_tasks and any(not task.done() for task in _notification_worker_tasks):
        return

    async with _notification_worker_lock:
        if _notification_worker_tasks and any(not task.done() for task in _notification_worker_tasks):
            return
        semaphore = asyncio.Semaphore(_NOTIFICATION_WORKER_CONCURRENCY)
        _notification_worker_tasks = [
            asyncio.create_task(_notification_worker(semaphore))
            for _ in range(_NOTIFICATION_WORKER_CONCURRENCY)
        ]


async def shutdown_notification_worker() -> None:
    """Stop the queue worker cleanly during app shutdown."""
    global _notification_worker_tasks

    if not _notification_worker_tasks:
        return

    try:
        await asyncio.wait_for(_notification_queue.join(), timeout=_NOTIFICATION_DRAIN_TIMEOUT)
    except asyncio.TimeoutError:
        logger.warning(
            "Timed out waiting %.1fs for notification queue to drain before shutdown",
            _NOTIFICATION_DRAIN_TIMEOUT,
        )

    for task in _notification_worker_tasks:
        task.cancel()

    try:
        await asyncio.gather(*_notification_worker_tasks, return_exceptions=True)
    finally:
        _notification_worker_tasks = []


def _enqueue_notification(job_factory: Callable[[], Awaitable[None]]) -> None:
    """Queue a notification job, dropping the oldest item on overflow."""
    if _notification_queue.full():
        try:
            _notification_queue.get_nowait()
            _notification_queue.task_done()
            logger.warning("Notification queue full. Dropping oldest pending notification.")
        except asyncio.QueueEmpty:
            logger.warning("Notification queue reported full but was empty when trimming.")

    try:
        _notification_queue.put_nowait(job_factory)
    except asyncio.QueueFull:
        logger.warning("Notification queue still full after trimming. Dropping new notification.")


async def _notify_new_alerts(alerts: list[Alert]) -> None:
    """Queue notifications for newly appeared or resolved alerts."""
    global _previously_seen_alerts
    current_ids = {a.id for a in alerts if a.status == AlertStatus.ACTIVE}
    new_ids = current_ids - _previously_seen_alerts
    resolved_ids = _previously_seen_alerts - current_ids

    if not new_ids and not resolved_ids:
        _previously_seen_alerts = current_ids
        return

    try:
        config_dict = get_config().model_dump()
    except Exception:
        _previously_seen_alerts = current_ids
        return

    await ensure_notification_worker()
    alert_map = {a.id: a for a in alerts}

    for alert_id in new_ids:
        alert = alert_map.get(alert_id)
        if not alert:
            continue
        severity = alert.severity.value if hasattr(alert.severity, "value") else str(alert.severity)
        _enqueue_notification(lambda alert=alert, severity=severity: notification_service.dispatch(
            alert_id=alert.id,
            alert_type="alert",
            severity=severity,
            device=alert.device_id,
            message=alert.message,
            details=alert.details or "",
            config=config_dict,
            demo=settings.demo_mode,
        ))

    for alert_id in resolved_ids:
        _enqueue_notification(lambda alert_id=alert_id: notification_service.dispatch(
            alert_id=alert_id,
            alert_type="recovery",
            severity="info",
            device=alert_id,
            message=f"Alert resolved: {alert_id}",
            config=config_dict,
            demo=settings.demo_mode,
            is_recovery=True,
        ))

    _previously_seen_alerts = current_ids


async def _get_device_down_alerts() -> list[Alert]:
    """Generate alerts for devices that are currently down."""
    alerts = []

    try:
        topology = await get_aggregated_topology()

        for device_id, device in topology.devices.items():
            if device.status == DeviceStatus.DOWN:
                alert_id = f"device-down-{device_id}"
                alerts.append(Alert(
                    id=alert_id,
                    device_id=device_id,
                    severity=AlertSeverity.CRITICAL,
                    message=f"Device unreachable: {device.display_name}",
                    details=f"IP: {device.ip or 'unknown'}",
                    status=AlertStatus.ACKNOWLEDGED if alert_id in _acknowledged_alerts else AlertStatus.ACTIVE,
                    timestamp=device.last_seen or datetime.utcnow(),
                ))
    except Exception as e:
        # Log but don't fail - we can still return LibreNMS alerts
        print(f"Error getting device down alerts: {e}")

    return alerts


async def _get_librenms_alerts() -> list[Alert]:
    """Get alerts from LibreNMS cache."""
    alerts = []

    try:
        cached_alerts = await redis_cache.get_json(CACHE_ALERTS) or []

        for alert in cached_alerts:
            alert_id = f"librenms-{alert.get('id', 'unknown')}"

            # Map LibreNMS severity to our enum
            severity_map = {
                "critical": AlertSeverity.CRITICAL,
                "warning": AlertSeverity.WARNING,
                "ok": AlertSeverity.RECOVERY,
            }
            severity_str = str(alert.get("severity", "warning")).lower()
            severity = severity_map.get(severity_str, AlertSeverity.WARNING)

            # Get timestamp
            timestamp_str = alert.get("timestamp")
            if timestamp_str:
                try:
                    timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                except Exception:
                    timestamp = datetime.utcnow()
            else:
                timestamp = datetime.utcnow()

            alerts.append(Alert(
                id=alert_id,
                device_id=alert.get("hostname", str(alert.get("device_id", "unknown"))),
                severity=severity,
                message=alert.get("name") or alert.get("rule") or "LibreNMS Alert",
                details=alert.get("notes"),
                status=AlertStatus.ACKNOWLEDGED if alert_id in _acknowledged_alerts else AlertStatus.ACTIVE,
                timestamp=timestamp,
            ))
    except Exception as e:
        print(f"Error getting LibreNMS alerts: {e}")

    return alerts


@router.get("/alerts", response_model=list[AlertSummary])
async def list_alerts(status: AlertStatus | None = None):
    """List all active alerts from device status and LibreNMS."""
    if settings.demo_mode:
        from ..demo_data import get_demo_alerts
        demo_alerts = get_demo_alerts()
        return [
            AlertSummary(
                id=a["id"],
                device_id=a["device_id"],
                severity=AlertSeverity(a["severity"]) if a["severity"] in ["critical", "warning", "info", "recovery"] else AlertSeverity.WARNING,
                message=a["message"],
                timestamp=datetime.fromisoformat(a["timestamp"]),
                status=AlertStatus(a["status"]) if a["status"] in ["active", "acknowledged", "resolved"] else AlertStatus.ACTIVE,
            )
            for a in demo_alerts
        ]

    # Combine both alert sources
    device_alerts = await _get_device_down_alerts()
    librenms_alerts = await _get_librenms_alerts()

    all_alerts = device_alerts + librenms_alerts

    # Filter by status if requested
    if status:
        all_alerts = [a for a in all_alerts if a.status == status]

    # Sort by timestamp (newest first)
    all_alerts.sort(key=lambda a: a.timestamp, reverse=True)

    # Fire notifications for new/resolved alerts (non-blocking queue)
    await _notify_new_alerts(all_alerts)

    return [
        AlertSummary(
            id=alert.id,
            device_id=alert.device_id,
            severity=alert.severity,
            message=alert.message,
            timestamp=alert.timestamp,
            status=alert.status,
        )
        for alert in all_alerts
    ]


@router.get("/alert/{alert_id}", response_model=Alert)
async def get_alert(alert_id: str):
    """Get details of a specific alert."""
    device_alerts = await _get_device_down_alerts()
    librenms_alerts = await _get_librenms_alerts()

    for alert in device_alerts + librenms_alerts:
        if alert.id == alert_id:
            return alert

    raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")


@router.post("/alert/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    """Acknowledge an alert."""
    _acknowledged_alerts.add(alert_id)
    return {"status": "acknowledged", "alert_id": alert_id}


@router.post("/alert/{alert_id}/resolve")
async def resolve_alert(alert_id: str):
    """Resolve an alert (removes from acknowledged set)."""
    _acknowledged_alerts.discard(alert_id)
    return {"status": "resolved", "alert_id": alert_id}
