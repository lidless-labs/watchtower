"""
Proxmox API Client

Polls node stats, VMs, and containers from Proxmox VE.
API docs: https://pve.proxmox.com/pve-docs/api-viewer/
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger("watchtower.proxmox")
_PROXMOX_NODE_FETCH_TIMEOUT = 30.0
_PROXMOX_VM_BATCH_TIMEOUT = 120.0
_PROXMOX_NODE_FETCH_CONCURRENCY = 5


def _path_segment(value: str) -> str:
    return quote(value, safe="")


class ProxmoxNode(BaseModel):
    """Node data from Proxmox API"""
    node: str  # Node name (e.g., "pve1")
    status: str  # online, offline
    cpu: float | None = None  # CPU usage 0-1
    maxcpu: int | None = None  # CPU cores
    mem: int | None = None  # Memory used (bytes)
    maxmem: int | None = None  # Total memory (bytes)
    uptime: int | None = None  # Seconds

    @property
    def cpu_percent(self) -> float:
        """CPU usage as percentage"""
        return round((self.cpu or 0) * 100, 2)

    @property
    def memory_percent(self) -> float:
        """Memory usage as percentage"""
        if not self.maxmem or self.maxmem == 0:
            return 0.0
        return round((self.mem or 0) / self.maxmem * 100, 2)


class ProxmoxVM(BaseModel):
    """VM or container data from Proxmox API"""
    vmid: int
    name: str
    node: str  # Which node it runs on
    type: str  # "qemu" or "lxc"
    status: str  # running, stopped, paused
    cpu: float | None = None  # CPU usage 0-1
    cpus: int | None = None  # Allocated vCPUs
    mem: int | None = None  # Memory used (bytes)
    maxmem: int | None = None  # Allocated memory (bytes)
    uptime: int | None = None
    netin: int | None = None  # Network in (bytes)
    netout: int | None = None  # Network out (bytes)

    @property
    def cpu_percent(self) -> float:
        """CPU usage as percentage of allocated vCPUs"""
        return round((self.cpu or 0) * 100, 2)

    @property
    def memory_percent(self) -> float:
        """Memory usage as percentage"""
        if not self.maxmem or self.maxmem == 0:
            return 0.0
        return round((self.mem or 0) / self.maxmem * 100, 2)


class ProxmoxClient:
    """
    Async client for Proxmox VE API

    Uses API token authentication (preferred over user/password).

    Usage:
        async with ProxmoxClient() as client:
            nodes = await client.get_nodes()
            vms = await client.get_vms()
    """

    def __init__(
        self,
        base_url: str | None = None,
        token_id: str | None = None,
        token_secret: str | None = None,
        verify_ssl: bool | None = None,
    ):
        settings = get_settings()
        self.base_url = (base_url or settings.proxmox_url).rstrip('/')
        self.token_id = token_id or settings.proxmox_token_id
        self.token_secret = token_secret or settings.proxmox_token_secret
        self.verify_ssl = verify_ssl if verify_ssl is not None else settings.proxmox_verify_ssl
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "ProxmoxClient":
        # Proxmox API token format: PVEAPIToken=user@realm!tokenid=secret
        auth_header = f"PVEAPIToken={self.token_id}={self.token_secret}"

        self._client = httpx.AsyncClient(
            base_url=f"{self.base_url}/api2/json",
            headers={"Authorization": auth_header},
            timeout=30.0,
            verify=self.verify_ssl,
        )
        return self

    async def __aexit__(self, *args) -> None:
        if self._client:
            await self._client.aclose()

    async def _get(self, endpoint: str, params: dict | None = None) -> dict[str, Any]:
        """Make GET request to Proxmox API"""
        if not self._client:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")

        response = await self._client.get(endpoint, params=params)
        response.raise_for_status()
        return response.json()

    # ─────────────────────────────────────────────────────────────
    # Node endpoints
    # ─────────────────────────────────────────────────────────────

    async def get_nodes(self) -> list[ProxmoxNode]:
        """Get all cluster nodes with stats"""
        data = await self._get("/nodes")
        return [ProxmoxNode(**n) for n in data.get("data", [])]

    async def get_node(self, node: str) -> ProxmoxNode | None:
        """Get single node status"""
        try:
            data = await self._get(f"/nodes/{_path_segment(node)}/status")
            node_data = data.get("data", {})
            node_data["node"] = node
            node_data["status"] = "online"
            return ProxmoxNode(**node_data)
        except httpx.HTTPStatusError:
            return None

    # ─────────────────────────────────────────────────────────────
    # VM/Container endpoints
    # ─────────────────────────────────────────────────────────────

    async def get_vms(self, running_only: bool = False) -> list[ProxmoxVM]:
        """
        Get all VMs and containers across all nodes.

        Args:
            running_only: If True, only return running VMs/containers
        """
        nodes = await self.get_nodes()
        online_nodes = [node for node in nodes if node.status == "online"]
        semaphore = asyncio.Semaphore(_PROXMOX_NODE_FETCH_CONCURRENCY)

        async def _fetch_node_instances(node_name: str, instance_type: str) -> list[ProxmoxVM]:
            endpoint = f"/nodes/{_path_segment(node_name)}/{instance_type}"
            try:
                async with semaphore:
                    data = await asyncio.wait_for(self._get(endpoint), timeout=_PROXMOX_NODE_FETCH_TIMEOUT)
            except asyncio.TimeoutError:
                logger.warning("Timed out fetching %s data for Proxmox node %s", instance_type, node_name)
                return []
            except httpx.HTTPStatusError as exc:
                logger.warning(
                    "Failed to fetch %s data for Proxmox node %s: %s",
                    instance_type,
                    node_name,
                    exc,
                )
                return []
            except Exception as exc:
                logger.warning(
                    "Unexpected error fetching %s data for Proxmox node %s: %s",
                    instance_type,
                    node_name,
                    exc,
                )
                return []

            items: list[ProxmoxVM] = []
            for raw in data.get("data", []):
                raw["node"] = node_name
                raw["type"] = instance_type

                if running_only and raw.get("status") != "running":
                    continue

                try:
                    items.append(ProxmoxVM(**raw))
                except Exception as exc:
                    logger.warning(
                        "Skipping invalid Proxmox VM record for node=%s type=%s: %s raw=%s",
                        node_name,
                        instance_type,
                        exc,
                        raw,
                    )
            return items

        tasks = [
            asyncio.create_task(_fetch_node_instances(node.node, instance_type))
            for node in online_nodes
            for instance_type in ("qemu", "lxc")
        ]

        try:
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=_PROXMOX_VM_BATCH_TIMEOUT,
            )
        except asyncio.TimeoutError:
            logger.warning("Timed out fetching Proxmox VM inventory after %ss", _PROXMOX_VM_BATCH_TIMEOUT)
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            return []

        all_vms: list[ProxmoxVM] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Ignoring Proxmox node fetch failure: %s", result)
                continue
            all_vms.extend(result)

        return all_vms

    async def get_node_vms(self, node: str, running_only: bool = False) -> list[ProxmoxVM]:
        """Get VMs and containers for a specific node"""
        vms: list[ProxmoxVM] = []

        # QEMU VMs
        try:
            qemu_data = await self._get(f"/nodes/{_path_segment(node)}/qemu")
            for vm in qemu_data.get("data", []):
                vm["node"] = node
                vm["type"] = "qemu"
                vms.append(ProxmoxVM(**vm))
        except httpx.HTTPStatusError:
            pass

        # LXC containers
        try:
            lxc_data = await self._get(f"/nodes/{_path_segment(node)}/lxc")
            for ct in lxc_data.get("data", []):
                ct["node"] = node
                ct["type"] = "lxc"
                vms.append(ProxmoxVM(**ct))
        except httpx.HTTPStatusError:
            pass

        if running_only:
            vms = [vm for vm in vms if vm.status == "running"]

        return vms

    # ─────────────────────────────────────────────────────────────
    # Storage endpoints
    # ─────────────────────────────────────────────────────────────

    async def get_node_storage(self, node: str) -> list[dict]:
        """Get storage for a specific node"""
        try:
            data = await self._get(f"/nodes/{_path_segment(node)}/storage")
            storage_list = []
            for s in data.get("data", []):
                storage_list.append({
                    "storage": s.get("storage"),
                    "type": s.get("type"),
                    "content": s.get("content"),
                    "used": s.get("used", 0),
                    "total": s.get("total", 0),
                    "avail": s.get("avail", 0),
                    "active": s.get("active", 1),
                    "enabled": s.get("enabled", 1),
                    "shared": s.get("shared", 0),
                })
            return storage_list
        except httpx.HTTPStatusError:
            return []

    # ─────────────────────────────────────────────────────────────
    # Health check
    # ─────────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Test API connectivity"""
        try:
            await self._get("/version")
            return True
        except Exception:
            return False


# ─────────────────────────────────────────────────────────────────
# Convenience functions for one-off calls
# ─────────────────────────────────────────────────────────────────

async def fetch_all_nodes() -> list[ProxmoxNode]:
    """Fetch all nodes from Proxmox"""
    async with ProxmoxClient() as client:
        return await client.get_nodes()


async def fetch_all_vms(running_only: bool = False) -> list[ProxmoxVM]:
    """Fetch all VMs and containers from Proxmox"""
    async with ProxmoxClient() as client:
        return await client.get_vms(running_only=running_only)
