"""
LibreNMS Physical Device Discovery

Syncs physical devices from LibreNMS to topology.yaml.
Filters out VMs based on configurable rules.
"""

from __future__ import annotations

import ipaddress
import re
from pathlib import Path
from typing import Any

import yaml

from app.polling.librenms import LibreNMSClient, LibreNMSDevice
from app.config import get_config, get_topology_config, Settings


# LibreNMS OS to topology device type mapping
OS_TYPE_MAP = {
    # Firewalls
    "panos": "firewall",
    "fortigate": "firewall",
    "asa": "firewall",
    "checkpoint": "firewall",
    "pfsense": "firewall",
    "opnsense": "firewall",
    # Network devices
    "iosxe": "network",
    "ios": "network",
    "nxos": "network",
    "junos": "network",
    "aruba-os": "network",
    "arubaos-cx": "network",
    "routeros": "network",
    "edgeos": "network",
    "vyos": "network",
    # Servers / Hypervisors
    "proxmox": "server",
    "vmware": "server",
    "hyperv": "server",
    "esxi": "server",
    "truenas": "server",
    "freenas": "server",
    # Wireless
    "aruba-instant": "wireless",
    "unifi": "wireless",
    "ruckus": "wireless",
    "meraki": "wireless",
}

# Device types to cluster names
TYPE_CLUSTER_MAP = {
    "firewall": {"name": "Firewalls", "icon": "shield"},
    "network": {"name": "Network Devices", "icon": "switch"},
    "server": {"name": "Servers", "icon": "server"},
    "wireless": {"name": "Wireless APs", "icon": "wifi"},
}


def _parse_subnets(subnet_strings: list[str]) -> list[ipaddress.IPv4Network]:
    """Parse subnet strings into IPv4Network objects."""
    networks = []
    for s in subnet_strings:
        try:
            networks.append(ipaddress.IPv4Network(s, strict=False))
        except ValueError:
            continue
    return networks


def _ip_in_subnets(ip: str | None, subnets: list[ipaddress.IPv4Network]) -> bool:
    """Check if an IP address falls within any of the given subnets."""
    if not ip:
        return False
    try:
        addr = ipaddress.IPv4Address(ip)
        return any(addr in subnet for subnet in subnets)
    except ValueError:
        return False


def _clean_device_id(sysname: str | None, hostname: str) -> str:
    """
    Generate clean device ID from sysName or hostname.

    Strips domain, lowercases, replaces special characters with hyphens.
    """
    name = sysname or hostname
    # Strip domain suffix
    name = name.split(".")[0]
    # Lowercase and replace non-alphanumeric with hyphens
    name = re.sub(r"[^a-zA-Z0-9]+", "-", name.lower())
    # Remove leading/trailing hyphens
    name = name.strip("-")
    return name or f"device-{hostname[:8]}"


def _get_device_type(device: LibreNMSDevice, include_types: list[str]) -> str | None:
    """
    Determine device type from LibreNMS OS field.

    Returns None if device type is not in include_types.
    """
    os_lower = (device.os or "").lower()
    device_type = OS_TYPE_MAP.get(os_lower)

    if device_type and device_type in include_types:
        return device_type

    # Fallback: check hardware field for clues
    hardware_lower = (device.hardware or "").lower()
    if "palo" in hardware_lower or "pa-" in hardware_lower:
        return "firewall" if "firewall" in include_types else None
    if "catalyst" in hardware_lower or "switch" in hardware_lower:
        return "network" if "network" in include_types else None
    if "poweredge" in hardware_lower or "proliant" in hardware_lower:
        return "server" if "server" in include_types else None

    return None


def _group_by_cluster(
    devices: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Group devices into clusters by type."""
    clusters: dict[str, list[dict[str, Any]]] = {}

    for device in devices:
        device_type = device.get("type", "unknown")
        cluster_key = device_type

        if cluster_key not in clusters:
            clusters[cluster_key] = []
        clusters[cluster_key].append(device)

    return clusters


async def discover_physical_devices(
    vm_subnets: list[str] | None = None,
    include_types: list[str] | None = None,
) -> dict[str, Any]:
    """
    Discover physical devices from LibreNMS.

    Args:
        vm_subnets: List of subnets to exclude (e.g., ["10.2.50.0/24"])
        include_types: Device types to include (default: firewall, network, server, wireless)

    Returns:
        Dict with 'devices' list and 'summary' stats
    """
    config = get_config()
    discovery_config = getattr(config, "discovery", None)

    # Use config defaults if not provided
    if vm_subnets is None:
        vm_subnets = (
            discovery_config.vm_subnets if discovery_config else ["10.2.50.0/24"]
        )
    if include_types is None:
        include_types = (
            discovery_config.include_types
            if discovery_config
            else ["firewall", "network", "server", "wireless"]
        )

    subnets = _parse_subnets(vm_subnets)

    async with LibreNMSClient() as client:
        all_devices = await client.get_devices()

    discovered = []
    filtered_out = {"vm_subnet": 0, "wrong_type": 0, "no_ip": 0}

    for device in all_devices:
        # Skip devices without IP
        if not device.ip:
            filtered_out["no_ip"] += 1
            continue

        # Skip devices in VM subnets
        if _ip_in_subnets(device.ip, subnets):
            filtered_out["vm_subnet"] += 1
            continue

        # Determine device type
        device_type = _get_device_type(device, include_types)
        if not device_type:
            filtered_out["wrong_type"] += 1
            continue

        device_id = _clean_device_id(device.sysName, device.hostname)

        discovered.append(
            {
                "id": device_id,
                "librenms_id": device.device_id,
                "librenms_hostname": device.hostname,
                "display_name": device.sysName or device.hostname,
                "type": device_type,
                "ip": device.ip,
                "model": device.hardware,
                "os": device.os,
                "location": device.location,
                "status": "up" if device.status == 1 else "down",
            }
        )

    return {
        "devices": discovered,
        "summary": {
            "total_in_librenms": len(all_devices),
            "discovered": len(discovered),
            "filtered_out": filtered_out,
        },
    }


async def preview_discovery(
    vm_subnets: list[str] | None = None,
    include_types: list[str] | None = None,
) -> dict[str, Any]:
    """
    Preview what devices would be discovered (dry run).

    Returns discovery results plus proposed cluster structure.
    """
    result = await discover_physical_devices(vm_subnets, include_types)
    devices = result["devices"]

    # Group into clusters
    grouped = _group_by_cluster(devices)

    clusters = []
    for device_type, type_devices in grouped.items():
        cluster_meta = TYPE_CLUSTER_MAP.get(
            device_type, {"name": device_type.title(), "icon": "server"}
        )
        clusters.append(
            {
                "id": f"{device_type}s",
                "name": cluster_meta["name"],
                "type": device_type,
                "icon": cluster_meta["icon"],
                "device_count": len(type_devices),
                "devices": [d["id"] for d in type_devices],
            }
        )

    return {
        **result,
        "proposed_clusters": clusters,
    }


async def discover_connections(
    discovered_devices: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Discover connections between devices using LibreNMS CDP/LLDP data.

    Args:
        discovered_devices: List of discovered devices with their LibreNMS info

    Returns:
        List of connection dicts ready for topology.yaml
    """
    # Build lookup maps for device matching
    librenms_id_to_device = {}
    hostname_to_device = {}
    ip_to_device = {}

    for device in discovered_devices:
        librenms_id_to_device[device["librenms_id"]] = device
        hostname_to_device[device["librenms_hostname"].lower()] = device
        if device.get("ip"):
            ip_to_device[device["ip"]] = device

    # Fetch all links from LibreNMS
    async with LibreNMSClient() as client:
        all_links = await client.get_all_links()

    connections = []
    seen_pairs = set()  # Avoid duplicate connections (A->B and B->A)

    for link in all_links:
        # Find source device
        source_device = librenms_id_to_device.get(link.local_device_id)
        if not source_device:
            continue

        # Find target device by remote_device_id or remote_hostname
        target_device = None
        if link.remote_device_id:
            target_device = librenms_id_to_device.get(link.remote_device_id)

        if not target_device and link.remote_hostname:
            # Try exact match, then lowercase match
            remote_host_lower = link.remote_hostname.lower()
            target_device = hostname_to_device.get(remote_host_lower)

            # Try stripping domain
            if not target_device and "." in remote_host_lower:
                short_name = remote_host_lower.split(".")[0]
                for hostname, dev in hostname_to_device.items():
                    if hostname.split(".")[0] == short_name:
                        target_device = dev
                        break

        if not target_device:
            continue  # Remote device not in our discovered set

        # Create normalized pair key to avoid duplicates
        pair_key = tuple(sorted([source_device["id"], target_device["id"]]))
        if pair_key in seen_pairs:
            continue
        seen_pairs.add(pair_key)

        # Generate connection ID
        conn_id = f"{source_device['id']}-to-{target_device['id']}"

        # Build connection entry
        connection = {
            "id": conn_id,
            "source": {
                "device": source_device["id"],
                "port": link.local_port or "unknown",
            },
            "target": {
                "device": target_device["id"],
                "port": link.remote_port or "unknown",
            },
            "auto_discovered": True,  # Mark as auto-discovered
        }

        # Add protocol info if available
        if link.protocol:
            connection["discovery_protocol"] = link.protocol

        connections.append(connection)

    return connections


def _merge_connections(
    discovered: list[dict[str, Any]],
    existing: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """
    Merge discovered connections with existing manual connections.

    - Auto-discovered connections (auto_discovered: true) are replaced
    - Manual connections (no auto_discovered flag) are preserved
    """
    if not existing:
        return discovered

    # Keep manual connections (those without auto_discovered flag)
    manual_connections = [
        conn for conn in existing
        if not conn.get("auto_discovered", False)
    ]

    # Also keep manual connections that don't conflict with discovered ones
    final_manual = []
    for conn in manual_connections:
        # Check if this manual connection conflicts with a discovered one
        # by comparing device pairs
        source_dev = conn.get("source", {}).get("device")
        target_dev = conn.get("target", {}).get("device")
        if source_dev and target_dev:
            pair = tuple(sorted([source_dev, target_dev]))
            # Check if discovered connections have this pair
            conflict = False
            for disc_conn in discovered:
                disc_source = disc_conn.get("source", {}).get("device")
                disc_target = disc_conn.get("target", {}).get("device")
                if disc_source and disc_target:
                    disc_pair = tuple(sorted([disc_source, disc_target]))
                    if pair == disc_pair:
                        conflict = True
                        break
            if not conflict:
                final_manual.append(conn)
        else:
            # Keep connections without proper device refs (shouldn't happen)
            final_manual.append(conn)

    return discovered + final_manual


def _build_topology_yaml(
    devices: list[dict[str, Any]],
    existing_topology: dict[str, Any] | None = None,
    connections: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Build topology.yaml structure from discovered devices.

    Preserves connections and external_links from existing topology if present.
    """
    grouped = _group_by_cluster(devices)

    # Build clusters section
    clusters = []
    y_position = 50
    for device_type, type_devices in grouped.items():
        cluster_meta = TYPE_CLUSTER_MAP.get(
            device_type, {"name": device_type.title(), "icon": "server"}
        )
        clusters.append(
            {
                "id": f"{device_type}s",
                "name": cluster_meta["name"],
                "type": device_type,
                "icon": cluster_meta["icon"],
                "position": {"x": 400, "y": y_position},
                "devices": [d["id"] for d in type_devices],
            }
        )
        y_position += 200

    # Build devices section
    devices_section = {}
    for device in devices:
        devices_section[device["id"]] = {
            "display_name": device["display_name"],
            "model": device["model"],
            "ip": device["ip"],
            "location": device["location"],
            "librenms_hostname": device["librenms_hostname"],
        }

    topology = {
        "clusters": clusters,
        "devices": devices_section,
    }

    # Handle connections: use provided connections or preserve existing
    if connections is not None:
        existing_connections = existing_topology.get("connections", []) if existing_topology else []
        topology["connections"] = _merge_connections(connections, existing_connections)
    elif existing_topology and "connections" in existing_topology:
        topology["connections"] = existing_topology["connections"]

    # Always preserve external_links from existing topology
    if existing_topology and "external_links" in existing_topology:
        topology["external_links"] = existing_topology["external_links"]

    return topology


async def generate_topology_yaml(
    vm_subnets: list[str] | None = None,
    include_types: list[str] | None = None,
    preserve_existing: bool = True,
    auto_discover_connections: bool = True,
) -> str:
    """
    Generate topology.yaml content from discovered devices.

    Args:
        vm_subnets: Subnets to exclude
        include_types: Device types to include
        preserve_existing: Whether to preserve connections/external_links from existing topology
        auto_discover_connections: Whether to discover connections from LibreNMS CDP/LLDP data

    Returns:
        YAML string ready to write to file
    """
    result = await discover_physical_devices(vm_subnets, include_types)

    # Discover connections if enabled
    connections = None
    if auto_discover_connections and result["devices"]:
        connections = await discover_connections(result["devices"])

    existing = get_topology_config() if preserve_existing else None
    topology = _build_topology_yaml(result["devices"], existing, connections)

    # Generate YAML with nice formatting
    yaml_content = "# Watchtower Topology Configuration\n"
    yaml_content += "# Auto-generated from LibreNMS discovery\n\n"
    yaml_content += yaml.dump(topology, default_flow_style=False, sort_keys=False)

    return yaml_content


async def sync_to_topology(
    vm_subnets: list[str] | None = None,
    include_types: list[str] | None = None,
    output_path: str | None = None,
    backup: bool = True,
    discover_links: bool = True,
) -> dict[str, Any]:
    """
    Sync discovered devices to topology.yaml file.

    Args:
        vm_subnets: Subnets to exclude
        include_types: Device types to include
        output_path: Path to write topology.yaml (defaults to config path)
        backup: Whether to create backup of existing file
        discover_links: Whether to auto-discover connections from CDP/LLDP

    Returns:
        Dict with sync results and file path
    """
    settings = Settings()
    topology_path = Path(output_path or settings.topology_path)
    if not topology_path.is_absolute():
        topology_path = Path(__file__).parent.parent.parent / topology_path

    # Create backup if file exists
    if backup and topology_path.exists():
        backup_path = topology_path.with_suffix(".yaml.bak")
        backup_path.write_text(topology_path.read_text())

    # Discover devices first to get connection count
    result = await discover_physical_devices(vm_subnets, include_types)

    # Discover connections if enabled
    connections_discovered = 0
    if discover_links and result["devices"]:
        connections = await discover_connections(result["devices"])
        connections_discovered = len(connections)

    # Generate new topology
    yaml_content = await generate_topology_yaml(
        vm_subnets, include_types, preserve_existing=True, auto_discover_connections=discover_links
    )

    # Write to file
    topology_path.write_text(yaml_content)

    return {
        "success": True,
        "file_path": str(topology_path),
        "backup_created": backup and topology_path.with_suffix(".yaml.bak").exists(),
        "summary": {
            **result["summary"],
            "connections_discovered": connections_discovered,
        },
    }
