# content-guard: allow infrastructure/private-ipv4 file
"""Discovery API endpoints for LibreNMS device sync."""

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.config import get_config
from app.discovery import (
    discover_connections,
    discover_physical_devices,
    preview_discovery,
    sync_to_topology,
)


router = APIRouter(prefix="/discovery", tags=["discovery"])


class VMFilter(BaseModel):
    """VM filter rule configuration."""

    type: str  # "subnet" or "os"
    value: str | list[str]
    exclude_if_no_serial: bool = False


class FilterUpdateRequest(BaseModel):
    """Request body for updating VM filters."""

    vm_subnets: list[str] | None = None
    include_types: list[str] | None = None


@router.get("/preview")
async def preview_discovery_endpoint(
    vm_subnets: Annotated[
        str | None,
        Query(description="Comma-separated subnets to exclude (e.g., '10.2.50.0/24')"),
    ] = None,
    include_types: Annotated[
        str | None,
        Query(
            description="Comma-separated device types to include (e.g., 'firewall,network,server')"
        ),
    ] = None,
):
    """
    Preview what devices would be discovered from LibreNMS.

    This is a dry run that shows:
    - All physical devices that would be included
    - How they would be grouped into clusters
    - Summary of what was filtered out

    Does not modify topology.yaml.
    """
    subnets = vm_subnets.split(",") if vm_subnets else None
    types = include_types.split(",") if include_types else None

    return await preview_discovery(subnets, types)


@router.post("/sync")
async def sync_from_librenms(
    vm_subnets: Annotated[
        str | None,
        Query(description="Comma-separated subnets to exclude"),
    ] = None,
    include_types: Annotated[
        str | None,
        Query(description="Comma-separated device types to include"),
    ] = None,
    backup: Annotated[
        bool,
        Query(description="Create backup of existing topology.yaml"),
    ] = True,
    discover_links: Annotated[
        bool,
        Query(description="Auto-discover connections from LibreNMS CDP/LLDP data"),
    ] = True,
):
    """
    Sync physical devices from LibreNMS to topology.yaml.

    This will:
    1. Query all devices from LibreNMS
    2. Filter out VMs (devices in vm_subnets)
    3. Include only specified device types
    4. Generate clusters and devices sections
    5. Auto-discover connections from CDP/LLDP (if enabled)
    6. Preserve manual connections and external_links
    7. Write to topology.yaml (with optional backup)

    Returns sync summary including device and connection counts.
    """
    subnets = vm_subnets.split(",") if vm_subnets else None
    types = include_types.split(",") if include_types else None

    return await sync_to_topology(subnets, types, backup=backup, discover_links=discover_links)


@router.get("/devices")
async def list_discovered_devices(
    vm_subnets: Annotated[
        str | None,
        Query(description="Comma-separated subnets to exclude"),
    ] = None,
    include_types: Annotated[
        str | None,
        Query(description="Comma-separated device types to include"),
    ] = None,
):
    """
    List all physical devices discovered from LibreNMS.

    Returns device details including:
    - Generated device ID
    - LibreNMS hostname and ID
    - Device type, model, location
    - Current status
    """
    subnets = vm_subnets.split(",") if vm_subnets else None
    types = include_types.split(",") if include_types else None

    return await discover_physical_devices(subnets, types)


@router.get("/connections")
async def preview_connections(
    vm_subnets: Annotated[
        str | None,
        Query(description="Comma-separated subnets to exclude"),
    ] = None,
    include_types: Annotated[
        str | None,
        Query(description="Comma-separated device types to include"),
    ] = None,
):
    """
    Preview connections that would be discovered from LibreNMS CDP/LLDP data.

    Returns a list of connections with source/target device and port info.
    Does not modify topology.yaml.
    """
    subnets = vm_subnets.split(",") if vm_subnets else None
    types = include_types.split(",") if include_types else None

    # First discover devices
    result = await discover_physical_devices(subnets, types)

    if not result["devices"]:
        return {
            "connections": [],
            "summary": {"total": 0, "note": "No devices discovered to find connections for"},
        }

    # Then discover connections between them
    connections = await discover_connections(result["devices"])

    return {
        "connections": connections,
        "summary": {
            "total": len(connections),
            "devices_checked": len(result["devices"]),
        },
    }


@router.get("/filters")
async def get_discovery_filters():
    """
    Get current discovery filter configuration.

    Returns the configured vm_subnets and include_types from config.yaml.
    """
    config = get_config()
    discovery_config = getattr(config, "discovery", None)

    if discovery_config:
        return {
            "vm_subnets": discovery_config.vm_subnets,
            "include_types": discovery_config.include_types,
            "auto_sync": discovery_config.auto_sync,
            "sync_interval": discovery_config.sync_interval,
        }

    # Return defaults if discovery not configured
    return {
        "vm_subnets": ["10.2.50.0/24"],
        "include_types": ["firewall", "network", "server", "wireless"],
        "auto_sync": False,
        "sync_interval": 3600,
        "note": "Discovery section not found in config.yaml, using defaults",
    }


@router.get("/type-mapping")
async def get_type_mapping():
    """
    Get the LibreNMS OS to device type mapping.

    Useful for understanding how devices are categorized.
    """
    from app.discovery.librenms_sync import OS_TYPE_MAP, TYPE_CLUSTER_MAP

    return {
        "os_to_type": OS_TYPE_MAP,
        "type_to_cluster": TYPE_CLUSTER_MAP,
    }
