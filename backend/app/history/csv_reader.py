"""CSV-based history reader for speedtest data.

Falls back to reading from CSV when InfluxDB is not available.
"""

from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.config import get_config


class CSVHistoryReader:
    """Reads speedtest history from CSV log file."""

    _DEFAULT_FALLBACK_PATH = "/var/lib/watchtower/speedtest.csv"

    def __init__(self, csv_path: str | None = None) -> None:
        # When an explicit path is provided we honor it (used for tests and
        # for callers that want to read a non-default file). Otherwise the
        # path is resolved per-read so persisting a new
        # config.speedtest.logging.path through the settings API takes
        # effect without a process restart.
        self._explicit_path = Path(csv_path) if csv_path else None

    @property
    def csv_path(self) -> Path:
        if self._explicit_path is not None:
            return self._explicit_path
        try:
            return Path(get_config().speedtest.logging.path)
        except Exception:
            return Path(self._DEFAULT_FALLBACK_PATH)

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
            if unit == "w":
                return now - timedelta(weeks=qty)
        try:
            parsed = datetime.fromisoformat(v.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except Exception:
            return default

    def _read_csv(self, start_dt: datetime, stop_dt: datetime) -> list[dict[str, Any]]:
        """Read speedtest CSV and filter by time range."""
        if not self.csv_path.exists():
            return []

        rows = []
        with open(self.csv_path, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    ts = row.get("timestamp", "")
                    if not ts:
                        continue
                    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    if start_dt <= t <= stop_dt:
                        # Only include successful results
                        if row.get("status") != "success":
                            continue
                        rows.append({
                            "time": ts,
                            "download_mbps": float(row.get("download_mbps", 0)),
                            "upload_mbps": float(row.get("upload_mbps", 0)),
                            "ping_ms": float(row.get("ping_ms", 0)),
                            "jitter_ms": float(row.get("jitter_ms", 0)),
                        })
                except (ValueError, KeyError):
                    continue

        return rows

    async def get_speedtest_history(
        self,
        start: str = "-7d",
        stop: str = "now()",
        aggregate_window: str = "15m",
    ) -> dict[str, Any]:
        """Return speedtest history from CSV."""
        start_dt = self._parse_time_expr(start, datetime.now(timezone.utc) - timedelta(days=7))
        stop_dt = self._parse_time_expr(stop, datetime.now(timezone.utc))

        rows = self._read_csv(start_dt, stop_dt)

        # Convert to points format expected by frontend
        points = []
        for row in rows:
            points.append({
                "time": row["time"],
                "download_mbps": row["download_mbps"],
                "upload_mbps": row["upload_mbps"],
                "ping_ms": row["ping_ms"],
                "jitter_ms": row["jitter_ms"],
            })

        return {"points": points, "aggregate_window": aggregate_window}

    # Stub methods for other endpoints (return empty data)
    async def get_device_metrics(self, *args, **kwargs) -> dict[str, Any]:
        return {"points": []}

    async def get_interface_metrics(self, *args, **kwargs) -> dict[str, Any]:
        return {"points": {}}

    async def get_all_device_interfaces(self, *args, **kwargs) -> dict[str, Any]:
        return {"interfaces": {}}

    async def get_network_summary(self, *args, **kwargs) -> dict[str, Any]:
        return {"series": {}}

    async def get_alert_timeline(self, *args, **kwargs) -> dict[str, Any]:
        return {"events": []}

    async def get_top_talkers(self, *args, **kwargs) -> dict[str, Any]:
        return {"talkers": []}


csv_history_reader = CSVHistoryReader()
