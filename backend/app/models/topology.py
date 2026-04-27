"""Topology models for Watchtower."""


from pydantic import BaseModel

from .connection import Connection, ExternalLink
from .device import Device


class Position(BaseModel):
    """Canvas position for a cluster."""

    x: float
    y: float


class Cluster(BaseModel):
    """A group of related devices."""

    id: str
    name: str
    cluster_type: str  # firewall, switch, server, network
    icon: str  # shield, switch, server, wifi
    position: Position
    device_ids: list[str] = []
    status: str = "active"  # active, planned


class Topology(BaseModel):
    """Complete network topology."""

    clusters: list[Cluster] = []
    devices: dict[str, Device] = {}
    connections: list[Connection] = []
    external_links: list[ExternalLink] = []

    # Aggregate stats
    total_devices: int = 0
    devices_up: int = 0
    devices_down: int = 0
    active_alerts: int = 0


class TopologySummary(BaseModel):
    """Quick topology stats for header display."""

    total_devices: int = 0
    devices_up: int = 0
    devices_down: int = 0
    devices_degraded: int = 0
    active_alerts: int = 0
    critical_alerts: int = 0
    warning_alerts: int = 0
