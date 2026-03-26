"""History API routes.

Normalizes responses from both InfluxDB reader and demo store into
consistent shapes expected by the frontend:
- network/summary → {points: [{time, devices_up, devices_down, ...}]}
- speedtest       → {points: [{time, download_mbps, upload_mbps, ping_ms, ...}]}
- alerts/timeline → {events: [{time, device_id, hostname, severity, title, state}]}
- device metrics  → {cpu: [...], memory: [...], temperature: [...], interfaces: {...}}
- top-talkers     → {talkers: [{device_id, interface_name, in_bps, out_bps, utilization}]}
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.config import settings, get_config
from app.history import demo_history_store, history_reader, csv_history_reader

router = APIRouter()

_RANGE_MAP = {
    "1h": "-1h",
    "6h": "-6h",
    "24h": "-24h",
    "7d": "-7d",
    "30d": "-30d",
}

_DEFAULT_AGG = {
    "1h": "1m",
    "6h": "5m",
    "24h": "5m",
    "7d": "15m",
    "30d": "1h",
}


def _resolve_window(
    range_value: str,
    start: str | None,
    stop: str | None,
    aggregate: str | None,
) -> tuple[str, str, str]:
    start_expr = start or _RANGE_MAP.get(range_value, "-24h")
    stop_expr = stop or "now()"
    aggregate_window = aggregate or _DEFAULT_AGG.get(range_value, "5m")
    return start_expr, stop_expr, aggregate_window


def _reader():
    if settings.demo_mode:
        return demo_history_store
    # Check both settings and yaml config for InfluxDB enabled state
    config = get_config()
    if settings.influxdb_enabled or config.influxdb.enabled:
        return history_reader
    # Fall back to CSV reader when InfluxDB is not configured
    return csv_history_reader


def _merge_series_to_points(series: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Merge multiple named series into a single points array keyed by time.

    Input:  {"devices_up": [{"time": "...", "value": 5}, ...], "devices_down": [...]}
    Output: [{"time": "...", "devices_up": 5, "devices_down": 0, ...}, ...]
    """
    time_map: dict[str, dict[str, Any]] = {}
    for field_name, points in series.items():
        for pt in points:
            t = pt["time"]
            if t not in time_map:
                time_map[t] = {"time": t}
            time_map[t][field_name] = pt["value"]
    return sorted(time_map.values(), key=lambda p: p["time"])


# ─────────────────────────────────────────────────────────────────────────────
# Device endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/history/device/{device_id}/metrics")
async def get_device_metrics(
    device_id: str,
    range: str = Query("24h"),
    start: str | None = Query(None),
    stop: str | None = Query(None),
    aggregate: str | None = Query(None),
):
    """Return cpu/memory/temperature arrays + top interfaces for a device."""
    start_expr, stop_expr, aggregate_window = _resolve_window(range, start, stop, aggregate)
    reader = _reader()

    # Fetch CPU and memory separately
    cpu_data = await reader.get_device_metrics(device_id, "cpu", start_expr, stop_expr, aggregate_window)
    mem_data = await reader.get_device_metrics(device_id, "memory", start_expr, stop_expr, aggregate_window)

    cpu_points = cpu_data.get("points", [])
    mem_points = mem_data.get("points", [])

    # Fetch interface data
    iface_data = await reader.get_all_device_interfaces(device_id, start_expr, stop_expr, aggregate_window)
    raw_interfaces = iface_data.get("interfaces", {})

    # Convert interface data: {name: {in_bps: [...], ...}} → {name: [{time, value}]}
    # Use total throughput (in_bps) as the main metric per interface
    interfaces: dict[str, list[dict[str, Any]]] = {}
    for if_name, fields in raw_interfaces.items():
        in_pts = fields.get("in_bps", [])
        interfaces[if_name] = in_pts

    return {
        "cpu": cpu_points,
        "memory": mem_points,
        "temperature": [],
        "interfaces": interfaces,
        "range": range,
    }


@router.get("/history/device/{device_id}/interfaces")
async def get_device_interfaces(
    device_id: str,
    range: str = Query("24h"),
    start: str | None = Query(None),
    stop: str | None = Query(None),
    aggregate: str | None = Query(None),
):
    start_expr, stop_expr, aggregate_window = _resolve_window(range, start, stop, aggregate)
    data = await _reader().get_all_device_interfaces(device_id, start_expr, stop_expr, aggregate_window)
    data["range"] = range
    return data


@router.get("/history/device/{device_id}/interface/{interface_name}")
async def get_device_interface(
    device_id: str,
    interface_name: str,
    range: str = Query("24h"),
    start: str | None = Query(None),
    stop: str | None = Query(None),
    aggregate: str | None = Query(None),
):
    start_expr, stop_expr, aggregate_window = _resolve_window(range, start, stop, aggregate)
    data = await _reader().get_interface_metrics(device_id, interface_name, start_expr, stop_expr, aggregate_window)
    data["range"] = range
    return data


# ─────────────────────────────────────────────────────────────────────────────
# Network-wide endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/history/network/summary")
async def get_network_summary(
    range: str = Query("24h"),
    start: str | None = Query(None),
    stop: str | None = Query(None),
    aggregate: str | None = Query(None),
):
    """Return merged points: [{time, devices_up, devices_down, total_devices, active_alerts}]."""
    start_expr, stop_expr, aggregate_window = _resolve_window(range, start, stop, aggregate)
    data = await _reader().get_network_summary(start_expr, stop_expr, aggregate_window)

    # Normalize: demo_store returns {series: {...}}, convert to {points: [...]}
    series = data.get("series", {})
    if series:
        points = _merge_series_to_points(series)
    else:
        points = data.get("points", [])

    return {"points": points, "range": range}


@router.get("/history/network/top-talkers")
async def get_top_talkers(
    range: str = Query("1h"),
    start: str | None = Query(None),
    limit: int = Query(10, ge=1, le=100),
):
    start_expr = start or _RANGE_MAP.get(range, "-1h")
    data = await _reader().get_top_talkers(start=start_expr, limit=limit)

    # Ensure consistent shape: add utilization if missing
    talkers = data.get("talkers", [])
    for t in talkers:
        if "utilization" not in t:
            total = (t.get("in_bps", 0) + t.get("out_bps", 0))
            t["utilization"] = round(total / 1_000_000_000 * 100, 1) if total > 0 else 0.0

    return {"talkers": talkers, "range": range}


@router.get("/history/alerts/timeline")
async def get_alert_timeline(
    range: str = Query("7d"),
    start: str | None = Query(None),
    stop: str | None = Query(None),
    device_id: str | None = Query(None),
):
    start_expr = start or _RANGE_MAP.get(range, "-7d")
    stop_expr = stop or "now()"
    data = await _reader().get_alert_timeline(start=start_expr, stop=stop_expr, device_id=device_id)
    return {"events": data.get("events", []), "range": range}


@router.get("/history/speedtest")
async def get_speedtest_history(
    range: str = Query("7d"),
    start: str | None = Query(None),
    stop: str | None = Query(None),
    aggregate: str | None = Query(None),
):
    """Return merged points: [{time, download_mbps, upload_mbps, ping_ms, jitter_ms}]."""
    start_expr, stop_expr, aggregate_window = _resolve_window(range, start, stop, aggregate)

    # Always get CSV data as baseline (has historical data)
    csv_data = await csv_history_reader.get_speedtest_history(start_expr, stop_expr, aggregate_window)
    csv_points = csv_data.get("points", [])

    # If InfluxDB is enabled, also get data from there and merge
    config = get_config()
    if settings.influxdb_enabled or config.influxdb.enabled:
        influx_data = await history_reader.get_speedtest_history(start_expr, stop_expr, aggregate_window)
        series = influx_data.get("series", {})
        if series:
            influx_points = _merge_series_to_points(series)
        else:
            influx_points = influx_data.get("points", [])

        # Merge: use a dict keyed by time to deduplicate, preferring InfluxDB data
        points_map = {p["time"]: p for p in csv_points}
        for p in influx_points:
            points_map[p["time"]] = p  # InfluxDB data overwrites CSV for same timestamp
        points = sorted(points_map.values(), key=lambda p: p["time"])
    else:
        points = csv_points

    return {"points": points, "range": range}
