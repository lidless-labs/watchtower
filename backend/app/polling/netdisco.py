"""
Netdisco API Client

Polls device inventory, port data, and neighbor relationships from Netdisco.
API docs: https://github.com/netdisco/netdisco/wiki/API
"""

from __future__ import annotations

import httpx
from typing import Any
from urllib.parse import quote
from pydantic import BaseModel

from app.config import get_settings


def _path_segment(value: str) -> str:
    return quote(value, safe="")


class NetdiscoDevice(BaseModel):
    """Device data from Netdisco API"""
    ip: str
    name: str | None = None
    dns: str | None = None
    vendor: str | None = None
    model: str | None = None
    os: str | None = None
    os_ver: str | None = None
    serial: str | None = None
    location: str | None = None
    contact: str | None = None
    uptime: int | None = None
    last_discover: str | None = None
    last_macsuck: str | None = None
    last_arpnip: str | None = None


class NetdiscoPort(BaseModel):
    """Port/interface data from Netdisco API"""
    ip: str  # device IP
    port: str  # port name
    descr: str | None = None
    up: str | None = None  # "up" or "down"
    up_admin: str | None = None
    speed: str | None = None
    duplex: str | None = None
    vlan: int | None = None
    pvid: int | None = None
    type: str | None = None
    remote_ip: str | None = None
    remote_port: str | None = None
    remote_type: str | None = None
    is_uplink: bool | None = None


class NetdiscoNeighbor(BaseModel):
    """CDP/LLDP neighbor relationship from Netdisco"""
    local_ip: str
    local_port: str
    remote_ip: str | None = None
    remote_port: str | None = None
    remote_name: str | None = None
    remote_type: str | None = None
    protocol: str | None = None  # cdp, lldp, etc.


class NetdiscoClient:
    """
    Async client for Netdisco API v1

    Supports both Basic Auth (username/password) and Bearer token (api_key).
    Basic Auth is preferred if username/password are provided.

    Usage:
        async with NetdiscoClient() as client:
            devices = await client.get_devices()
            neighbors = await client.get_neighbors("10.1.1.1")
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        username: str | None = None,
        password: str | None = None,
    ):
        settings = get_settings()
        self.base_url = (base_url or settings.netdisco_url).rstrip('/')
        self.api_key = api_key or settings.netdisco_api_key
        self.username = username or settings.netdisco_username
        self.password = password or settings.netdisco_password
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "NetdiscoClient":
        import base64

        # Build authorization header - prefer Basic Auth with username/password
        if self.username and self.password:
            credentials = f"{self.username}:{self.password}"
            b64_creds = base64.b64encode(credentials.encode()).decode()
            auth_header = f"Basic {b64_creds}"
        elif self.api_key:
            auth_header = f"Bearer {self.api_key}"
        else:
            auth_header = ""

        headers = {
            "Authorization": auth_header,
            "Accept": "application/json",
        }

        self._client = httpx.AsyncClient(
            base_url=f"{self.base_url}/api/v1",
            headers=headers,
            timeout=30.0,
            verify=True,
        )
        return self

    async def __aexit__(self, *args) -> None:
        if self._client:
            await self._client.aclose()

    async def _get(self, endpoint: str, params: dict | None = None) -> Any:
        """Make GET request to Netdisco API"""
        if not self._client:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")

        response = await self._client.get(endpoint, params=params)

        # Netdisco sometimes returns 302 with valid JSON body (quirky behavior)
        if response.status_code in (200, 201, 302):
            try:
                return response.json()
            except Exception:
                pass

        response.raise_for_status()
        return response.json()

    # ─────────────────────────────────────────────────────────────
    # Search endpoints
    # ─────────────────────────────────────────────────────────────

    async def search_devices(self, query: str | None = None) -> list[NetdiscoDevice]:
        """
        Search for devices

        Args:
            query: Search string (hostname, IP, etc). None returns all.
        """
        params = {"q": query} if query else {}
        data = await self._get("/search/device", params=params if params else None)
        return [NetdiscoDevice(**d) for d in data] if isinstance(data, list) else []

    async def search_ports(self, query: str) -> list[NetdiscoPort]:
        """Search for ports by name or description"""
        data = await self._get("/search/port", params={"q": query})
        return [NetdiscoPort(**p) for p in data] if isinstance(data, list) else []

    # ─────────────────────────────────────────────────────────────
    # Object endpoints (device details)
    # ─────────────────────────────────────────────────────────────

    async def get_device(self, ip: str) -> NetdiscoDevice | None:
        """Get device by IP address"""
        try:
            data = await self._get(f"/object/device/{_path_segment(ip)}")
            return NetdiscoDevice(**data) if data else None
        except httpx.HTTPStatusError:
            return None

    async def get_device_ports(self, ip: str) -> list[NetdiscoPort]:
        """Get all ports for a device"""
        try:
            data = await self._get(f"/object/device/{_path_segment(ip)}/ports")
            return [NetdiscoPort(**p) for p in data] if isinstance(data, list) else []
        except httpx.HTTPStatusError:
            return []

    async def get_device_neighbors(self, ip: str) -> list[NetdiscoNeighbor]:
        """
        Get CDP/LLDP neighbors for a device

        This is the key endpoint for topology discovery.
        """
        try:
            # Netdisco stores neighbor info in the device_port table
            # We need to query ports and filter for those with remote_* fields
            ports = await self.get_device_ports(ip)
            neighbors = []

            for port in ports:
                if port.remote_ip or port.remote_port:
                    neighbors.append(NetdiscoNeighbor(
                        local_ip=port.ip,
                        local_port=port.port,
                        remote_ip=port.remote_ip,
                        remote_port=port.remote_port,
                        remote_name=None,  # Not always in port data
                        remote_type=port.remote_type,
                        protocol=None,
                    ))

            return neighbors
        except httpx.HTTPStatusError:
            return []

    # ─────────────────────────────────────────────────────────────
    # Topology building
    # ─────────────────────────────────────────────────────────────

    async def get_all_devices(self) -> list[NetdiscoDevice]:
        """Get all devices in Netdisco inventory"""
        return await self.search_devices(query=None)

    async def build_topology_connections(self) -> list[dict[str, Any]]:
        """
        Build connection map from all neighbor relationships

        Returns list of connections suitable for topology.yaml format
        """
        devices = await self.get_all_devices()
        connections = []
        seen_connections = set()

        for device in devices:
            neighbors = await self.get_device_neighbors(device.ip)

            for neighbor in neighbors:
                if not neighbor.remote_ip:
                    continue

                # Create a canonical key to avoid duplicate connections
                key = tuple(sorted([
                    f"{device.ip}:{neighbor.local_port}",
                    f"{neighbor.remote_ip}:{neighbor.remote_port or 'unknown'}"
                ]))

                if key not in seen_connections:
                    seen_connections.add(key)
                    connections.append({
                        "source": {
                            "device_ip": device.ip,
                            "port": neighbor.local_port,
                        },
                        "target": {
                            "device_ip": neighbor.remote_ip,
                            "port": neighbor.remote_port,
                        },
                        "protocol": neighbor.protocol or "lldp",
                    })

        return connections

    # ─────────────────────────────────────────────────────────────
    # Health check
    # ─────────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Test API connectivity"""
        try:
            # Try to search with empty query
            await self._get("/search/device", params={"q": ""})
            return True
        except Exception:
            return False


# ─────────────────────────────────────────────────────────────────
# Convenience functions
# ─────────────────────────────────────────────────────────────────

async def fetch_all_devices() -> list[NetdiscoDevice]:
    """Fetch all devices from Netdisco"""
    async with NetdiscoClient() as client:
        return await client.get_all_devices()


async def fetch_device_neighbors(ip: str) -> list[NetdiscoNeighbor]:
    """Fetch neighbors for a specific device"""
    async with NetdiscoClient() as client:
        return await client.get_device_neighbors(ip)


async def fetch_topology_connections() -> list[dict[str, Any]]:
    """Build topology connections from Netdisco neighbor data"""
    async with NetdiscoClient() as client:
        return await client.build_topology_connections()
