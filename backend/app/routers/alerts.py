"""Alert API routes - Real alerts from LibreNMS and device status."""

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_operator
from ..models.alert import Alert, AlertStatus, AlertSummary
from ..services.alert_service import _acknowledged_alerts, get_alerts

router = APIRouter()


@router.get("/alerts", response_model=list[AlertSummary])
async def list_alerts(status: AlertStatus | None = None):
    """List all active alerts from device status and LibreNMS."""
    all_alerts = await get_alerts()

    # Filter by status if requested
    if status:
        all_alerts = [a for a in all_alerts if a.status == status]

    # Sort by timestamp (newest first)
    all_alerts.sort(key=lambda a: a.timestamp, reverse=True)

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
    for alert in await get_alerts():
        if alert.id == alert_id:
            return alert

    raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")


@router.post("/alert/{alert_id}/acknowledge", dependencies=[Depends(require_operator)])
async def acknowledge_alert(alert_id: str):
    """Acknowledge an alert."""
    _acknowledged_alerts.add(alert_id)
    return {"status": "acknowledged", "alert_id": alert_id}


@router.post("/alert/{alert_id}/resolve", dependencies=[Depends(require_operator)])
async def resolve_alert(alert_id: str):
    """Resolve an alert (removes from acknowledged set)."""
    _acknowledged_alerts.discard(alert_id)
    return {"status": "resolved", "alert_id": alert_id}
