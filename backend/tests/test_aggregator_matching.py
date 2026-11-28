from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.models.device import DeviceStatus
from app.polling.aggregator import (
    _calculate_utilization,
    _get_port_utilization,
    build_librenms_indexes,
    librenms_status_to_device_status,
    match_librenms_device,
    match_proxmox_node,
    match_proxmox_node_by_name,
)


def test_build_librenms_indexes_lowercases_hostnames_and_omits_missing_keys():
    devices = [
        {"hostname": "Switch-A.Example.com", "ip": "192.0.2.10"},
        {"hostname": "host-only"},
        {"ip": "192.0.2.11"},
    ]
    by_ip, by_hostname = build_librenms_indexes(devices)
    assert by_ip == {"192.0.2.10": devices[0], "192.0.2.11": devices[2]}
    assert by_hostname == {"switch-a.example.com": devices[0], "host-only": devices[1]}


def test_build_indexes_duplicate_entries_use_last_seen():
    first = {"hostname": "node", "ip": "192.0.2.10", "id": 1}
    second = {"hostname": "NODE", "ip": "192.0.2.10", "id": 2}
    by_ip, by_hostname = build_librenms_indexes([first, second])
    assert by_ip["192.0.2.10"] is second
    assert by_hostname["node"] is second


def test_match_librenms_prefers_explicit_hostname_over_ip():
    explicit = {"hostname": "explicit"}
    by_ip = {"192.0.2.10": {"hostname": "ip"}}
    by_host = {"switch-a.example.com": explicit}
    result = match_librenms_device("switch-a", {"librenms_hostname": "Switch-A.Example.com", "ip": "192.0.2.10"}, by_ip, by_host)
    assert result is explicit


def test_match_librenms_falls_back_to_ip_when_explicit_missing():
    match = {"hostname": "ip-match"}
    assert match_librenms_device("device", {"librenms_hostname": "missing", "ip": "192.0.2.10"}, {"192.0.2.10": match}, {}) is match


def test_match_librenms_fuzzy_hostname_match_is_case_insensitive():
    match = {"hostname": "Router-1.example.com"}
    assert match_librenms_device("router-1", {}, {}, {"router-1.example.com": match}) is match


def test_match_librenms_ambiguous_fuzzy_match_returns_first_inserted():
    first = {"hostname": "rack-1a.example.com"}
    second = {"hostname": "rack-1b.example.com"}
    assert match_librenms_device("rack-1", {}, {}, {"rack-1a.example.com": first, "rack-1b.example.com": second}) is first


def test_match_librenms_returns_none_when_no_candidate():
    assert match_librenms_device("absent", {"ip": "192.0.2.99"}, {}, {"other": {}}) is None


@pytest.mark.parametrize(
    ("status", "expected"),
    [("up", DeviceStatus.UP), ("down", DeviceStatus.DOWN), (None, DeviceStatus.UNKNOWN), ("degraded", DeviceStatus.UNKNOWN)],
)
def test_librenms_status_mapping(status, expected):
    assert librenms_status_to_device_status(status) is expected


def test_match_proxmox_uses_sysname_short_name():
    node = {"node": "pve-a"}
    assert match_proxmox_node({"sysName": "PVE-A.example.com"}, {"pve-a": node}) is node


def test_match_proxmox_falls_back_to_hostname():
    node = {"node": "pve-b"}
    assert match_proxmox_node({"hostname": "pve-b.example.com"}, {"pve-b": node}) is node


def test_match_proxmox_supports_multi_instance_key():
    node = {"node": "other"}
    assert match_proxmox_node({"sysName": "pve-c"}, {"secondary:pve-c": node}) is node


def test_match_proxmox_handles_empty_and_unmatched_inputs():
    assert match_proxmox_node(None, {"pve-a": {"node": "pve-a"}}) is None
    assert match_proxmox_node({"hostname": "other"}, {"pve-a": {"node": "pve-a"}}) is None


def test_match_proxmox_node_by_exact_or_display_name():
    node = {"node": "pve-a"}
    assert match_proxmox_node_by_name("pve-a", {}, {"primary:pve-a": node}) is node
    assert match_proxmox_node_by_name("host", {"display_name": "pve-a"}, {"pve-a": node}) is node


def test_match_proxmox_node_by_normalized_name():
    node = {"node": "pve-a"}
    assert match_proxmox_node_by_name("PVE_A", {}, {"pve-a": node}) is node


@pytest.mark.parametrize("device_id", ["pve-ahost", "hostpve-a"])
def test_match_proxmox_node_by_specific_partial_name(device_id):
    node = {"node": "pve-a"}
    assert match_proxmox_node_by_name(device_id, {}, {"pve-a": node}) is node


def test_match_proxmox_avoids_short_partial_and_empty_node_names():
    nodes = {"empty": {"node": ""}, "primary": {"node": "pve"}}
    assert match_proxmox_node_by_name("pve-host", {}, nodes) is None


def test_calculate_utilization_uses_max_direction_and_rounds():
    assert _calculate_utilization({"speed": 1000, "in_rate": 10, "out_rate": 25}) == 20.0
    assert _calculate_utilization({"speed": 3000, "in_rate": 10, "out_rate": 0}) == 2.67


@pytest.mark.parametrize("speed", [0, None, -1])
def test_calculate_utilization_zero_or_invalid_speed(speed):
    assert _calculate_utilization({"speed": speed, "in_rate": 50, "out_rate": 100}) == 0


def test_calculate_utilization_handles_missing_rates():
    assert _calculate_utilization({"speed": 1000}) == 0


@pytest.mark.asyncio
async def test_get_port_utilization_handles_missing_id_or_name():
    assert await _get_port_utilization(None, "eth0") == 0
    assert await _get_port_utilization(7, None) == 0


@pytest.mark.asyncio
async def test_get_port_utilization_uses_case_insensitive_alias(wired_redis_cache):
    from app.polling import aggregator

    await aggregator.redis_cache.set("watchtower:interfaces:7", [{"name": "eth0", "alias": "WAN uplink", "speed": 1000, "in_rate": 10, "out_rate": 0}])
    assert await _get_port_utilization(7, "wan UPLINK") == 8.0


@pytest.mark.asyncio
async def test_get_port_utilization_returns_zero_for_uncached_port(monkeypatch):
    from app.polling import aggregator

    monkeypatch.setattr(aggregator.redis_cache, "get_json", AsyncMock(return_value=[]))
    assert await _get_port_utilization(7, "eth0") == 0


def test_discovery_helpers_clean_ids_types_and_filter_subnets():
    from app.discovery import librenms_sync as discovery
    from app.polling.librenms import LibreNMSDevice

    assert discovery._clean_device_id("Switch A.example.com", "unused") == "switch-a"
    assert discovery._clean_device_id(None, "!!!").startswith("device-")
    assert discovery._ip_in_subnets("192.0.2.10", discovery._parse_subnets(["192.0.2.0/24", "invalid"])) is True
    assert discovery._ip_in_subnets("bad-ip", []) is False
    device = LibreNMSDevice(device_id=1, hostname="fw.example.com", status=1, os="panos")
    assert discovery._get_device_type(device, ["firewall"]) == "firewall"
    assert discovery._get_device_type(device, ["network"]) is None
    assert discovery._group_by_cluster([{"id": "x", "type": "firewall"}, {"id": "y"}])["unknown"][0]["id"] == "y"


@pytest.mark.asyncio
async def test_discover_physical_devices_filters_missing_ip_subnet_and_type(monkeypatch):
    from app.discovery import librenms_sync as discovery
    from app.polling.librenms import LibreNMSDevice

    devices = [
        LibreNMSDevice(device_id=1, hostname="switch-a.example.com", sysName="Switch A", ip="192.0.2.10", status=1, os="iosxe"),
        LibreNMSDevice(device_id=2, hostname="vm.example.com", ip="192.0.2.90", status=1, os="proxmox"),
        LibreNMSDevice(device_id=3, hostname="unknown", status=1),
        LibreNMSDevice(device_id=4, hostname="other", ip="192.0.2.11", status=1, os="unknown"),
    ]

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get_devices(self):
            return devices

    monkeypatch.setattr(discovery, "LibreNMSClient", Client)
    result = await discovery.discover_physical_devices(["192.0.2.80/28"])
    assert result["summary"]["filtered_out"] == {"vm_subnet": 1, "wrong_type": 1, "no_ip": 1}
    assert result["devices"][0]["id"] == "switch-a"


def test_merge_connections_replaces_auto_and_conflicting_manual():
    from app.discovery.librenms_sync import _merge_connections

    discovered = [{"id": "a-to-b", "source": {"device": "a"}, "target": {"device": "b"}, "auto_discovered": True}]
    old_auto = {"id": "old", "auto_discovered": True}
    conflict = {"id": "manual-conflict", "source": {"device": "b"}, "target": {"device": "a"}}
    unrelated = {"id": "manual", "source": {"device": "c"}, "target": {"device": "d"}}
    assert _merge_connections(discovered, [old_auto, conflict, unrelated]) == [discovered[0], unrelated]


@pytest.mark.asyncio
async def test_discover_connections_matches_remote_ids_and_hostnames(monkeypatch):
    from app.discovery import librenms_sync as discovery
    from app.polling.librenms import LibreNMSLink

    links = [
        LibreNMSLink(local_device_id=1, local_port="eth0", remote_device_id=2, remote_port="eth1", protocol="lldp"),
        LibreNMSLink(local_device_id=2, local_port="eth1", remote_device_id=1, remote_port="eth0", protocol="lldp"),
        LibreNMSLink(local_device_id=1, local_port_id=3, remote_hostname="peer.other.example.com"),
        LibreNMSLink(local_device_id=1, remote_hostname="missing.example.com"),
        LibreNMSLink(local_device_id=99, remote_device_id=2),
    ]

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get_all_links(self):
            return links

    monkeypatch.setattr(discovery, "LibreNMSClient", Client)
    devices = [
        {"id": "switch-a", "librenms_id": 1, "librenms_hostname": "switch-a.example.com", "ip": "192.0.2.10"},
        {"id": "switch-b", "librenms_id": 2, "librenms_hostname": "switch-b.example.com", "ip": "192.0.2.11"},
        {"id": "peer", "librenms_id": 3, "librenms_hostname": "peer.example.com", "ip": "192.0.2.12"},
    ]
    connections = await discovery.discover_connections(devices)
    assert len(connections) == 2
    assert connections[0]["source"] == {"device": "switch-a", "port": "eth0"}
    assert connections[0]["target"] == {"device": "switch-b", "port": "eth1"}
    assert connections[0]["discovery_protocol"] == "lldp"
    assert connections[1]["source"]["device"] == "switch-a"
    assert connections[1]["target"]["device"] == "peer"


def test_build_topology_yaml_preserves_manual_links_and_external_links():
    from app.discovery.librenms_sync import _build_topology_yaml

    devices = [{"id": "fw", "display_name": "Firewall", "type": "firewall", "model": "Example", "ip": "192.0.2.20", "location": "lab", "librenms_hostname": "fw.example.com"}]
    topology = _build_topology_yaml(
        devices,
        {"connections": [{"id": "manual"}], "external_links": [{"id": "internet"}]},
        [{"id": "auto", "auto_discovered": True}],
    )
    assert topology["clusters"][0]["name"] == "Firewalls"
    assert topology["devices"]["fw"]["ip"] == "192.0.2.20"
    assert topology["connections"] == [{"id": "auto", "auto_discovered": True}, {"id": "manual"}]
    assert topology["external_links"] == [{"id": "internet"}]


@pytest.mark.asyncio
async def test_preview_discovery_builds_cluster_summary(monkeypatch):
    from app.discovery import librenms_sync as discovery

    monkeypatch.setattr(discovery, "discover_physical_devices", AsyncMock(return_value={
        "devices": [{"id": "switch-a", "type": "network"}], "summary": {"discovered": 1},
    }))
    result = await discovery.preview_discovery()
    assert result["proposed_clusters"][0]["id"] == "networks"
    assert result["proposed_clusters"][0]["devices"] == ["switch-a"]


@pytest.mark.asyncio
async def test_generate_topology_yaml_uses_discovery_and_preserves_config(monkeypatch):
    from app.discovery import librenms_sync as discovery

    devices = [{"id": "switch-a", "type": "network", "display_name": "Switch A", "model": None, "ip": "192.0.2.10", "location": None, "librenms_hostname": "switch-a.example.com"}]
    monkeypatch.setattr(discovery, "discover_physical_devices", AsyncMock(return_value={"devices": devices, "summary": {}}))
    monkeypatch.setattr(discovery, "discover_connections", AsyncMock(return_value=[]))
    monkeypatch.setattr(discovery, "get_topology_config", lambda: {"external_links": [{"id": "internet"}]})

    import yaml

    result = yaml.safe_load(await discovery.generate_topology_yaml())

    assert result["clusters"][0]["devices"] == ["switch-a"]
    assert result["devices"]["switch-a"]["ip"] == "192.0.2.10"
    assert result["external_links"] == [{"id": "internet"}]


@pytest.mark.asyncio
async def test_sync_to_topology_writes_output_and_backup(monkeypatch, tmp_path):
    from app.discovery import librenms_sync as discovery

    devices = [{"id": "switch-a", "type": "network"}]
    monkeypatch.setattr(discovery, "discover_physical_devices", AsyncMock(return_value={
        "devices": devices, "summary": {"total_in_librenms": 1, "discovered": 1, "filtered_out": {}},
    }))
    monkeypatch.setattr(discovery, "discover_connections", AsyncMock(return_value=[{"id": "switch-a-to-switch-b"}]))
    monkeypatch.setattr(discovery, "generate_topology_yaml", AsyncMock(return_value="clusters: []\n"))
    output = tmp_path / "topology.yaml"
    output.write_text("old: true\n")

    result = await discovery.sync_to_topology(output_path=str(output))

    assert output.read_text() == "clusters: []\n"
    assert output.with_suffix(".yaml.bak").read_text() == "old: true\n"
    assert result["backup_created"] is True
    assert result["summary"]["connections_discovered"] == 1
