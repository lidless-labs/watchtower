"""Device API routes."""

import hashlib
import json
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from ..auth import require_viewer
from ..cache import redis_cache
from ..models.device import Device, DeviceSummary
from ..models.device_log import DeviceLogEntry
from ..polling import get_aggregated_topology, get_device_with_live_data
from ..polling.librenms import LibreNMSClient
from ..polling.scheduler import CACHE_DEVICES

router = APIRouter()
DEVICE_LOG_CACHE_TTL = 30


@router.get("/devices", response_model=list[DeviceSummary])
async def list_devices():
    """List all devices with summary info."""
    topology = await get_aggregated_topology()
    return [
        DeviceSummary(
            id=device.id,
            display_name=device.display_name,
            device_type=device.device_type,
            status=device.status,
            alert_count=device.alert_count,
        )
        for device in topology.devices.values()
    ]


@router.get("/device/{device_id}", response_model=Device)
async def get_device(device_id: str):
    """Get detailed information about a specific device."""
    device = await get_device_with_live_data(device_id)

    if not device:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found")

    return device


@router.get("/device/{device_id}/interfaces")
async def get_device_interfaces(device_id: str):
    """Get interface details for a device."""
    device = await get_device_with_live_data(device_id)

    if not device:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found")

    return {"device_id": device_id, "interfaces": device.interfaces}


@router.get(
    "/device/{device_id}/logs",
    response_model=list[DeviceLogEntry],
    dependencies=[Depends(require_viewer)],
)
async def get_device_logs(
    device_id: str,
    kind: Literal["eventlog", "syslog", "alertlog"] = Query("eventlog"),
    limit: int = Query(50, ge=1, le=200),
    start: int = Query(0, ge=0, le=10000),
    from_: str | None = Query(None, alias="from", max_length=100),
    to: str | None = Query(None, max_length=100),
) -> list[DeviceLogEntry]:
    """Return a short-cached, read-only LibreNMS log for a known device."""
    device = await get_device_with_live_data(device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found")

    if device.librenms_device_id is None:
        raise HTTPException(status_code=502, detail="Device is not available in LibreNMS")

    librenms_devices = await redis_cache.get_json(CACHE_DEVICES) or []
    librenms_device = next(
        (
            item
            for item in librenms_devices
            if str(item.get("device_id")) == str(device.librenms_device_id)
        ),
        None,
    )
    hostname = (
        librenms_device.get("hostname")
        if librenms_device
        else str(device.librenms_device_id)
    ) or str(device.librenms_device_id)

    cache_parameters = json.dumps(
        [device_id, kind, limit, start, from_, to],
        separators=(",", ":"),
    )
    cache_digest = hashlib.sha256(cache_parameters.encode("utf-8")).hexdigest()
    cache_key = f"watchtower:device_logs:{cache_digest}"
    if from_ is None and to is None:
        try:
            cached = await redis_cache.get_json(cache_key)
        except (TypeError, ValueError):
            cached = None
            await redis_cache.delete(cache_key)
        if cached is not None:
            if isinstance(cached, list):
                try:
                    return [DeviceLogEntry.model_validate(entry) for entry in cached]
                except ValidationError:
                    pass
            await redis_cache.delete(cache_key)

    try:
        async with LibreNMSClient() as client:
            entries = await client.get_device_logs(
                hostname=hostname,
                kind=kind,
                limit=limit,
                start=start,
                from_=from_,
                to=to,
            )
    except (httpx.HTTPError, ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="LibreNMS logs are currently unavailable",
        ) from exc

    if from_ is None and to is None:
        await redis_cache.set(
            cache_key,
            [entry.model_dump() for entry in entries],
            ttl=DEVICE_LOG_CACHE_TTL,
        )
    return entries
