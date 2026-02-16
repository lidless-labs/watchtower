"""InfluxDB async client wrapper for historical metrics."""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


class InfluxHistoryClient:
    """Async wrapper around InfluxDB 2.x client."""

    def __init__(self) -> None:
        self._client = None
        self._write_api = None
        self._query_api = None

    async def connect(self) -> bool:
        """Connect to InfluxDB and initialize APIs."""
        if self._client:
            return True

        if not settings.influxdb_enabled:
            logger.info("InfluxDB history disabled")
            return False

        try:
            from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

            self._client = InfluxDBClientAsync(
                url=settings.influxdb_url,
                token=settings.influxdb_token,
                org=settings.influxdb_org,
            )
            self._write_api = self._client.write_api()
            self._query_api = self._client.query_api()

            healthy = await self.health_check()
            if healthy:
                logger.info("Connected to InfluxDB at %s", settings.influxdb_url)
            else:
                logger.warning("Connected to InfluxDB but health check failed")
            return healthy

        except Exception as e:
            logger.error("Failed to connect to InfluxDB: %s", e)
            self._client = None
            self._write_api = None
            self._query_api = None
            return False

    async def disconnect(self) -> None:
        """Disconnect from InfluxDB."""
        if self._client:
            try:
                await self._client.close()
            except Exception as e:
                logger.debug("Error closing InfluxDB client: %s", e)

        self._client = None
        self._write_api = None
        self._query_api = None

    async def health_check(self) -> bool:
        """Check InfluxDB health endpoint."""
        if not self._client:
            return False

        try:
            health = await self._client.health()
            return str(getattr(health, "status", "")).lower() == "pass"
        except Exception as e:
            logger.warning("InfluxDB health check failed: %s", e)
            return False

    def is_connected(self) -> bool:
        """Return whether the Influx client is currently ready."""
        return self._client is not None and self._write_api is not None and self._query_api is not None

    async def write(self, records: list[dict[str, Any]], measurement: str) -> None:
        """Write a batch of records to a measurement."""
        if not self.is_connected() or not records:
            return

        payload = []
        for record in records:
            tags = record.get("tags", {})
            fields = record.get("fields", {})
            time = record.get("time")
            if not fields:
                continue
            payload.append({
                "measurement": measurement,
                "tags": tags,
                "fields": fields,
                "time": time,
            })

        if not payload:
            return

        await self._write_api.write(
            bucket=settings.influxdb_bucket,
            org=settings.influxdb_org,
            record=payload,
        )

    async def query(self, flux: str) -> list[dict[str, Any]]:
        """Run a Flux query and return normalized records."""
        if not self.is_connected():
            return []

        result = await self._query_api.query(org=settings.influxdb_org, query=flux)
        rows: list[dict[str, Any]] = []

        for table in result:
            for record in table.records:
                values = dict(record.values)
                rows.append(values)

        return rows


influx_client = InfluxHistoryClient()
