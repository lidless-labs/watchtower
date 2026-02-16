"""Historical data reader using Flux queries."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.config import settings

from .client import influx_client


class HistoryReader:
    """Queries InfluxDB historical measurements."""

    @staticmethod
    def _points_from_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        points: list[dict[str, Any]] = []
        for row in rows:
            ts = row.get("_time")
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            points.append({"time": ts, "value": row.get("_value")})
        return points

    async def get_device_metrics(self, device_id: str, metric: str, start: str = "-24h", stop: str = "now()", aggregate_window: str = "5m") -> dict[str, Any]:
        flux = f'''
from(bucket: "{settings.influxdb_bucket}")
  |> range(start: {start}, stop: {stop})
  |> filter(fn: (r) => r["_measurement"] == "device_metrics")
  |> filter(fn: (r) => r["device_id"] == "{device_id}")
  |> filter(fn: (r) => r["_field"] == "{metric}")
  |> aggregateWindow(every: {aggregate_window}, fn: mean, createEmpty: false)
'''
        rows = await influx_client.query(flux)
        return {
            "device_id": device_id,
            "metric": metric,
            "aggregate_window": aggregate_window,
            "points": self._points_from_rows(rows),
        }

    async def get_interface_metrics(self, device_id: str, interface_name: str, start: str = "-24h", stop: str = "now()", aggregate_window: str = "5m") -> dict[str, Any]:
        flux = f'''
from(bucket: "{settings.influxdb_bucket}")
  |> range(start: {start}, stop: {stop})
  |> filter(fn: (r) => r["_measurement"] == "interface_metrics")
  |> filter(fn: (r) => r["device_id"] == "{device_id}")
  |> filter(fn: (r) => r["interface_name"] == "{interface_name}")
  |> filter(fn: (r) => r["_field"] == "in_bps" or r["_field"] == "out_bps" or r["_field"] == "utilization")
  |> aggregateWindow(every: {aggregate_window}, fn: mean, createEmpty: false)
'''
        rows = await influx_client.query(flux)

        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            field = str(row.get("_field") or "value")
            ts = row.get("_time")
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            grouped[field].append({"time": ts, "value": row.get("_value")})

        return {
            "device_id": device_id,
            "interface_name": interface_name,
            "aggregate_window": aggregate_window,
            "points": dict(grouped),
        }

    async def get_all_device_interfaces(self, device_id: str, start: str = "-24h", stop: str = "now()", aggregate_window: str = "5m") -> dict[str, Any]:
        flux = f'''
from(bucket: "{settings.influxdb_bucket}")
  |> range(start: {start}, stop: {stop})
  |> filter(fn: (r) => r["_measurement"] == "interface_metrics")
  |> filter(fn: (r) => r["device_id"] == "{device_id}")
  |> filter(fn: (r) => r["_field"] == "in_bps" or r["_field"] == "out_bps")
  |> aggregateWindow(every: {aggregate_window}, fn: mean, createEmpty: false)
'''
        rows = await influx_client.query(flux)

        interfaces: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: {"in_bps": [], "out_bps": []})
        for row in rows:
            name = str(row.get("interface_name") or "unknown")
            field = str(row.get("_field") or "in_bps")
            ts = row.get("_time")
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            interfaces[name][field].append({"time": ts, "value": row.get("_value")})

        return {
            "device_id": device_id,
            "aggregate_window": aggregate_window,
            "interfaces": dict(interfaces),
        }

    async def get_network_summary(self, start: str = "-24h", stop: str = "now()", aggregate_window: str = "15m") -> dict[str, Any]:
        flux = f'''
from(bucket: "{settings.influxdb_bucket}")
  |> range(start: {start}, stop: {stop})
  |> filter(fn: (r) => r["_measurement"] == "network_summary")
  |> aggregateWindow(every: {aggregate_window}, fn: mean, createEmpty: false)
'''
        rows = await influx_client.query(flux)

        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            field = str(row.get("_field") or "value")
            ts = row.get("_time")
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            grouped[field].append({"time": ts, "value": row.get("_value")})

        return {"aggregate_window": aggregate_window, "series": dict(grouped)}

    async def get_alert_timeline(self, start: str = "-7d", stop: str = "now()", device_id: str | None = None) -> dict[str, Any]:
        device_filter = f'  |> filter(fn: (r) => r["device_id"] == "{device_id}")\n' if device_id else ""
        flux = f'''
from(bucket: "{settings.influxdb_bucket}")
  |> range(start: {start}, stop: {stop})
  |> filter(fn: (r) => r["_measurement"] == "alert_events")
{device_filter}  |> filter(fn: (r) => r["_field"] == "alert_id" or r["_field"] == "state" or r["_field"] == "title")
'''
        rows = await influx_client.query(flux)

        events_map: dict[str, dict[str, Any]] = {}
        for row in rows:
            key = f"{row.get('_time')}-{row.get('device_id')}"
            event = events_map.setdefault(key, {
                "time": row.get("_time").isoformat() if hasattr(row.get("_time"), "isoformat") else row.get("_time"),
                "device_id": row.get("device_id"),
                "severity": row.get("severity"),
                "hostname": row.get("hostname"),
            })
            event[str(row.get("_field"))] = row.get("_value")

        return {"events": sorted(events_map.values(), key=lambda e: e.get("time", ""), reverse=True)}

    async def get_speedtest_history(self, start: str = "-7d", stop: str = "now()", aggregate_window: str = "15m") -> dict[str, Any]:
        flux = f'''
from(bucket: "{settings.influxdb_bucket}")
  |> range(start: {start}, stop: {stop})
  |> filter(fn: (r) => r["_measurement"] == "speedtest_results")
  |> aggregateWindow(every: {aggregate_window}, fn: mean, createEmpty: false)
'''
        rows = await influx_client.query(flux)

        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            field = str(row.get("_field") or "value")
            ts = row.get("_time")
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            grouped[field].append({"time": ts, "value": row.get("_value")})

        return {"aggregate_window": aggregate_window, "series": dict(grouped)}

    async def get_top_talkers(self, start: str = "-1h", limit: int = 10) -> dict[str, Any]:
        flux = f'''
from(bucket: "{settings.influxdb_bucket}")
  |> range(start: {start}, stop: now())
  |> filter(fn: (r) => r["_measurement"] == "interface_metrics")
  |> filter(fn: (r) => r["_field"] == "in_bps" or r["_field"] == "out_bps")
  |> group(columns: ["device_id", "interface_name", "_field"])
  |> mean()
'''
        rows = await influx_client.query(flux)

        talkers: dict[str, dict[str, Any]] = {}
        for row in rows:
            key = f"{row.get('device_id')}::{row.get('interface_name')}"
            item = talkers.setdefault(key, {
                "device_id": row.get("device_id"),
                "interface_name": row.get("interface_name"),
                "in_bps": 0.0,
                "out_bps": 0.0,
                "total_bps": 0.0,
            })
            if row.get("_field") == "in_bps":
                item["in_bps"] = float(row.get("_value") or 0)
            elif row.get("_field") == "out_bps":
                item["out_bps"] = float(row.get("_value") or 0)
            item["total_bps"] = item["in_bps"] + item["out_bps"]

        sorted_items = sorted(talkers.values(), key=lambda t: t["total_bps"], reverse=True)
        return {"talkers": sorted_items[:limit]}


history_reader = HistoryReader()
