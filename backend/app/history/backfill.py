"""Backfill historical data from LibreNMS into InfluxDB."""

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import get_config, settings
from app.polling.librenms import LibreNMSClient
from app.history.client import influx_client


def _init_influx_settings():
    """Sync InfluxDB settings from config (like main.py lifespan does)."""
    config = get_config()
    if config.influxdb.enabled:
        settings.influxdb_url = config.influxdb.url
        settings.influxdb_token = config.influxdb.token
        settings.influxdb_org = config.influxdb.org
        settings.influxdb_bucket = config.influxdb.bucket
        settings.influxdb_enabled = True

logger = logging.getLogger(__name__)


async def backfill_network_summary(days: int = 7, interval_minutes: int = 5) -> dict[str, Any]:
    """
    Backfill network_summary measurements from LibreNMS outage history.

    Args:
        days: Number of days to backfill
        interval_minutes: Granularity of data points in minutes

    Returns:
        Summary of backfill operation
    """
    print(f"Starting backfill for {days} days with {interval_minutes} minute intervals...")

    # Initialize settings and connect to InfluxDB
    _init_influx_settings()
    if not influx_client.is_connected():
        await influx_client.connect()

    if not influx_client.is_connected():
        return {"error": "Could not connect to InfluxDB"}

    now = datetime.now(timezone.utc)
    start_time = now - timedelta(days=days)
    interval = timedelta(minutes=interval_minutes)

    # Get all devices and their outages
    async with LibreNMSClient() as client:
        devices = await client.get_devices()
        total_devices = len(devices)
        print(f"Found {total_devices} devices")

        # Collect all outages for all devices
        # outages[device_id] = [(down_ts, up_ts), ...]
        device_outages: dict[int, list[tuple[datetime, datetime]]] = defaultdict(list)

        for device in devices:
            try:
                data = await client._get(f"/devices/{device.device_id}/outages")
                outages = data.get("outages", [])
                for outage in outages:
                    down_ts = datetime.fromtimestamp(outage["going_down"], tz=timezone.utc)
                    up_ts = datetime.fromtimestamp(outage["up_again"], tz=timezone.utc)
                    # Only include outages that overlap with our backfill period
                    if up_ts >= start_time:
                        device_outages[device.device_id].append((down_ts, up_ts))
            except Exception as e:
                logger.debug(f"Could not get outages for device {device.device_id}: {e}")

        print(f"Collected outages from {len(device_outages)} devices")

    # Generate time buckets and calculate up/down counts
    records = []
    current_time = start_time
    points_created = 0

    while current_time <= now:
        # For each time bucket, count how many devices were down
        devices_down = 0

        for device_id, outages in device_outages.items():
            for down_ts, up_ts in outages:
                # Device was down if current_time is between down and up
                if down_ts <= current_time < up_ts:
                    devices_down += 1
                    break  # Only count once per device

        devices_up = total_devices - devices_down

        records.append({
            "time": current_time.isoformat(),
            "tags": {},
            "fields": {
                "devices_up": devices_up,
                "devices_down": devices_down,
                "total_devices": total_devices,
                "active_alerts": 0,  # We don't have historical alert counts
            },
        })

        points_created += 1
        current_time += interval

        # Write in batches of 1000
        if len(records) >= 1000:
            await influx_client.write(records, measurement="network_summary")
            print(f"  Wrote {len(records)} records...")
            records = []

    # Write remaining records
    if records:
        await influx_client.write(records, measurement="network_summary")
        print(f"  Wrote {len(records)} records...")

    print(f"Backfill complete: {points_created} data points created")

    return {
        "status": "success",
        "days_backfilled": days,
        "interval_minutes": interval_minutes,
        "total_devices": total_devices,
        "points_created": points_created,
    }


async def backfill_alert_timeline(days: int = 7) -> dict[str, Any]:
    """
    Backfill alert_events from LibreNMS alert history.
    """
    print(f"Starting alert backfill for {days} days...")

    _init_influx_settings()
    if not influx_client.is_connected():
        await influx_client.connect()

    if not influx_client.is_connected():
        return {"error": "Could not connect to InfluxDB"}

    async with LibreNMSClient() as client:
        # Get alert log
        try:
            data = await client._get("/logs/alertlog")
            logs = data.get("logs", [])
            print(f"Found {len(logs)} alert log entries")
        except Exception as e:
            return {"error": f"Could not get alert logs: {e}"}

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)

        records = []
        for log in logs:
            try:
                # Parse timestamp
                ts_str = log.get("datetime")
                if not ts_str:
                    continue
                ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)

                if ts < cutoff:
                    continue

                state = log.get("state", 0)
                state_str = "active" if state == 1 else "resolved"

                records.append({
                    "time": ts.isoformat(),
                    "tags": {
                        "device_id": str(log.get("device_id", "unknown")),
                        "severity": "warning",  # LibreNMS doesn't have severity in alert log
                        "hostname": str(log.get("hostname", "unknown")),
                    },
                    "fields": {
                        "title": str(log.get("name", "Alert")),
                        "state": state_str,
                        "alert_id": int(log.get("id", 0)),
                    },
                })
            except Exception as e:
                logger.debug(f"Could not parse alert log entry: {e}")

        if records:
            await influx_client.write(records, measurement="alert_events")

        print(f"Alert backfill complete: {len(records)} events imported")

        return {
            "status": "success",
            "days_backfilled": days,
            "events_imported": len(records),
        }


async def run_backfill(days: int = 7):
    """Run all backfill operations."""
    print("=" * 60)
    print(f"BACKFILLING {days} DAYS OF HISTORICAL DATA")
    print("=" * 60)

    # Network summary (every 5 minutes)
    result1 = await backfill_network_summary(days=days, interval_minutes=5)
    print(f"\nNetwork summary: {result1}")

    # Alert timeline
    result2 = await backfill_alert_timeline(days=days)
    print(f"\nAlert timeline: {result2}")

    print("\n" + "=" * 60)
    print("BACKFILL COMPLETE")
    print("=" * 60)

    return {"network_summary": result1, "alert_timeline": result2}


if __name__ == "__main__":
    asyncio.run(run_backfill(days=7))
