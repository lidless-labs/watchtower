"""
Polling Scheduler

Uses APScheduler to periodically poll data sources and broadcast updates.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.cache import redis_cache
from app.config import get_config, get_settings, settings
from app.history import history_writer, influx_client
from app.models.device import DeviceStatus
from app.polling.librenms import LibreNMSClient, LibreNMSDevice
from app.polling.proxmox import ProxmoxClient
from app.polling.speedtest import (
    run_speedtest,
    log_to_csv as speedtest_log_to_csv,
    cache_result,
    CACHE_SPEEDTEST,
)
from app.websocket import ws_manager

logger = logging.getLogger(__name__)

# Redis key prefixes
CACHE_DEVICES = "watchtower:devices"
CACHE_DEVICE_STATUS = "watchtower:device_status"
CACHE_ALERTS = "watchtower:alerts"
CACHE_HEALTH = "watchtower:health"
CACHE_PROXMOX = "watchtower:proxmox"
CACHE_PROXMOX_VMS = "watchtower:proxmox_vms"
CACHE_LINKS = "watchtower:links"
CACHE_VLANS = "watchtower:vlans"
CACHE_VLAN_MEMBERSHIPS = "watchtower:vlan_memberships"
CACHE_LAST_POLL = "watchtower:last_poll"


class PollingScheduler:
    """Manages polling jobs for data sources."""

    def __init__(self):
        self._scheduler: AsyncIOScheduler | None = None
        self._config = get_config()

    def start(self) -> None:
        """Start the polling scheduler."""
        self._scheduler = AsyncIOScheduler()

        polling = self._config.polling

        # Device status polling (most frequent - detects up/down)
        self._scheduler.add_job(
            poll_device_status,
            IntervalTrigger(seconds=polling.device_status),
            id="poll_device_status",
            name="Poll device status from LibreNMS",
            replace_existing=True,
        )

        # Interface/port polling (less frequent)
        self._scheduler.add_job(
            poll_interfaces,
            IntervalTrigger(seconds=polling.interfaces),
            id="poll_interfaces",
            name="Poll interface statistics",
            replace_existing=True,
        )

        # Health polling (CPU, memory) - same interval as interfaces
        self._scheduler.add_job(
            poll_health,
            IntervalTrigger(seconds=polling.interfaces),
            id="poll_health",
            name="Poll CPU/memory health",
            replace_existing=True,
        )

        # Alert polling
        self._scheduler.add_job(
            poll_alerts,
            IntervalTrigger(seconds=polling.device_status),  # Same as device status
            id="poll_alerts",
            name="Poll alerts from LibreNMS",
            replace_existing=True,
        )

        # Link/neighbor polling (CDP/LLDP discovery)
        # Run immediately on startup, then periodically
        from datetime import datetime as dt
        self._scheduler.add_job(
            poll_links,
            IntervalTrigger(seconds=polling.topology),
            id="poll_links",
            name="Poll CDP/LLDP links from LibreNMS",
            replace_existing=True,
            next_run_time=dt.now(),  # Run immediately on startup
        )

        # VLAN polling (for L3 topology view)
        self._scheduler.add_job(
            poll_vlans,
            IntervalTrigger(seconds=polling.topology),
            id="poll_vlans",
            name="Poll VLANs from LibreNMS",
            replace_existing=True,
            next_run_time=dt.now(),  # Run immediately on startup
        )

        # Proxmox polling (if configured)
        settings = get_settings()
        if settings.get_all_proxmox_configs():
            self._scheduler.add_job(
                poll_proxmox,
                IntervalTrigger(seconds=polling.proxmox),
                id="poll_proxmox",
                name="Poll Proxmox node and VM stats",
                replace_existing=True,
            )

        # Speedtest polling (if configured)
        speedtest_config = getattr(self._config, "speedtest", None)
        if speedtest_config and getattr(speedtest_config, "enabled", False):
            interval_minutes = getattr(speedtest_config, "interval_minutes", 15)
            from datetime import datetime as dt
            self._scheduler.add_job(
                poll_speedtest,
                IntervalTrigger(minutes=interval_minutes),
                id="poll_speedtest",
                name="Run internet speedtest",
                replace_existing=True,
                next_run_time=dt.now(),  # Run immediately on startup
            )
            logger.info("Speedtest polling enabled: every %d minutes", interval_minutes)

        # Port group polling (if configured with logging)
        port_groups = self._config.port_groups
        if port_groups and any(pg.logging.enabled for pg in port_groups):
            from datetime import datetime as dt
            self._scheduler.add_job(
                poll_port_groups,
                IntervalTrigger(seconds=60),  # Every minute (matches interface polling)
                id="poll_port_groups",
                name="Poll port group traffic and log to CSV",
                replace_existing=True,
                next_run_time=dt.now(),  # Run immediately on startup
            )
            logger.info("Port group logging enabled for %d groups", len(port_groups))

        self._scheduler.start()
        logger.info(
            "Polling scheduler started: device_status=%ds, interfaces=%ds",
            polling.device_status,
            polling.interfaces,
        )

    async def stop(self) -> None:
        """Stop the polling scheduler."""
        if self._scheduler:
            self._scheduler.shutdown(wait=False)
            logger.info("Polling scheduler stopped")

    async def poll_now(self) -> None:
        """Trigger an immediate poll of all sources."""
        await asyncio.gather(
            poll_device_status(),
            poll_alerts(),
            poll_links(),
            poll_vlans(),
            poll_proxmox(),
            return_exceptions=True,
        )


def _fire_and_forget_history(coro: Any, operation: str) -> None:
    """Run history write in background and only log failures."""
    if settings.demo_mode or not settings.influxdb_enabled or not influx_client.is_connected():
        return

    async def _runner() -> None:
        try:
            await coro
        except Exception as e:
            logger.warning("History write failed (%s): %s", operation, e)

    asyncio.create_task(_runner())


# ─────────────────────────────────────────────────────────────────────────────
# Polling Jobs
# ─────────────────────────────────────────────────────────────────────────────


async def poll_device_status() -> None:
    """
    Poll device status from LibreNMS.

    Fetches all devices, caches them, detects status changes,
    and broadcasts updates to connected WebSocket clients.
    """
    try:
        async with LibreNMSClient() as client:
            devices = await client.get_devices()

        if not devices:
            logger.warning("No devices returned from LibreNMS")
            return

        # Get previous status for change detection
        previous_status = await redis_cache.get_json(CACHE_DEVICE_STATUS) or {}

        # Build new status map and detect changes
        current_status: dict[str, dict[str, Any]] = {}
        changes: list[dict[str, Any]] = []

        for device in devices:
            device_id = str(device.device_id)
            status = "up" if device.status == 1 else "down"

            current_status[device_id] = {
                "hostname": device.hostname,
                "status": status,
                "ip": device.ip,
                "last_polled": device.last_polled,
            }

            # Detect status change
            prev = previous_status.get(device_id)
            if prev and prev.get("status") != status:
                changes.append({
                    "device_id": device_id,
                    "hostname": device.hostname,
                    "old_status": prev.get("status"),
                    "new_status": status,
                })

        # Cache current status
        await redis_cache.set(CACHE_DEVICE_STATUS, current_status)

        # Cache full device data
        device_data = [_librenms_device_to_dict(d) for d in devices]
        await redis_cache.set(CACHE_DEVICES, device_data)

        # Record poll time
        await redis_cache.set(CACHE_LAST_POLL, {
            "device_status": datetime.utcnow().isoformat(),
            "device_count": len(devices),
        })

        # Broadcast changes if any
        if changes:
            await broadcast_status_changes(changes)
            logger.info("Device status changes detected: %d", len(changes))

        active_alerts = len(await redis_cache.get_json(CACHE_ALERTS) or [])
        devices_up = sum(1 for d in current_status.values() if d.get("status") == "up")
        devices_down = sum(1 for d in current_status.values() if d.get("status") == "down")
        _fire_and_forget_history(
            history_writer.write_network_summary(
                devices_up=devices_up,
                devices_down=devices_down,
                total_devices=len(current_status),
                active_alerts=active_alerts,
            ),
            "network_summary",
        )

        logger.debug("Polled %d devices from LibreNMS", len(devices))

    except Exception as e:
        logger.error("Failed to poll device status: %s", e)


async def poll_interfaces() -> None:
    """
    Poll interface statistics from LibreNMS for all devices.
    """
    try:
        # Get cached devices
        devices_data = await redis_cache.get_json(CACHE_DEVICES)
        if not devices_data:
            logger.debug("No cached devices, skipping interface poll")
            return

        polled_count = 0
        async with LibreNMSClient() as client:
            for device in devices_data:
                device_id = device.get("device_id")
                if not device_id:
                    continue

                try:
                    ports = await client.get_ports(device_id)
                    if ports:
                        # Cache interface data per device
                        port_data = [
                            {
                                "port_id": p.port_id,
                                "name": p.ifName or p.ifDescr,
                                "alias": p.ifAlias,
                                "status": p.ifOperStatus,
                                "admin_status": p.ifAdminStatus,
                                "speed": p.ifSpeed,
                                "in_rate": p.ifInOctets_rate,
                                "out_rate": p.ifOutOctets_rate,
                                "in_errors": p.ifInErrors_rate,
                                "out_errors": p.ifOutErrors_rate,
                            }
                            for p in ports
                        ]
                        await redis_cache.set(
                            f"watchtower:interfaces:{device_id}",
                            port_data,
                            ttl=300,  # 5 min TTL
                        )
                        _fire_and_forget_history(
                            history_writer.write_interface_metrics(str(device_id), port_data),
                            f"interface_metrics:{device_id}",
                        )
                        polled_count += 1
                except Exception as e:
                    logger.debug("Failed to poll interfaces for device %s: %s", device_id, e)

        logger.debug("Polled interfaces for %d devices", polled_count)

    except Exception as e:
        logger.error("Failed to poll interfaces: %s", e)


async def poll_health() -> None:
    """
    Poll CPU and memory usage from LibreNMS health sensors.
    """
    try:
        # Get cached devices
        devices_data = await redis_cache.get_json(CACHE_DEVICES)
        if not devices_data:
            logger.debug("No cached devices, skipping health poll")
            return

        health_data: dict[str, dict[str, Any]] = {}

        async with LibreNMSClient() as client:
            for device in devices_data:
                device_id = device.get("device_id")
                if not device_id:
                    continue

                try:
                    cpu = await client.get_device_processor(device_id)
                    memory = await client.get_device_memory(device_id)

                    health_data[str(device_id)] = {
                        "cpu": cpu,
                        "memory": memory,
                    }
                except Exception as e:
                    logger.debug("Failed to poll health for device %s: %s", device_id, e)

        # Cache all health data in one key
        await redis_cache.set(CACHE_HEALTH, health_data, ttl=300)

        _fire_and_forget_history(
            history_writer.write_device_metrics(health_data=health_data, device_configs=devices_data),
            "device_metrics",
        )

        logger.debug("Polled health for %d devices", len(health_data))

    except Exception as e:
        logger.error("Failed to poll health: %s", e)


async def poll_alerts() -> None:
    """Poll active alerts from LibreNMS."""
    try:
        async with LibreNMSClient() as client:
            alerts = await client.get_active_alerts()

        # Get previous alerts for change detection
        previous_alerts = await redis_cache.get_json(CACHE_ALERTS) or []
        previous_ids = {a.get("id") for a in previous_alerts}

        # Build current alerts
        current_alerts = [
            {
                "id": a.id,
                "device_id": a.device_id,
                "hostname": a.hostname,
                "severity": a.severity,
                "title": a.title,
                "timestamp": a.timestamp,
            }
            for a in alerts
        ]
        current_ids = {a["id"] for a in current_alerts}

        # Detect new alerts
        new_alert_ids = current_ids - previous_ids
        resolved_ids = previous_ids - current_ids

        # Cache alerts
        await redis_cache.set(CACHE_ALERTS, current_alerts)

        # Broadcast if there are new alerts
        if new_alert_ids:
            new_alerts = [a for a in current_alerts if a["id"] in new_alert_ids]
            await broadcast_new_alerts(new_alerts)
            _fire_and_forget_history(
                history_writer.write_alert_events(new_alerts, state="active"),
                "alert_events_active",
            )
            logger.info("New alerts detected: %d", len(new_alerts))

        if resolved_ids:
            resolved_alerts = [a for a in previous_alerts if a.get("id") in resolved_ids]
            await broadcast_resolved_alerts(list(resolved_ids))
            _fire_and_forget_history(
                history_writer.write_alert_events(resolved_alerts, state="resolved"),
                "alert_events_resolved",
            )
            logger.info("Alerts resolved: %d", len(resolved_ids))

    except Exception as e:
        logger.error("Failed to poll alerts: %s", e)


async def poll_links() -> None:
    """
    Poll CDP/LLDP neighbor links from LibreNMS.

    Caches link data for use in topology connection building.
    """
    try:
        async with LibreNMSClient() as client:
            links = await client.get_all_links()

            # Collect unique port_ids that need resolution
            port_ids_to_resolve = set()
            for link in links:
                if link.local_port_id:
                    port_ids_to_resolve.add(link.local_port_id)

            # Fetch port names for the port_ids we need
            port_names: dict[int, str] = {}
            for port_id in port_ids_to_resolve:
                try:
                    port = await client.get_port(port_id)
                    if port:
                        port_names[port_id] = port.ifName or port.ifDescr or f"port-{port_id}"
                except Exception:
                    pass  # Skip if port lookup fails

        # Convert to cacheable dicts with resolved port names
        link_data = []
        for link in links:
            local_port_name = None
            if link.local_port_id:
                local_port_name = port_names.get(link.local_port_id)

            link_data.append({
                "id": link.id,
                "local_device_id": link.local_device_id,
                "local_port_id": link.local_port_id,
                "local_port": local_port_name or link.local_port,
                "remote_device_id": link.remote_device_id,
                "remote_hostname": link.remote_hostname,
                "remote_port": link.remote_port,
                "protocol": link.protocol,
            })

        await redis_cache.set(CACHE_LINKS, link_data, ttl=600)
        logger.debug("Polled %d CDP/LLDP links from LibreNMS", len(link_data))

    except Exception as e:
        logger.error("Failed to poll links: %s", e)


async def poll_vlans() -> None:
    """
    Poll VLAN data from LibreNMS for L3 topology view.

    Fetches all VLANs from /resources/vlans which includes device associations.
    """
    try:
        async with LibreNMSClient() as client:
            # Get all VLANs (includes device_id for each)
            vlans = await client.get_vlans()

            if not vlans:
                logger.debug("No VLANs returned from LibreNMS")
                return

            # Build unique VLAN list (dedupe by vlan_vlan number) and track memberships
            vlan_map: dict[int, dict[str, Any]] = {}
            memberships: list[dict[str, Any]] = []

            for vlan in vlans:
                vlan_num = vlan.vlan_vlan
                device_id = vlan.device_id

                # Add to vlan_map
                if vlan_num not in vlan_map:
                    vlan_map[vlan_num] = {
                        "vlan_id": vlan_num,
                        "vlan_name": vlan.vlan_name,
                        "device_ids": [],
                    }

                # Track device membership
                if device_id and device_id not in vlan_map[vlan_num]["device_ids"]:
                    vlan_map[vlan_num]["device_ids"].append(device_id)

                # Add membership record
                if device_id:
                    memberships.append({
                        "librenms_device_id": device_id,
                        "vlan_id": vlan_num,
                        "vlan_name": vlan.vlan_name,
                        "is_untagged": True,  # Default - /resources/vlans doesn't include port-level tagging info
                    })

            # Convert vlan_map to list with device counts
            vlan_data = [
                {
                    "vlan_id": v["vlan_id"],
                    "vlan_name": v["vlan_name"],
                    "device_count": len(v["device_ids"]),
                    "device_ids": v["device_ids"],
                }
                for v in vlan_map.values()
            ]

        # Cache results
        await redis_cache.set(CACHE_VLANS, vlan_data, ttl=600)
        await redis_cache.set(CACHE_VLAN_MEMBERSHIPS, memberships, ttl=600)

        logger.info("Polled %d VLANs, %d memberships from LibreNMS", len(vlan_data), len(memberships))

    except Exception as e:
        logger.error("Failed to poll VLANs: %s", e)


async def poll_proxmox() -> None:
    """
    Poll node stats and running VMs from all configured Proxmox instances.
    """
    try:
        settings = get_settings()
        proxmox_configs = settings.get_all_proxmox_configs()

        if not proxmox_configs:
            return

        all_nodes: dict[str, dict[str, Any]] = {}
        all_vms: list[dict[str, Any]] = []

        for instance_name, config in proxmox_configs:
            try:
                async with ProxmoxClient(
                    base_url=config.url,
                    token_id=config.token_id,
                    token_secret=config.token_secret,
                    verify_ssl=config.verify_ssl,
                ) as client:
                    # Get node stats
                    nodes = await client.get_nodes()
                    for node in nodes:
                        # Use instance:node as key for multi-cluster support
                        key = f"{instance_name}:{node.node}" if instance_name != "primary" else node.node
                        all_nodes[key] = {
                            "node": node.node,
                            "instance": instance_name,
                            "status": node.status,
                            "cpu": node.cpu_percent,
                            "memory": node.memory_percent,
                            "maxcpu": node.maxcpu,
                            "maxmem": node.maxmem,
                            "uptime": node.uptime,
                        }

                    # Get running VMs and containers
                    vms = await client.get_vms(running_only=True)
                    for vm in vms:
                        all_vms.append({
                            "vmid": vm.vmid,
                            "name": vm.name,
                            "node": vm.node,
                            "instance": instance_name,
                            "type": vm.type,
                            "status": vm.status,
                            "cpu": vm.cpu_percent,
                            "memory": vm.memory_percent,
                            "cpus": vm.cpus,
                            "maxmem": vm.maxmem,
                            "uptime": vm.uptime,
                            "netin": vm.netin,
                            "netout": vm.netout,
                        })

            except Exception as e:
                logger.warning("Failed to poll Proxmox instance %s: %s", instance_name, e)

        # Cache results
        await redis_cache.set(CACHE_PROXMOX, all_nodes, ttl=300)
        await redis_cache.set(CACHE_PROXMOX_VMS, all_vms, ttl=300)

        logger.debug(
            "Polled Proxmox: %d nodes, %d running VMs/containers",
            len(all_nodes),
            len(all_vms),
        )

    except Exception as e:
        logger.error("Failed to poll Proxmox: %s", e)


async def poll_speedtest() -> None:
    """
    Run internet speedtest and cache/log results.
    """
    try:
        config = get_config()
        speedtest_config = getattr(config, "speedtest", None)

        if not speedtest_config:
            return

        # Get optional server ID from config
        server_id = getattr(speedtest_config, "server_id", None)

        # Run the speedtest
        result = await run_speedtest(server_id=server_id)

        # Cache result in Redis
        await cache_result(result)

        # Log to CSV if configured
        logging_config = getattr(speedtest_config, "logging", None)
        if logging_config and getattr(logging_config, "enabled", False):
            csv_path = getattr(logging_config, "path", None)
            if csv_path:
                speedtest_log_to_csv(result, csv_path)

        # Broadcast to WebSocket clients
        result_dict = result.to_dict()
        await broadcast_speedtest_result(result_dict)

        _fire_and_forget_history(
            history_writer.write_speedtest(result_dict),
            "speedtest_results",
        )

        logger.debug(
            "Speedtest poll complete: %.1f Mbps down, status=%s",
            result.download_mbps,
            result.status,
        )

    except Exception as e:
        logger.error("Failed to poll speedtest: %s", e)


async def poll_port_groups() -> None:
    """
    Poll port group traffic and log to CSV.
    """
    try:
        config = get_config()
        port_groups = config.port_groups

        if not port_groups:
            return

        # Fetch all ports from LibreNMS
        async with LibreNMSClient() as client:
            all_ports = await client.get_ports()

        timestamp = datetime.utcnow().isoformat()

        for group in port_groups:
            if not group.logging.enabled:
                continue

            # Filter ports matching this group's alias pattern (case-insensitive)
            pattern = group.match_alias.lower()
            matching_ports = [
                p for p in all_ports
                if p.ifAlias and pattern in p.ifAlias.lower()
            ]

            # Calculate aggregates (only from active ports)
            active_ports = [p for p in matching_ports if p.ifOperStatus == "up"]
            port_count = len(matching_ports)
            active_port_count = len(active_ports)

            # Sum traffic rates (bytes per second)
            in_bps = sum(p.ifInOctets_rate or 0 for p in active_ports)
            out_bps = sum(p.ifOutOctets_rate or 0 for p in active_ports)

            # Convert to Mbps
            in_mbps = (in_bps * 8) / 1_000_000
            out_mbps = (out_bps * 8) / 1_000_000
            total_mbps = in_mbps + out_mbps

            # Determine status
            if total_mbps >= group.thresholds.critical_mbps:
                status = "critical"
            elif total_mbps >= group.thresholds.warning_mbps:
                status = "warning"
            else:
                status = "ok"

            # Log to CSV
            log_port_group_to_csv(
                csv_path=group.logging.path,
                timestamp=timestamp,
                group_name=group.name,
                in_mbps=round(in_mbps, 2),
                out_mbps=round(out_mbps, 2),
                total_mbps=round(total_mbps, 2),
                active_ports=active_port_count,
                total_ports=port_count,
                status=status,
            )

        logger.debug("Polled %d port groups for CSV logging", len(port_groups))

    except Exception as e:
        logger.error("Failed to poll port groups: %s", e)


def log_port_group_to_csv(
    csv_path: str,
    timestamp: str,
    group_name: str,
    in_mbps: float,
    out_mbps: float,
    total_mbps: float,
    active_ports: int,
    total_ports: int,
    status: str,
) -> None:
    """
    Append a port group traffic record to CSV.
    """
    import csv
    from pathlib import Path

    path = Path(csv_path)

    # Ensure directory exists
    path.parent.mkdir(parents=True, exist_ok=True)

    # Check if file exists to determine if we need headers
    write_header = not path.exists()

    try:
        with open(path, "a", newline="") as f:
            writer = csv.writer(f)

            if write_header:
                writer.writerow([
                    "timestamp",
                    "group_name",
                    "in_mbps",
                    "out_mbps",
                    "total_mbps",
                    "active_ports",
                    "total_ports",
                    "status",
                ])

            writer.writerow([
                timestamp,
                group_name,
                in_mbps,
                out_mbps,
                total_mbps,
                active_ports,
                total_ports,
                status,
            ])

    except Exception as e:
        logger.error("Failed to write port group to CSV %s: %s", csv_path, e)


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket Broadcasts
# ─────────────────────────────────────────────────────────────────────────────


async def broadcast_status_changes(changes: list[dict[str, Any]]) -> None:
    """Broadcast device status changes to WebSocket clients."""
    await ws_manager.broadcast({
        "type": "device_status_change",
        "timestamp": datetime.utcnow().isoformat(),
        "changes": changes,
    })


async def broadcast_new_alerts(alerts: list[dict[str, Any]]) -> None:
    """Broadcast new alerts to WebSocket clients."""
    await ws_manager.broadcast({
        "type": "new_alerts",
        "timestamp": datetime.utcnow().isoformat(),
        "alerts": alerts,
    })


async def broadcast_resolved_alerts(alert_ids: list[int]) -> None:
    """Broadcast resolved alerts to WebSocket clients."""
    await ws_manager.broadcast({
        "type": "alerts_resolved",
        "timestamp": datetime.utcnow().isoformat(),
        "alert_ids": alert_ids,
    })


async def broadcast_speedtest_result(result: dict[str, Any]) -> None:
    """Broadcast speedtest result to WebSocket clients."""
    await ws_manager.broadcast({
        "type": "speedtest_result",
        "timestamp": datetime.utcnow().isoformat(),
        "result": result,
    })


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _librenms_device_to_dict(device: LibreNMSDevice) -> dict[str, Any]:
    """Convert LibreNMS device to cacheable dict."""
    return {
        "device_id": device.device_id,
        "hostname": device.hostname,
        "sysName": device.sysName,
        "ip": device.ip,
        "status": "up" if device.status == 1 else "down",
        "status_reason": device.status_reason,
        "location": device.location,
        "hardware": device.hardware,
        "os": device.os,
        "version": device.version,
        "uptime": device.uptime,
        "last_polled": device.last_polled,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Module-level scheduler instance
# ─────────────────────────────────────────────────────────────────────────────

scheduler = PollingScheduler()
