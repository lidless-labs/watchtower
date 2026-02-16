"""In-memory history store for demo mode."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any


class DemoHistoryStore:
    """In-memory time-series store with HistoryReader-compatible methods."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.device_metrics: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
        self.interface_metrics: dict[str, dict[str, dict[str, list[dict[str, Any]]]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(list))
        )
        self.network_summary: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.alert_events: list[dict[str, Any]] = []
        self.speedtest: dict[str, list[dict[str, Any]]] = defaultdict(list)

    @staticmethod
    def _parse_time_expr(value: str | None, default: datetime) -> datetime:
        if not value:
            return default
        v = value.strip()
        if v == "now()":
            return datetime.now(timezone.utc)
        if v.startswith("-") and len(v) > 2:
            unit = v[-1]
            qty = int(v[1:-1])
            now = datetime.now(timezone.utc)
            if unit == "h":
                return now - timedelta(hours=qty)
            if unit == "d":
                return now - timedelta(days=qty)
            if unit == "m":
                return now - timedelta(minutes=qty)
        try:
            parsed = datetime.fromisoformat(v.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except Exception:
            return default

    def _filter_points(self, points: list[dict[str, Any]], start: str, stop: str) -> list[dict[str, Any]]:
        start_dt = self._parse_time_expr(start, datetime.now(timezone.utc) - timedelta(days=1))
        stop_dt = self._parse_time_expr(stop, datetime.now(timezone.utc))
        filtered = []
        for p in points:
            t = datetime.fromisoformat(str(p["time"]).replace("Z", "+00:00"))
            if start_dt <= t <= stop_dt:
                filtered.append(p)
        return filtered

    async def get_device_metrics(self, device_id: str, metric: str, start: str = "-24h", stop: str = "now()", aggregate_window: str = "5m") -> dict[str, Any]:
        points = self._filter_points(self.device_metrics[device_id][metric], start, stop)
        return {"device_id": device_id, "metric": metric, "aggregate_window": aggregate_window, "points": points}

    async def get_interface_metrics(self, device_id: str, interface_name: str, start: str = "-24h", stop: str = "now()", aggregate_window: str = "5m") -> dict[str, Any]:
        data = self.interface_metrics[device_id][interface_name]
        return {
            "device_id": device_id,
            "interface_name": interface_name,
            "aggregate_window": aggregate_window,
            "points": {
                field: self._filter_points(points, start, stop)
                for field, points in data.items()
            },
        }

    async def get_all_device_interfaces(self, device_id: str, start: str = "-24h", stop: str = "now()", aggregate_window: str = "5m") -> dict[str, Any]:
        interfaces: dict[str, Any] = {}
        for name, fields in self.interface_metrics[device_id].items():
            interfaces[name] = {
                field: self._filter_points(points, start, stop)
                for field, points in fields.items()
            }
        return {"device_id": device_id, "aggregate_window": aggregate_window, "points": interfaces}

    async def get_network_summary(self, start: str = "-24h", stop: str = "now()", aggregate_window: str = "15m") -> dict[str, Any]:
        return {
            "aggregate_window": aggregate_window,
            "points": {
                field: self._filter_points(points, start, stop)
                for field, points in self.network_summary.items()
            },
        }

    async def get_alert_timeline(self, start: str = "-7d", stop: str = "now()", device_id: str | None = None) -> dict[str, Any]:
        start_dt = self._parse_time_expr(start, datetime.now(timezone.utc) - timedelta(days=7))
        stop_dt = self._parse_time_expr(stop, datetime.now(timezone.utc))
        events = []
        for event in self.alert_events:
            t = datetime.fromisoformat(str(event["time"]).replace("Z", "+00:00"))
            if not (start_dt <= t <= stop_dt):
                continue
            if device_id and event.get("device_id") != device_id:
                continue
            events.append(event)
        events.sort(key=lambda e: e["time"], reverse=True)
        return {"events": events}

    async def get_speedtest_history(self, start: str = "-7d", stop: str = "now()", aggregate_window: str = "15m") -> dict[str, Any]:
        return {
            "aggregate_window": aggregate_window,
            "points": {
                field: self._filter_points(points, start, stop)
                for field, points in self.speedtest.items()
            },
        }

    async def get_top_talkers(self, start: str = "-1h", limit: int = 10) -> dict[str, Any]:
        start_dt = self._parse_time_expr(start, datetime.now(timezone.utc) - timedelta(hours=1))
        talkers = []
        for device_id, interfaces in self.interface_metrics.items():
            for interface_name, fields in interfaces.items():
                in_pts = [p for p in fields.get("in_bps", []) if datetime.fromisoformat(p["time"].replace("Z", "+00:00")) >= start_dt]
                out_pts = [p for p in fields.get("out_bps", []) if datetime.fromisoformat(p["time"].replace("Z", "+00:00")) >= start_dt]
                if not in_pts and not out_pts:
                    continue
                in_avg = sum(p["value"] for p in in_pts) / len(in_pts) if in_pts else 0
                out_avg = sum(p["value"] for p in out_pts) / len(out_pts) if out_pts else 0
                talkers.append({
                    "device_id": device_id,
                    "interface_name": interface_name,
                    "in_bps": in_avg,
                    "out_bps": out_avg,
                    "total_bps": in_avg + out_avg,
                })
        talkers.sort(key=lambda t: t["total_bps"], reverse=True)
        return {"talkers": talkers[:limit]}


demo_history_store = DemoHistoryStore()
