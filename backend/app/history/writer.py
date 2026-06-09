"""Historical data writer for InfluxDB measurements."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from .client import influx_client

logger = logging.getLogger(__name__)


class HistoryWriter:
    """Writes polled and event data into InfluxDB."""

    async def write_device_metrics(
        self,
        health_data: dict[str, dict[str, Any]],
        device_configs: list[dict[str, Any]],
    ) -> None:
        records: list[dict[str, Any]] = []
        device_map = {str(d.get("device_id")): d for d in device_configs}
        now = datetime.utcnow().isoformat() + "Z"

        for device_id, metrics in health_data.items():
            device = device_map.get(str(device_id), {})
            fields = {
                "cpu": float(metrics.get("cpu") or 0.0),
                "memory": float(metrics.get("memory") or 0.0),
                "uptime": int(device.get("uptime") or 0),
            }
            temperature = metrics.get("temperature")
            if temperature is not None:
                fields["temperature"] = float(temperature)

            records.append({
                "time": now,
                "tags": {
                    "device_id": str(device_id),
                    "device_type": str(device.get("os") or device.get("device_type") or "unknown"),
                    "location": str(device.get("location") or "unknown"),
                },
                "fields": fields,
            })

        await influx_client.write(records, measurement="device_metrics")

    async def write_interface_metrics(self, device_id: str, ports: list[dict[str, Any]]) -> None:
        records: list[dict[str, Any]] = []
        now = datetime.utcnow().isoformat() + "Z"

        for port in ports:
            speed_bps = float(port.get("speed") or 0)
            # in_rate/out_rate are LibreNMS ifInOctets_rate values (bytes/sec);
            # convert to bits/sec to match the live aggregator and the _bps field names.
            in_bps = float(port.get("in_rate") or 0) * 8
            out_bps = float(port.get("out_rate") or 0) * 8
            utilization = 0.0
            if speed_bps > 0:
                utilization = (max(in_bps, out_bps) / speed_bps) * 100

            records.append({
                "time": now,
                "tags": {
                    "device_id": str(device_id),
                    "interface_name": str(port.get("name") or port.get("alias") or "unknown"),
                    "interface_status": str(port.get("status") or "unknown"),
                },
                "fields": {
                    "in_bps": int(in_bps),
                    "out_bps": int(out_bps),
                    "utilization": float(utilization),
                    "errors_in": int(float(port.get("in_errors") or 0)),
                    "errors_out": int(float(port.get("out_errors") or 0)),
                    "speed_mbps": int(speed_bps / 1_000_000) if speed_bps > 0 else 0,
                },
            })

        await influx_client.write(records, measurement="interface_metrics")

    async def write_alert_events(self, alerts: list[dict[str, Any]], state: str) -> None:
        records: list[dict[str, Any]] = []

        for alert in alerts:
            records.append({
                "time": alert.get("timestamp") or datetime.utcnow().isoformat() + "Z",
                "tags": {
                    "device_id": str(alert.get("device_id") or "unknown"),
                    "severity": str(alert.get("severity") or "warning"),
                    "hostname": str(alert.get("hostname") or alert.get("device_id") or "unknown"),
                },
                "fields": {
                    "title": str(alert.get("title") or "Alert"),
                    "state": state,
                    "alert_id": int(alert.get("id") or 0),
                },
            })

        await influx_client.write(records, measurement="alert_events")

    async def write_speedtest(self, result: dict[str, Any]) -> None:
        record = {
            "time": result.get("timestamp") or datetime.utcnow().isoformat() + "Z",
            "tags": {
                "server_id": str(result.get("server_id") or "0"),
                "status": str(result.get("status") or "unknown"),
            },
            "fields": {
                "download_mbps": float(result.get("download_mbps") or 0.0),
                "upload_mbps": float(result.get("upload_mbps") or 0.0),
                "ping_ms": float(result.get("ping_ms") or 0.0),
                "jitter_ms": float(result.get("jitter_ms") or 0.0),
            },
        }
        await influx_client.write([record], measurement="speedtest_results")

    async def write_network_summary(
        self,
        devices_up: int,
        devices_down: int,
        total_devices: int,
        active_alerts: int,
    ) -> None:
        record = {
            "time": datetime.utcnow().isoformat() + "Z",
            "tags": {},
            "fields": {
                "devices_up": int(devices_up),
                "devices_down": int(devices_down),
                "total_devices": int(total_devices),
                "active_alerts": int(active_alerts),
            },
        }
        await influx_client.write([record], measurement="network_summary")


history_writer = HistoryWriter()
