"""
LibreNMS API Client

Polls device status, port statistics, and alerts from LibreNMS.
API docs: https://docs.librenms.org/API/
"""

from __future__ import annotations

import httpx
from typing import Any
from pydantic import BaseModel

from app.config import get_settings


class LibreNMSDevice(BaseModel):
    """Device data from LibreNMS API"""
    device_id: int
    hostname: str
    sysName: str | None = None
    ip: str | None = None
    status: int  # 1 = up, 0 = down
    status_reason: str | None = None
    location: str | None = None
    hardware: str | None = None
    os: str | None = None
    version: str | None = None
    uptime: int | None = None
    last_polled: str | None = None


class LibreNMSPort(BaseModel):
    """Port/interface data from LibreNMS API"""
    port_id: int | None = None  # Some devices may not have port_id
    device_id: int | None = None  # Some devices may not have device_id
    ifName: str | None = None
    ifAlias: str | None = None
    ifDescr: str | None = None
    ifSpeed: int | None = None  # bits per second
    ifOperStatus: str | None = None  # up, down
    ifAdminStatus: str | None = None
    ifInOctets_rate: float | None = None
    ifOutOctets_rate: float | None = None
    ifInErrors_rate: float | None = None
    ifOutErrors_rate: float | None = None


class LibreNMSAlert(BaseModel):
    """Alert data from LibreNMS API"""
    id: int
    device_id: int
    rule_id: int
    state: int  # 0 = ok, 1 = alert, 2 = ack
    severity: str | None = None
    title: str | None = None
    timestamp: str | None = None
    hostname: str | None = None


class LibreNMSLink(BaseModel):
    """CDP/LLDP neighbor link from LibreNMS API"""
    id: int | None = None
    local_device_id: int
    local_port_id: int | None = None
    local_port: str | None = None  # Local interface name
    remote_hostname: str | None = None
    remote_port: str | None = None  # Remote interface name
    remote_device_id: int | None = None
    protocol: str | None = None  # cdp, lldp, etc.


class LibreNMSHealthSensor(BaseModel):
    """Health sensor data from LibreNMS API (processor, memory, storage)"""
    sensor_id: int
    sensor_class: str  # processor, memory, storage, temperature, etc.
    sensor_type: str | None = None
    sensor_descr: str | None = None
    sensor_current: float | None = None  # Current value (e.g., % usage)
    sensor_limit: float | None = None
    sensor_limit_low: float | None = None


class LibreNMSVlan(BaseModel):
    """VLAN data from LibreNMS API"""
    vlan_id: int
    vlan_vlan: int  # Actual VLAN number
    vlan_domain: int | None = None
    vlan_name: str | None = None
    vlan_type: str | None = None
    vlan_mtu: int | None = None
    device_id: int | None = None


class LibreNMSDeviceVlan(BaseModel):
    """Device VLAN membership from LibreNMS API"""
    device_id: int
    vlan_id: int  # Internal LibreNMS ID
    vlan_vlan: int  # Actual VLAN number
    vlan_name: str | None = None
    port_id: int | None = None
    ifName: str | None = None
    untagged: int | None = None  # 1 = untagged, 0 = tagged


class LibreNMSClient:
    """
    Async client for LibreNMS API v0

    Usage:
        async with LibreNMSClient() as client:
            devices = await client.get_devices()
    """

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        settings = get_settings()
        self.base_url = (base_url or settings.librenms_url).rstrip('/')
        self.api_key = api_key or settings.librenms_api_key
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "LibreNMSClient":
        self._client = httpx.AsyncClient(
            base_url=f"{self.base_url}/api/v0",
            headers={"X-Auth-Token": self.api_key},
            timeout=30.0,
            verify=True,  # Set to False if using self-signed certs
        )
        return self

    async def __aexit__(self, *args) -> None:
        if self._client:
            await self._client.aclose()

    async def _get(self, endpoint: str, params: dict | None = None) -> dict[str, Any]:
        """Make GET request to LibreNMS API"""
        if not self._client:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")

        response = await self._client.get(endpoint, params=params)
        response.raise_for_status()
        return response.json()

    # ─────────────────────────────────────────────────────────────
    # Device endpoints
    # ─────────────────────────────────────────────────────────────

    async def get_devices(self) -> list[LibreNMSDevice]:
        """Get all devices"""
        data = await self._get("/devices")
        return [LibreNMSDevice(**d) for d in data.get("devices", [])]

    async def get_device(self, device_id: int | str) -> LibreNMSDevice | None:
        """Get single device by ID or hostname"""
        try:
            data = await self._get(f"/devices/{device_id}")
            devices = data.get("devices", [])
            return LibreNMSDevice(**devices[0]) if devices else None
        except httpx.HTTPStatusError:
            return None

    async def get_device_by_hostname(self, hostname: str) -> LibreNMSDevice | None:
        """Get device by hostname"""
        return await self.get_device(hostname)

    # ─────────────────────────────────────────────────────────────
    # Port/Interface endpoints
    # ─────────────────────────────────────────────────────────────

    async def get_ports(self, device_id: int | str | None = None) -> list[LibreNMSPort]:
        """Get ports, optionally filtered by device"""
        # Request specific columns - LibreNMS only returns ifName by default
        columns = "port_id,device_id,ifName,ifAlias,ifDescr,ifSpeed,ifOperStatus,ifAdminStatus,ifInOctets_rate,ifOutOctets_rate,ifInErrors_rate,ifOutErrors_rate"
        params = {"columns": columns}

        if device_id:
            data = await self._get(f"/devices/{device_id}/ports", params=params)
        else:
            data = await self._get("/ports", params=params)
        return [LibreNMSPort(**p) for p in data.get("ports", [])]

    async def get_port(self, port_id: int) -> LibreNMSPort | None:
        """Get single port by ID"""
        try:
            data = await self._get(f"/ports/{port_id}")
            # LibreNMS returns {"port": [{...}]} for single port lookup
            if "ports" in data:
                ports = data["ports"]
            elif "port" in data:
                port_data = data["port"]
                ports = port_data if isinstance(port_data, list) else [port_data]
            else:
                ports = []
            return LibreNMSPort(**ports[0]) if ports and ports[0] else None
        except httpx.HTTPStatusError:
            return None

    # ─────────────────────────────────────────────────────────────
    # Alert endpoints
    # ─────────────────────────────────────────────────────────────

    async def get_alerts(self, state: str | None = None) -> list[LibreNMSAlert]:
        """
        Get alerts

        Args:
            state: Filter by state - "ok", "alert", "ack", or None for all
        """
        params = {}
        if state:
            # LibreNMS uses numeric states: 0=ok, 1=alert, 2=ack
            state_map = {"ok": 0, "alert": 1, "ack": 2}
            if state in state_map:
                params["state"] = state_map[state]

        data = await self._get("/alerts", params=params if params else None)
        return [LibreNMSAlert(**a) for a in data.get("alerts", [])]

    async def get_active_alerts(self) -> list[LibreNMSAlert]:
        """Get only active (firing) alerts"""
        return await self.get_alerts(state="alert")

    # ─────────────────────────────────────────────────────────────
    # Link/Neighbor endpoints (CDP/LLDP discovery)
    # ─────────────────────────────────────────────────────────────

    async def get_links(self, device_id: int | str | None = None) -> list[LibreNMSLink]:
        """
        Get CDP/LLDP neighbor links.

        Args:
            device_id: Optional device ID to filter links for a specific device

        Returns:
            List of discovered neighbor links. Returns [] if LibreNMS reports
            no data (404), matching the behavior of get_vlans / get_device_health.
        """
        try:
            if device_id:
                data = await self._get(f"/devices/{device_id}/links")
            else:
                data = await self._get("/resources/links")
        except httpx.HTTPStatusError:
            return []
        return [LibreNMSLink(**link) for link in data.get("links", [])]

    async def get_all_links(self) -> list[LibreNMSLink]:
        """Get all CDP/LLDP links across all devices"""
        return await self.get_links()

    # ─────────────────────────────────────────────────────────────
    # Health/Sensor endpoints (CPU, memory, temperature)
    # ─────────────────────────────────────────────────────────────

    async def get_device_health(
        self, device_id: int | str, sensor_class: str | None = None
    ) -> list[LibreNMSHealthSensor]:
        """
        Get health sensors for a device.

        Args:
            device_id: Device ID or hostname
            sensor_class: Filter by class (processor, memory, storage, temperature)

        Returns:
            List of health sensors with current values
        """
        try:
            if sensor_class:
                data = await self._get(f"/devices/{device_id}/health/{sensor_class}")
            else:
                data = await self._get(f"/devices/{device_id}/health")
            return [LibreNMSHealthSensor(**s) for s in data.get("data", [])]
        except httpx.HTTPStatusError:
            return []

    async def get_device_processor(self, device_id: int | str) -> float | None:
        """Get average CPU usage for a device (returns percentage)."""
        sensors = await self.get_device_health(device_id, "processor")
        if not sensors:
            return None
        # Average all processor sensors
        values = [s.sensor_current for s in sensors if s.sensor_current is not None]
        return sum(values) / len(values) if values else None

    async def get_device_memory(self, device_id: int | str) -> float | None:
        """Get memory usage for a device (returns percentage)."""
        sensors = await self.get_device_health(device_id, "memory")
        if not sensors:
            return None
        # Usually just one memory sensor, take the first or average
        values = [s.sensor_current for s in sensors if s.sensor_current is not None]
        return values[0] if values else None

    # ─────────────────────────────────────────────────────────────
    # VLAN endpoints
    # ─────────────────────────────────────────────────────────────

    async def get_vlans(self) -> list[LibreNMSVlan]:
        """
        Get all VLANs across all devices.

        Returns:
            List of VLANs with their IDs and names
        """
        try:
            # Use /resources/vlans endpoint (not /vlans)
            data = await self._get("/resources/vlans")
            return [LibreNMSVlan(**v) for v in data.get("vlans", [])]
        except httpx.HTTPStatusError:
            return []

    async def get_device_vlans(self, device_id: int | str) -> list[LibreNMSDeviceVlan]:
        """
        Get VLANs configured on a specific device with port mappings.

        Args:
            device_id: Device ID or hostname

        Returns:
            List of VLAN memberships including which ports are in each VLAN
        """
        try:
            data = await self._get(f"/devices/{device_id}/vlans")
            return [LibreNMSDeviceVlan(**v) for v in data.get("vlans", [])]
        except httpx.HTTPStatusError:
            return []

    # ─────────────────────────────────────────────────────────────
    # Health check
    # ─────────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Test API connectivity"""
        try:
            await self._get("/system")
            return True
        except Exception:
            return False


# ─────────────────────────────────────────────────────────────────
# Convenience functions for one-off calls
# ─────────────────────────────────────────────────────────────────

async def fetch_all_devices() -> list[LibreNMSDevice]:
    """Fetch all devices from LibreNMS"""
    async with LibreNMSClient() as client:
        return await client.get_devices()


async def fetch_device_ports(device_id: int | str) -> list[LibreNMSPort]:
    """Fetch all ports for a device"""
    async with LibreNMSClient() as client:
        return await client.get_ports(device_id)


async def fetch_active_alerts() -> list[LibreNMSAlert]:
    """Fetch active alerts from LibreNMS"""
    async with LibreNMSClient() as client:
        return await client.get_active_alerts()


async def fetch_all_links() -> list[LibreNMSLink]:
    """Fetch all CDP/LLDP links from LibreNMS"""
    async with LibreNMSClient() as client:
        return await client.get_all_links()


async def fetch_all_vlans() -> list[LibreNMSVlan]:
    """Fetch all VLANs from LibreNMS"""
    async with LibreNMSClient() as client:
        return await client.get_vlans()


async def fetch_device_vlans(device_id: int | str) -> list[LibreNMSDeviceVlan]:
    """Fetch VLANs for a specific device from LibreNMS"""
    async with LibreNMSClient() as client:
        return await client.get_device_vlans(device_id)
