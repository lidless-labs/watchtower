"""Topology API routes."""

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..models.device import DeviceStatus
from ..models.topology import Topology, TopologySummary
from ..models.vlan import L3Topology
from ..polling import get_aggregated_topology
from ..polling.aggregator import get_l3_topology
from ..polling.librenms import LibreNMSClient

router = APIRouter()


class TopInterface(BaseModel):
    """Interface with traffic stats."""
    device: str
    interface: str
    description: str | None = None
    in_mbps: float
    out_mbps: float
    total_mbps: float
    speed_mbps: int | None = None
    utilization_pct: float | None = None


@router.get("/topology", response_model=Topology)
async def get_topology():
    """Get the full network topology with all devices, connections, and stats."""
    return await get_aggregated_topology()


@router.get("/topology/summary", response_model=TopologySummary)
async def get_topology_summary():
    """Get a quick summary of topology stats."""
    topology = await get_aggregated_topology()

    devices_degraded = sum(
        1 for d in topology.devices.values() if d.status == DeviceStatus.DEGRADED
    )

    return TopologySummary(
        total_devices=topology.total_devices,
        devices_up=topology.devices_up,
        devices_down=topology.devices_down,
        devices_degraded=devices_degraded,
        active_alerts=topology.active_alerts,
        critical_alerts=0,
        warning_alerts=0,
    )


@router.get("/topology/l3", response_model=L3Topology)
async def get_l3_topology_endpoint():
    """
    Get L3 (logical) topology view grouped by VLAN.

    Returns VLAN groups with devices, gateway identification,
    and VLAN membership data.
    """
    return await get_l3_topology()


@router.get("/topology/top-interfaces", response_model=list[TopInterface])
async def get_top_interfaces(
    limit: int = Query(default=5, ge=1, le=20, description="Number of top interfaces to return"),
    device_filter: str | None = Query(default=None, description="Filter by device hostname pattern"),
):
    """
    Get top interfaces by bandwidth usage.

    Returns interfaces sorted by total traffic (in + out) in descending order.
    Useful for identifying the busiest network links.
    """
    interfaces: list[TopInterface] = []

    async with LibreNMSClient() as client:
        # Get all devices
        devices = await client.get_devices()

        for device in devices:
            # Prefer sysName over hostname (sysName is usually more readable)
            hostname = device.sysName or device.hostname or str(device.device_id)
            # Remove domain suffix for cleaner display
            if hostname and '.' in hostname:
                hostname = hostname.split('.')[0]

            # Apply device filter if specified
            if device_filter and device_filter.lower() not in hostname.lower():
                continue

            # Get ports for this device
            try:
                ports = await client.get_ports(device.device_id)
            except Exception:
                continue

            for port in ports:
                if_name = port.ifName or ""

                # Skip loopback, null, and management interfaces
                if any(skip in if_name.lower() for skip in ["lo", "null", "mgmt", "vlan", "vl"]):
                    continue

                in_rate = port.ifInOctets_rate or 0
                out_rate = port.ifOutOctets_rate or 0

                # Convert bytes/sec to Mbps
                in_mbps = in_rate * 8 / 1_000_000
                out_mbps = out_rate * 8 / 1_000_000
                total_mbps = in_mbps + out_mbps

                # Only include interfaces with meaningful traffic (> 0.1 Mbps)
                if total_mbps < 0.1:
                    continue

                # Calculate utilization if speed is known
                speed_mbps = port.ifSpeed // 1_000_000 if port.ifSpeed else None
                utilization_pct = None
                if speed_mbps and speed_mbps > 0:
                    utilization_pct = round((total_mbps / speed_mbps) * 100, 1)

                interfaces.append(TopInterface(
                    device=hostname,
                    interface=if_name,
                    description=port.ifAlias or port.ifDescr,
                    in_mbps=round(in_mbps, 2),
                    out_mbps=round(out_mbps, 2),
                    total_mbps=round(total_mbps, 2),
                    speed_mbps=speed_mbps,
                    utilization_pct=utilization_pct,
                ))

    # Sort by total traffic and return top N
    interfaces.sort(key=lambda x: x.total_mbps, reverse=True)
    return interfaces[:limit]
