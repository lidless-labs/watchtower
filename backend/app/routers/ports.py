"""
Port Search API Router

Endpoints for searching ports by description/alias across all devices.
"""

from __future__ import annotations


from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.polling.librenms import LibreNMSClient

router = APIRouter(prefix="/ports", tags=["ports"])


class PortSearchResult(BaseModel):
    """Port search result with device context."""

    port_id: int | None
    device_id: int | None
    device_hostname: str | None
    ifName: str | None
    ifAlias: str | None
    ifDescr: str | None
    ifSpeed: int | None  # bits per second
    ifOperStatus: str | None  # up, down
    ifAdminStatus: str | None
    in_mbps: float | None
    out_mbps: float | None


class PortSearchResponse(BaseModel):
    """Response for port search endpoint."""

    query: str
    total: int
    ports: list[PortSearchResult]


def bytes_to_mbps(bps: float | None) -> float | None:
    """Convert bytes per second to megabits per second."""
    if bps is None:
        return None
    return round((bps * 8) / 1_000_000, 2)


@router.get("/search")
async def search_ports(
    q: str = Query(..., min_length=1, description="Search term to match against port alias/description"),
    status: str | None = Query(None, description="Filter by status: up, down, or all"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results to return"),
) -> PortSearchResponse:
    """
    Search ports by alias/description pattern.

    Searches across all LibreNMS ports for matches in ifAlias (port description).
    Useful for finding all ports labeled as "printer", "WAP", "camera", etc.

    Args:
        q: Search term (case-insensitive substring match)
        status: Filter by port status (up/down/all)
        limit: Maximum number of results
    """
    # Fetch all ports from LibreNMS
    async with LibreNMSClient() as client:
        all_ports = await client.get_ports()
        devices = await client.get_devices()

    # Build device lookup for hostname
    device_map = {d.device_id: d.hostname for d in devices}

    # Search term (case-insensitive)
    search_lower = q.lower()

    # Filter ports matching the search term in alias or description
    matching = []
    for p in all_ports:
        # Check both ifAlias and ifDescr
        alias_match = p.ifAlias and search_lower in p.ifAlias.lower()
        descr_match = p.ifDescr and search_lower in p.ifDescr.lower()

        if alias_match or descr_match:
            # Apply status filter if specified
            if status and status != "all":
                if p.ifOperStatus != status:
                    continue

            matching.append(
                PortSearchResult(
                    port_id=p.port_id,
                    device_id=p.device_id,
                    device_hostname=device_map.get(p.device_id) if p.device_id else None,
                    ifName=p.ifName,
                    ifAlias=p.ifAlias,
                    ifDescr=p.ifDescr,
                    ifSpeed=p.ifSpeed,
                    ifOperStatus=p.ifOperStatus,
                    ifAdminStatus=p.ifAdminStatus,
                    in_mbps=bytes_to_mbps(p.ifInOctets_rate),
                    out_mbps=bytes_to_mbps(p.ifOutOctets_rate),
                )
            )

            if len(matching) >= limit:
                break

    # Sort by device hostname, then port name
    matching.sort(key=lambda p: (p.device_hostname or "", p.ifName or ""))

    return PortSearchResponse(
        query=q,
        total=len(matching),
        ports=matching,
    )


@router.get("/aliases")
async def get_port_aliases() -> dict[str, int]:
    """
    Get a summary of unique port alias keywords and their counts.

    Returns a dictionary of common words found in port aliases with counts.
    Useful for discovering what types of ports exist in the network.
    """
    async with LibreNMSClient() as client:
        all_ports = await client.get_ports()

    # Extract words from aliases
    word_counts: dict[str, int] = {}

    for p in all_ports:
        if not p.ifAlias:
            continue

        # Split alias into words, normalize
        words = p.ifAlias.lower().split()
        for word in words:
            # Skip very short words and numbers
            if len(word) < 3 or word.isdigit():
                continue
            word_counts[word] = word_counts.get(word, 0) + 1

    # Sort by count descending, return top entries
    sorted_counts = dict(
        sorted(word_counts.items(), key=lambda x: x[1], reverse=True)[:50]
    )

    return sorted_counts
