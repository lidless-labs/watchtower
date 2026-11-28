"""
Data Aggregator

Merges topology.yaml structure with live data from LibreNMS cache.
topology.yaml defines WHAT exists; LibreNMS provides live status.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from app.cache import redis_cache
from app.config import get_topology_config
from app.models.device import Device, DeviceStatus, DeviceType, DeviceStats
from app.models.topology import Topology, Cluster, Position
from app.models.connection import Connection, ExternalLink, ConnectionEndpoint, ExternalTarget, ConnectionType, ConnectionStatus
from app.models.device import Interface, ProxmoxStats
from app.models.vlan import (
    Vlan, VlanMembership, L3Topology, L3TopologyNode, L3TopologyVlanGroup
)
from app.polling.scheduler import (
    CACHE_DEVICES, CACHE_ALERTS, CACHE_ALERT_ACK_OVERLAY, CACHE_HEALTH, CACHE_LINKS,
    CACHE_PROXMOX, CACHE_PROXMOX_VMS, CACHE_VLANS, CACHE_VLAN_MEMBERSHIPS
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Device Matching
# ─────────────────────────────────────────────────────────────────────────────


def match_librenms_device(
    device_id: str,
    device_config: dict[str, Any],
    librenms_by_ip: dict[str, dict],
    librenms_by_hostname: dict[str, dict],
) -> dict[str, Any] | None:
    """
    Match a topology device to its LibreNMS counterpart.

    Matching priority:
    1. Explicit librenms_hostname field in topology.yaml
    2. IP address match
    3. Hostname contains device_id (fuzzy)
    """
    # 1. Explicit mapping via librenms_hostname
    explicit_hostname = device_config.get("librenms_hostname")
    if explicit_hostname:
        lower_hostname = explicit_hostname.lower()
        if lower_hostname in librenms_by_hostname:
            return librenms_by_hostname[lower_hostname]

    # 2. IP address match
    device_ip = device_config.get("ip")
    if device_ip and device_ip in librenms_by_ip:
        return librenms_by_ip[device_ip]

    # 3. Fuzzy hostname match (device_id appears in LibreNMS hostname)
    for hostname, data in librenms_by_hostname.items():
        # Check if device_id is in hostname (e.g., "cat-1" in "cat-1.domain.com")
        if device_id.lower() in hostname.lower():
            return data

    return None


def build_librenms_indexes(
    devices: list[dict[str, Any]]
) -> tuple[dict[str, dict], dict[str, dict]]:
    """Build lookup indexes for LibreNMS devices by IP and hostname."""
    by_ip: dict[str, dict] = {}
    by_hostname: dict[str, dict] = {}

    for device in devices:
        ip = device.get("ip")
        hostname = device.get("hostname")

        if ip:
            by_ip[ip] = device
        if hostname:
            by_hostname[hostname.lower()] = device

    return by_ip, by_hostname


# ─────────────────────────────────────────────────────────────────────────────
# Status Mapping
# ─────────────────────────────────────────────────────────────────────────────


def librenms_status_to_device_status(status: str | None) -> DeviceStatus:
    """Convert LibreNMS status string to DeviceStatus enum."""
    if status == "up":
        return DeviceStatus.UP
    elif status == "down":
        return DeviceStatus.DOWN
    else:
        return DeviceStatus.UNKNOWN


def match_proxmox_node(
    librenms_data: dict[str, Any] | None,
    proxmox_nodes: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """
    Match a LibreNMS device to its Proxmox node counterpart.

    Proxmox hosts typically have sysName like "pve1" or "pve1.domain.com".
    We match against the Proxmox node name (e.g., "pve1").
    """
    if not librenms_data:
        return None

    sysname = librenms_data.get("sysName") or ""
    hostname = librenms_data.get("hostname") or ""

    # Extract base name (e.g., "pve1" from "pve1.domain.com")
    sysname_base = sysname.split(".")[0].lower()
    hostname_base = hostname.split(".")[0].lower()

    for node_key, node_data in proxmox_nodes.items():
        node_name = node_data.get("node", "").lower()

        # Direct match
        if node_name == sysname_base or node_name == hostname_base:
            return node_data

        # Handle multi-instance keys like "secondary:pve2"
        if ":" in node_key:
            _, actual_node = node_key.split(":", 1)
            if actual_node.lower() == sysname_base or actual_node.lower() == hostname_base:
                return node_data

    return None


def match_proxmox_node_by_name(
    device_id: str,
    device_config: dict[str, Any],
    proxmox_nodes: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """
    Match a topology device to a Proxmox node by device_id or display_name.

    This is used to determine if a device is a Proxmox host and should show
    the ProxmoxPanel with VMs, LXCs, and storage.

    Matching strategies (in order):
    1. Exact match on device_id == node name
    2. Normalized match (remove spaces, dashes, underscores, lowercase)
    3. Partial match on node name only (not instance - too generic like "primary")
    """
    display_name = device_config.get("display_name", device_id)

    # Normalize for fuzzy matching
    def normalize(s: str) -> str:
        return s.lower().replace(" ", "").replace("-", "").replace("_", "")

    device_id_norm = normalize(device_id)
    display_name_norm = normalize(display_name)

    for key, data in proxmox_nodes.items():
        node_name = data.get("node", "")
        node_norm = normalize(node_name)

        # Skip empty node names
        if not node_norm:
            continue

        # Strategy 1: Exact match on device_id or display_name
        if device_id == node_name or display_name == node_name:
            return data

        # Strategy 2: Normalized exact match
        if device_id_norm == node_norm or display_name_norm == node_norm:
            return data

        # Strategy 3: Partial match - node name must be in device_id/display_name
        # Only match if node_name is reasonably specific (at least 4 chars)
        # and matches at word boundary-ish positions
        if len(node_norm) >= 4:
            # Check if node name appears as a significant part of device_id/display_name
            if device_id_norm.startswith(node_norm) or device_id_norm.endswith(node_norm):
                return data
            if display_name_norm.startswith(node_norm) or display_name_norm.endswith(node_norm):
                return data

    return None


def cluster_type_to_device_type(cluster_type: str) -> DeviceType:
    """Convert cluster type to device type."""
    mapping = {
        "firewall": DeviceType.FIREWALL,
        "switch": DeviceType.SWITCH,
        "router": DeviceType.ROUTER,
        "server": DeviceType.SERVER,
        "access_point": DeviceType.ACCESS_POINT,
    }
    return mapping.get(cluster_type, DeviceType.OTHER)


# ─────────────────────────────────────────────────────────────────────────────
# Aggregation
# ─────────────────────────────────────────────────────────────────────────────


async def get_aggregated_topology() -> Topology:
    """
    Build topology by merging topology.yaml with cached LibreNMS data.

    Returns a Topology object with:
    - Structure from topology.yaml (clusters, connections, external links)
    - Live status from LibreNMS cache (up/down, uptime, last_polled)
    """
    # Load topology definition
    topo_config = get_topology_config()

    # Load cached LibreNMS data
    librenms_devices = await redis_cache.get_json(CACHE_DEVICES) or []
    librenms_alerts = await redis_cache.get_json(CACHE_ALERTS) or []
    ack_overlay_ids = await redis_cache.smembers(CACHE_ALERT_ACK_OVERLAY)
    health_data = await redis_cache.get_json(CACHE_HEALTH) or {}

    # Load cached Proxmox data (fallback for Linux hosts and for proxmox_stats)
    proxmox_nodes = await redis_cache.get_json(CACHE_PROXMOX) or {}
    proxmox_vms = await redis_cache.get_json(CACHE_PROXMOX_VMS) or []

    # Build lookup indexes
    by_ip, by_hostname = build_librenms_indexes(librenms_devices)

    # Device alert_count tracks unresolved alerts, including acknowledged ones.
    alerts_by_device: dict[int, int] = {}
    for alert in librenms_alerts:
        if alert.get("state") not in (1, 2):
            continue
        device_id = alert.get("device_id")
        if device_id:
            alerts_by_device[device_id] = alerts_by_device.get(device_id, 0) + 1

    # Build devices dict
    devices: dict[str, Device] = {}
    device_configs = topo_config.get("devices", {})
    cluster_configs = topo_config.get("clusters", [])

    # Create device ID to cluster mappings
    device_cluster_type: dict[str, str] = {}
    device_cluster_id: dict[str, str] = {}
    for cluster in cluster_configs:
        cluster_id = cluster.get("id")
        cluster_type = cluster.get("type", "other")
        for device_id in cluster.get("devices", []):
            device_cluster_type[device_id] = cluster_type
            device_cluster_id[device_id] = cluster_id

    # Build Device objects
    for device_id, config in device_configs.items():
        # Find matching LibreNMS device
        librenms_data = match_librenms_device(device_id, config, by_ip, by_hostname)

        # Determine status and gather live data
        if librenms_data:
            status = librenms_status_to_device_status(librenms_data.get("status"))
            uptime = librenms_data.get("uptime", 0)
            last_polled = librenms_data.get("last_polled")
            librenms_device_id = librenms_data.get("device_id")
            alert_count = alerts_by_device.get(librenms_device_id, 0)

            # Get health data (CPU/memory)
            device_health = health_data.get(str(librenms_device_id), {})
            cpu = device_health.get("cpu") or 0.0
            memory = device_health.get("memory") or 0.0

            # Fallback to Proxmox data for Linux hosts (LibreNMS health is empty)
            if cpu == 0.0 and memory == 0.0 and proxmox_nodes:
                proxmox_match = match_proxmox_node(librenms_data, proxmox_nodes)
                if proxmox_match:
                    cpu = proxmox_match.get("cpu") or 0.0
                    memory = proxmox_match.get("memory") or 0.0

            # Get cached interfaces
            interfaces = await _get_device_interfaces(librenms_device_id)
        else:
            status = DeviceStatus.UNKNOWN
            uptime = 0
            last_polled = None
            alert_count = 0
            cpu = 0.0
            memory = 0.0
            interfaces = []
            librenms_device_id = None

        # Build device
        cluster_type = device_cluster_type.get(device_id, "other")

        # Check if this device is a Proxmox node - compute proxmox_stats
        proxmox_stats = None
        if proxmox_nodes:
            proxmox_match = match_proxmox_node_by_name(device_id, config, proxmox_nodes)
            if proxmox_match:
                # Count VMs and containers for this node
                node_name = proxmox_match.get("node", "")
                instance_name = proxmox_match.get("instance", "")

                vms_running = 0
                vms_stopped = 0
                containers_running = 0
                containers_stopped = 0

                for vm in proxmox_vms:
                    vm_node = vm.get("node", "")
                    vm_instance = vm.get("instance", "")

                    # Match by node name AND instance (both must match for cluster nodes)
                    if vm_node == node_name and vm_instance == instance_name:
                        if vm.get("type") == "lxc":
                            if vm.get("status") == "running":
                                containers_running += 1
                            else:
                                containers_stopped += 1
                        else:  # qemu
                            if vm.get("status") == "running":
                                vms_running += 1
                            else:
                                vms_stopped += 1

                proxmox_stats = ProxmoxStats(
                    vms_running=vms_running,
                    vms_stopped=vms_stopped,
                    containers_running=containers_running,
                    containers_stopped=containers_stopped,
                )

        devices[device_id] = Device(
            id=device_id,
            display_name=config.get("display_name", device_id),
            model=config.get("model"),
            device_type=cluster_type_to_device_type(cluster_type),
            ip=config.get("ip"),
            location=config.get("location"),
            status=status,
            cluster_id=device_cluster_id.get(device_id),
            stats=DeviceStats(uptime=uptime or 0, cpu=cpu, memory=memory),
            interfaces=interfaces,
            proxmox_stats=proxmox_stats,
            alert_count=alert_count,
            last_seen=datetime.fromisoformat(last_polled) if last_polled else None,
            librenms_device_id=librenms_device_id,
        )

    # Build clusters
    clusters: list[Cluster] = []
    for cluster_config in cluster_configs:
        cluster_device_ids = cluster_config.get("devices", [])
        cluster_devices = [devices[d] for d in cluster_device_ids if d in devices]

        # Aggregate cluster status from devices
        statuses = [d.status for d in cluster_devices]
        if not statuses:
            cluster_status = "unknown"
        elif all(s == DeviceStatus.UP for s in statuses):
            cluster_status = "up"
        elif all(s == DeviceStatus.DOWN for s in statuses):
            cluster_status = "down"
        elif any(s == DeviceStatus.DOWN for s in statuses):
            cluster_status = "degraded"
        elif all(s == DeviceStatus.UNKNOWN for s in statuses):
            cluster_status = "unknown"
        else:
            cluster_status = "up"

        pos = cluster_config.get("position", {"x": 0, "y": 0})
        clusters.append(Cluster(
            id=cluster_config["id"],
            name=cluster_config["name"],
            cluster_type=cluster_config.get("type", "other"),
            icon=cluster_config.get("icon", "server"),
            position=Position(x=pos.get("x", 0), y=pos.get("y", 0)),
            device_ids=cluster_device_ids,
            status=cluster_status,
        ))

    # Build bidirectional mappings between topology device IDs and LibreNMS device IDs
    topo_to_librenms: dict[str, int] = {}
    librenms_to_topo: dict[int, str] = {}
    for topo_device_id, config in device_configs.items():
        librenms_data = match_librenms_device(topo_device_id, config, by_ip, by_hostname)
        if librenms_data:
            librenms_id = librenms_data.get("device_id")
            topo_to_librenms[topo_device_id] = librenms_id
            librenms_to_topo[librenms_id] = topo_device_id

    # Build connections from discovered CDP/LLDP links
    connections: list[Connection] = []
    seen_connection_ids: set[str] = set()  # Track by connection ID
    seen_ports: set[tuple[str, str]] = set()  # Track (device, port) pairs used by CDP/LLDP

    cached_links = await redis_cache.get_json(CACHE_LINKS) or []

    for link in cached_links:
        local_librenms_id = link.get("local_device_id")
        remote_librenms_id = link.get("remote_device_id")

        # Map LibreNMS device IDs to topology device IDs
        source_topo_id = librenms_to_topo.get(local_librenms_id)
        target_topo_id = librenms_to_topo.get(remote_librenms_id)

        # Skip if either device isn't in our topology
        if not source_topo_id or not target_topo_id:
            continue

        local_port = link.get("local_port")
        remote_port = link.get("remote_port")

        # Create unique connection ID based on ports
        conn_id = f"link-{source_topo_id}-{target_topo_id}"
        if local_port:
            # Use port info for more specific ID to allow multiple links
            port_suffix = local_port.replace("/", "-").replace(" ", "_")
            conn_id = f"cdp-{source_topo_id}-{port_suffix}"

        # Skip if this exact connection ID already seen
        if conn_id in seen_connection_ids:
            continue
        seen_connection_ids.add(conn_id)

        # Track this port as used by CDP/LLDP discovery
        if local_port:
            seen_ports.add((source_topo_id, local_port))
        if remote_port:
            seen_ports.add((target_topo_id, remote_port))

        # Get utilization from source port interface
        utilization = await _get_port_utilization(local_librenms_id, local_port)

        # Determine connection status based on device status
        source_device = devices.get(source_topo_id)
        target_device = devices.get(target_topo_id)
        if source_device and target_device:
            if source_device.status == DeviceStatus.DOWN or target_device.status == DeviceStatus.DOWN:
                conn_status = ConnectionStatus.DOWN
            elif source_device.status == DeviceStatus.UNKNOWN or target_device.status == DeviceStatus.UNKNOWN:
                conn_status = ConnectionStatus.UNKNOWN
            else:
                conn_status = ConnectionStatus.UP
        else:
            conn_status = ConnectionStatus.UNKNOWN

        connections.append(Connection(
            id=conn_id,
            source=ConnectionEndpoint(
                device=source_topo_id,
                port=local_port,
            ),
            target=ConnectionEndpoint(
                device=target_topo_id,
                port=remote_port,
            ),
            connection_type=ConnectionType.TRUNK,
            speed=10000,  # Default to 10Gbps for discovered links
            status=conn_status,
            utilization=utilization,
        ))

    # Add static connections from topology.yaml (for devices without CDP/LLDP)
    for conn_config in topo_config.get("connections", []):
        source_cfg = conn_config.get("source", {})
        target_cfg = conn_config.get("target", {})

        source_device = source_cfg.get("device")
        target_device = target_cfg.get("device")

        # Skip if devices don't exist in our topology
        if not source_device or not target_device:
            continue
        if source_device not in devices or target_device not in devices:
            continue

        source_port = source_cfg.get("port")
        target_port = target_cfg.get("port")
        conn_id = conn_config.get("id", f"static-{source_device}-{target_device}")

        # Skip if this exact connection ID already seen
        if conn_id in seen_connection_ids:
            continue

        # Skip if this port was already discovered via CDP/LLDP
        if source_port and (source_device, source_port) in seen_ports:
            continue
        if target_port and (target_device, target_port) in seen_ports:
            continue

        seen_connection_ids.add(conn_id)

        # Determine connection status based on device status
        source_dev = devices.get(source_device)
        target_dev = devices.get(target_device)
        if source_dev and target_dev:
            if source_dev.status == DeviceStatus.DOWN or target_dev.status == DeviceStatus.DOWN:
                conn_status = ConnectionStatus.DOWN
            elif source_dev.status == DeviceStatus.UNKNOWN or target_dev.status == DeviceStatus.UNKNOWN:
                conn_status = ConnectionStatus.UNKNOWN
            else:
                conn_status = ConnectionStatus.UP
        else:
            conn_status = ConnectionStatus.UNKNOWN

        # Map connection type string to enum
        conn_type_str = conn_config.get("connection_type", "trunk").lower()
        conn_type_map = {
            "trunk": ConnectionType.TRUNK,
            "access": ConnectionType.ACCESS,
            "uplink": ConnectionType.UPLINK,
            "stack": ConnectionType.STACK,
            "peer": ConnectionType.PEER,
            "management": ConnectionType.MANAGEMENT,
        }
        conn_type = conn_type_map.get(conn_type_str, ConnectionType.TRUNK)

        # Get utilization for source port if possible
        source_librenms_id = topo_to_librenms.get(source_device)
        utilization = await _get_port_utilization(source_librenms_id, source_port)

        connections.append(Connection(
            id=conn_id,
            source=ConnectionEndpoint(
                device=source_device,
                port=source_port,
            ),
            target=ConnectionEndpoint(
                device=target_device,
                port=target_port,
            ),
            connection_type=conn_type,
            speed=conn_config.get("speed", 1000),
            status=conn_status,
            utilization=utilization,
            description=conn_config.get("description"),
        ))

    # Build external links
    external_links: list[ExternalLink] = []
    for link_config in topo_config.get("external_links", []):
        source_cfg = link_config.get("source", {})
        target_cfg = link_config.get("target", {})

        external_links.append(ExternalLink(
            id=link_config["id"],
            source=ConnectionEndpoint(
                device=source_cfg.get("device"),
                port=source_cfg.get("port"),
                label=source_cfg.get("label"),
            ),
            target=ExternalTarget(
                label=target_cfg.get("label", "Unknown"),
                type=target_cfg.get("type", "cloud"),
                icon=target_cfg.get("icon", "cloud"),
            ),
            provider=link_config.get("provider"),
            circuit_id=link_config.get("circuit_id"),
            speed=link_config.get("speed", 1000),
        ))

    # Calculate totals
    total_devices = len(devices)
    devices_up = sum(1 for d in devices.values() if d.status == DeviceStatus.UP)
    devices_down = sum(1 for d in devices.values() if d.status == DeviceStatus.DOWN)
    active_alerts = sum(
        1
        for alert in librenms_alerts
        if alert.get("state") == 1 and str(alert.get("id")) not in ack_overlay_ids
    )

    return Topology(
        devices=devices,
        clusters=clusters,
        connections=connections,
        external_links=external_links,
        total_devices=total_devices,
        devices_up=devices_up,
        devices_down=devices_down,
        active_alerts=active_alerts,
    )


async def _get_port_utilization(librenms_device_id: int | None, port_name: str | None) -> float:
    """
    Get utilization percentage for a specific port on a device.

    Matches port by name (e.g., "Gi0/1", "eth0", "GigabitEthernet0/0/1").
    """
    if not librenms_device_id or not port_name:
        return 0.0

    cache_key = f"watchtower:interfaces:{librenms_device_id}"
    cached = await redis_cache.get_json(cache_key)

    if not cached:
        return 0.0

    # Normalize port name for matching (case-insensitive, handle abbreviations)
    port_lower = port_name.lower()

    for port in cached:
        cached_name = (port.get("name") or "").lower()
        cached_alias = (port.get("alias") or "").lower()

        # Try exact match first
        if cached_name == port_lower or cached_alias == port_lower:
            return _calculate_utilization(port)

        # Try partial match (e.g., "Gi0/1" matches "GigabitEthernet0/1")
        if port_lower in cached_name or cached_name in port_lower:
            return _calculate_utilization(port)

    return 0.0


def _calculate_utilization(port: dict) -> float:
    """Calculate utilization percentage from port data."""
    speed = port.get("speed") or 0  # bits per second
    in_rate = port.get("in_rate") or 0  # bytes per second
    out_rate = port.get("out_rate") or 0

    if speed <= 0:
        return 0.0

    # Convert bytes/s to bits/s
    in_bps = in_rate * 8
    out_bps = out_rate * 8

    # Utilization is the higher of in/out as percentage of speed
    return round(max(in_bps, out_bps) / speed * 100, 2)


async def _get_device_interfaces(librenms_device_id: int) -> list[Interface]:
    """
    Get cached interfaces for a device and convert to Interface models.
    """
    cache_key = f"watchtower:interfaces:{librenms_device_id}"
    cached = await redis_cache.get_json(cache_key)

    if not cached:
        return []

    interfaces = []
    for port in cached:
        # Calculate utilization if we have speed and rates
        speed = port.get("speed") or 0  # bits per second
        in_rate = port.get("in_rate") or 0  # bytes per second
        out_rate = port.get("out_rate") or 0

        # Convert bytes/s to bits/s for utilization calc
        in_bps = int(in_rate * 8)
        out_bps = int(out_rate * 8)

        # Utilization is the higher of in/out as percentage of speed
        if speed > 0:
            utilization = max(in_bps, out_bps) / speed * 100
        else:
            utilization = 0.0

        # Map status string to enum
        status_str = (port.get("status") or "").lower()
        if status_str == "up":
            if_status = DeviceStatus.UP
        elif status_str == "down":
            if_status = DeviceStatus.DOWN
        else:
            if_status = DeviceStatus.UNKNOWN

        interfaces.append(Interface(
            name=port.get("name") or f"port-{port.get('port_id')}",
            status=if_status,
            admin_status=port.get("admin_status"),
            alias=port.get("alias"),
            speed=speed // 1_000_000 if speed else 0,  # Convert to Mbps
            in_bps=in_bps,
            out_bps=out_bps,
            utilization=round(utilization, 2),
            errors_in=int(port.get("in_errors") or 0),
            errors_out=int(port.get("out_errors") or 0),
        ))

    return interfaces


async def get_device_with_live_data(device_id: str) -> Device | None:
    """Get a single device with live data merged in."""
    topology = await get_aggregated_topology()
    return topology.devices.get(device_id)


async def get_l3_topology() -> L3Topology:
    """
    Build L3 topology view grouped by VLAN.

    Returns an L3Topology with:
    - List of all VLANs with device counts
    - List of all VLAN memberships mapped to topology device IDs
    - VLAN groups with devices grouped by VLAN membership
    - Gateway devices (devices participating in multiple VLANs)
    """
    # Load topology config for device ID mapping
    topo_config = get_topology_config()
    device_configs = topo_config.get("devices", {})

    # Load cached data
    librenms_devices = await redis_cache.get_json(CACHE_DEVICES) or []
    vlans_data = await redis_cache.get_json(CACHE_VLANS) or []
    memberships_data = await redis_cache.get_json(CACHE_VLAN_MEMBERSHIPS) or []

    # Build LibreNMS ID to topology ID mapping
    by_ip, by_hostname = build_librenms_indexes(librenms_devices)
    librenms_to_topo: dict[int, str] = {}
    for topo_device_id, config in device_configs.items():
        librenms_data = match_librenms_device(topo_device_id, config, by_ip, by_hostname)
        if librenms_data:
            librenms_id = librenms_data.get("device_id")
            librenms_to_topo[librenms_id] = topo_device_id

    # Build VLAN list
    vlans = [
        Vlan(
            vlan_id=v["vlan_id"],
            vlan_name=v.get("vlan_name"),
            device_count=v.get("device_count", 0),
        )
        for v in vlans_data
    ]

    # Map memberships to topology device IDs
    memberships = []
    device_vlans: dict[str, set[int]] = {}  # Track VLANs per device for gateway detection

    for m in memberships_data:
        librenms_id = m.get("librenms_device_id")
        topo_device_id = librenms_to_topo.get(librenms_id)

        if not topo_device_id:
            continue  # Skip devices not in our topology

        vlan_id = m.get("vlan_id")
        membership = VlanMembership(
            device_id=topo_device_id,
            librenms_device_id=librenms_id,
            port_name=m.get("port_name"),
            vlan_id=vlan_id,
            vlan_name=m.get("vlan_name"),
            is_untagged=m.get("is_untagged", True),
        )
        memberships.append(membership)

        # Track VLANs per device
        if topo_device_id not in device_vlans:
            device_vlans[topo_device_id] = set()
        device_vlans[topo_device_id].add(vlan_id)

    # Identify gateway devices (in multiple VLANs)
    gateway_devices = [
        device_id for device_id, vlan_set in device_vlans.items()
        if len(vlan_set) > 1
    ]

    # Get device status for node building
    topology = await get_aggregated_topology()

    # Build VLAN groups with devices
    vlan_groups = []
    for vlan in vlans:
        # Find all devices in this VLAN
        vlan_device_ids = set()
        for m in memberships:
            if m.vlan_id == vlan.vlan_id:
                vlan_device_ids.add(m.device_id)

        # Build nodes for this VLAN
        nodes = []
        vlan_gateways = []
        for device_id in vlan_device_ids:
            device = topology.devices.get(device_id)
            if not device:
                continue

            is_gateway = device_id in gateway_devices
            node = L3TopologyNode(
                device_id=device_id,
                display_name=device.display_name,
                status=device.status.value,
                is_gateway=is_gateway,
                vlan_ids=list(device_vlans.get(device_id, set())),
            )
            nodes.append(node)

            if is_gateway:
                vlan_gateways.append(device_id)

        vlan_groups.append(L3TopologyVlanGroup(
            vlan_id=vlan.vlan_id,
            vlan_name=vlan.vlan_name,
            devices=nodes,
            gateway_devices=vlan_gateways,
        ))

    return L3Topology(
        vlans=vlans,
        memberships=memberships,
        vlan_groups=vlan_groups,
        gateway_devices=gateway_devices,
    )
