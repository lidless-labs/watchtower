"""Deterministic demo history seeding for 7-day time-series."""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

from app.demo_data import DEMO_DEVICES

from .demo_store import DemoHistoryStore


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _business_factor(dt: datetime) -> float:
    hour = dt.hour + (dt.minute / 60)
    weekday = dt.weekday() < 5
    if not weekday:
        return 0.45
    return 0.55 + 0.45 * max(0.0, math.sin(((hour - 7) / 12) * math.pi))


def seed_demo_history(store: DemoHistoryStore) -> None:
    """Populate demo store with 7 days of deterministic historical data."""
    rng = random.Random(1107)
    store.reset()

    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now - timedelta(days=7)
    step = timedelta(minutes=5)

    alert_budget = rng.randint(15, 25)
    alert_candidates: list[tuple[datetime, dict]] = []

    # First pass: generate per-device metrics
    for device in DEMO_DEVICES:
        device_id = device["id"]
        device_type = str(device["type"])

        t = start
        while t <= now:
            b = _business_factor(t)
            phase = (t.timestamp() / 3600.0) + (hash(device_id) % 17)

            cpu_base = 16 + (35 * b) + (8 * math.sin(phase / 2.2))
            mem_base = 28 + (30 * b) + (5 * math.cos(phase / 3.4))

            if device_type.endswith("firewall"):
                cpu_base += 8
                mem_base += 5
            elif device_type.endswith("access_point"):
                cpu_base += 4
                mem_base -= 2

            cpu = max(2.0, min(99.0, cpu_base + rng.uniform(-4.5, 4.5)))
            memory = max(8.0, min(98.0, mem_base + rng.uniform(-3.0, 3.0)))
            if rng.random() < 0.012:
                cpu = min(99.0, cpu + rng.uniform(10, 25))

            store.device_metrics[device_id]["cpu"].append({"time": _iso(t), "value": round(cpu, 2)})
            store.device_metrics[device_id]["memory"].append({"time": _iso(t), "value": round(memory, 2)})

            # 2-4 interfaces per device with bursty throughput
            interface_count = 4 if device_type.endswith("switch") else 2
            for idx in range(interface_count):
                if_name = f"if{idx + 1}"
                speed_mbps = 1000 if device_type.endswith("switch") else 10000
                base_load = (0.08 + 0.22 * b) * speed_mbps * 1_000_000
                burst = rng.uniform(1.8, 3.8) if rng.random() < 0.025 else 1.0
                in_bps = max(0, int(base_load * burst * rng.uniform(0.5, 1.3)))
                out_bps = max(0, int(base_load * burst * rng.uniform(0.4, 1.1)))
                utilization = ((in_bps + out_bps) / (speed_mbps * 1_000_000)) * 100

                store.interface_metrics[device_id][if_name]["in_bps"].append({"time": _iso(t), "value": in_bps})
                store.interface_metrics[device_id][if_name]["out_bps"].append({"time": _iso(t), "value": out_bps})
                store.interface_metrics[device_id][if_name]["utilization"].append({"time": _iso(t), "value": round(utilization, 2)})

            # Candidate alerts scattered with higher chance during business hours
            if rng.random() < (0.002 + 0.006 * b):
                alert_candidates.append((t, {
                    "device_id": device_id,
                    "severity": rng.choices(["warning", "critical", "info"], weights=[0.65, 0.2, 0.15])[0],
                    "hostname": device["name"],
                    "title": rng.choice([
                        "High CPU utilization",
                        "Interface packet errors detected",
                        "Memory pressure threshold exceeded",
                        "Intermittent latency detected",
                    ]),
                }))

            t += step

    # Second pass: compute network summary once per timestamp
    total_devices = len(DEMO_DEVICES)
    t = start
    point_idx = 0
    while t <= now:
        # Count devices "down" based on CPU threshold (simulated)
        devices_down = 0
        for device in DEMO_DEVICES:
            cpu_points = store.device_metrics[device["id"]]["cpu"]
            if point_idx < len(cpu_points) and cpu_points[point_idx]["value"] > 97.5 and rng.random() < 0.15:
                devices_down += 1
        devices_up = total_devices - devices_down

        store.network_summary["devices_up"].append({"time": _iso(t), "value": devices_up})
        store.network_summary["devices_down"].append({"time": _iso(t), "value": devices_down})
        store.network_summary["total_devices"].append({"time": _iso(t), "value": total_devices})

        t += step
        point_idx += 1

    # Finalize alerts
    alert_candidates.sort(key=lambda x: x[0])
    selected = alert_candidates[:alert_budget]
    active_over_time: dict[str, int] = {}
    for idx, (alert_time, alert) in enumerate(selected, start=1):
        state = "active" if rng.random() < 0.7 else "resolved"
        event = {
            "time": _iso(alert_time),
            "alert_id": idx,
            "state": state,
            **alert,
        }
        store.alert_events.append(event)
        key = _iso(alert_time)
        active_over_time[key] = active_over_time.get(key, 0) + (1 if state == "active" else 0)

    # Compute active_alerts over time
    running_alerts = 0
    for point in store.network_summary["devices_up"]:
        ts = point["time"]
        running_alerts += active_over_time.get(ts, 0)
        running_alerts = max(0, running_alerts)
        store.network_summary["active_alerts"].append({"time": ts, "value": running_alerts})

    # Speedtest with occasional degradation windows
    degraded_windows = []
    for _ in range(4):
        window_start = start + timedelta(hours=rng.randint(6, 156))
        degraded_windows.append((window_start, window_start + timedelta(hours=rng.randint(1, 4))))

    t = start
    while t <= now:
        degraded = any(s <= t <= e for s, e in degraded_windows)
        dl = rng.uniform(410, 500)
        ul = rng.uniform(390, 480)
        ping = rng.uniform(8, 18)
        jitter = rng.uniform(0.8, 4.2)
        if degraded:
            dl *= rng.uniform(0.35, 0.65)
            ul *= rng.uniform(0.4, 0.75)
            ping *= rng.uniform(1.8, 3.2)
            jitter *= rng.uniform(1.8, 3.5)

        store.speedtest["download_mbps"].append({"time": _iso(t), "value": round(dl, 2)})
        store.speedtest["upload_mbps"].append({"time": _iso(t), "value": round(ul, 2)})
        store.speedtest["ping_ms"].append({"time": _iso(t), "value": round(ping, 2)})
        store.speedtest["jitter_ms"].append({"time": _iso(t), "value": round(jitter, 2)})

        t += timedelta(minutes=15)
