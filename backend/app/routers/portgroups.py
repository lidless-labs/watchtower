"""
Port Groups API Router

Endpoints for monitoring aggregate traffic on port groups (e.g., department connections).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import get_config
from app.polling.librenms import LibreNMSClient
from app.safe_exports import validate_csv_export_path

router = APIRouter(prefix="/port-groups", tags=["port-groups"])


class PortGroupStats(BaseModel):
    """Aggregate statistics for a port group."""

    name: str
    description: str
    port_count: int
    active_port_count: int  # Ports that are up
    in_bps: float  # Total inbound bytes per second
    out_bps: float  # Total outbound bytes per second
    in_mbps: float  # Total inbound Mbps
    out_mbps: float  # Total outbound Mbps
    total_mbps: float  # Combined in + out
    status: str  # "ok", "warning", "critical"
    thresholds: dict[str, int]


def bytes_to_mbps(bps: float) -> float:
    """Convert bytes per second to megabits per second."""
    return (bps * 8) / 1_000_000


def get_status(total_mbps: float, warning_mbps: int, critical_mbps: int) -> str:
    """Determine status based on thresholds."""
    if total_mbps >= critical_mbps:
        return "critical"
    elif total_mbps >= warning_mbps:
        return "warning"
    return "ok"


@router.get("")
async def get_port_groups() -> list[PortGroupStats]:
    """
    Get aggregate traffic statistics for all configured port groups.

    Returns traffic rates aggregated across all ports matching each group's alias pattern.
    """
    config = get_config()
    port_groups = config.port_groups

    if not port_groups:
        return []

    # Fetch all ports from LibreNMS
    async with LibreNMSClient() as client:
        all_ports = await client.get_ports()

    results = []

    for group in port_groups:
        # Filter ports matching this group's alias pattern (case-insensitive)
        pattern = group.match_alias.lower()
        matching_ports = [
            p for p in all_ports
            if p.ifAlias and pattern in p.ifAlias.lower()
        ]

        # Calculate aggregates
        port_count = len(matching_ports)
        active_ports = [p for p in matching_ports if p.ifOperStatus == "up"]
        active_port_count = len(active_ports)

        # Sum traffic rates (only from active ports with valid data)
        in_bps = sum(
            p.ifInOctets_rate or 0
            for p in active_ports
        )
        out_bps = sum(
            p.ifOutOctets_rate or 0
            for p in active_ports
        )

        in_mbps = bytes_to_mbps(in_bps)
        out_mbps = bytes_to_mbps(out_bps)
        total_mbps = in_mbps + out_mbps

        # Determine status
        status = get_status(
            total_mbps,
            group.thresholds.warning_mbps,
            group.thresholds.critical_mbps,
        )

        results.append(PortGroupStats(
            name=group.name,
            description=group.description,
            port_count=port_count,
            active_port_count=active_port_count,
            in_bps=in_bps,
            out_bps=out_bps,
            in_mbps=round(in_mbps, 2),
            out_mbps=round(out_mbps, 2),
            total_mbps=round(total_mbps, 2),
            status=status,
            thresholds={
                "warning_mbps": group.thresholds.warning_mbps,
                "critical_mbps": group.thresholds.critical_mbps,
            },
        ))

    return results


@router.get("/export/{group_name}")
async def export_port_group_csv(group_name: str) -> FileResponse:
    """
    Download the CSV history file for a specific port group.

    Args:
        group_name: Name of the port group to export
    """
    config = get_config()

    # Find the matching port group config
    matching_group = None
    for group in config.port_groups:
        if group.name.lower() == group_name.lower():
            matching_group = group
            break

    if not matching_group:
        raise HTTPException(
            status_code=404,
            detail=f"Port group '{group_name}' not found",
        )

    if not matching_group.logging.enabled:
        raise HTTPException(
            status_code=404,
            detail="CSV logging is not enabled for this port group",
        )

    csv_path = validate_csv_export_path(matching_group.logging.path)

    today = datetime.utcnow().strftime("%Y-%m-%d")
    safe_name = group_name.lower().replace(" ", "_")
    return FileResponse(
        path=csv_path,
        filename=f"{safe_name}_traffic_{today}.csv",
        media_type="text/csv",
    )


@router.get("/{group_name}")
async def get_port_group(group_name: str) -> PortGroupStats:
    """
    Get aggregate traffic statistics for a specific port group.

    Args:
        group_name: Name of the port group to query
    """
    all_groups = await get_port_groups()

    for group in all_groups:
        if group.name.lower() == group_name.lower():
            return group

    raise HTTPException(
        status_code=404,
        detail=f"Port group '{group_name}' not found",
    )
