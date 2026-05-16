"""VM API routes for Proxmox VMs and containers."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..cache import redis_cache
from ..polling.scheduler import CACHE_PROXMOX_VMS, CACHE_PROXMOX

router = APIRouter()


class ProxmoxVMResponse(BaseModel):
    """VM/container data for API response"""
    vmid: int
    name: str
    node: str
    instance: str
    type: str  # "qemu" or "lxc"
    status: str
    cpu: float
    memory: float
    cpus: int | None = None
    maxmem: int | None = None
    uptime: int | None = None
    netin: int | None = None
    netout: int | None = None


class VMSummary(BaseModel):
    """Summary statistics for VMs"""
    total_running: int
    total_qemu: int
    total_lxc: int
    total_cpus: int
    total_memory_gb: float


class VMListResponse(BaseModel):
    """Response for VM list endpoint"""
    vms: list[ProxmoxVMResponse]
    summary: VMSummary


@router.get("/vms", response_model=VMListResponse)
async def list_vms():
    """
    List all running VMs and containers from Proxmox.

    Returns VMs sorted by name with summary statistics.
    """
    cached = await redis_cache.get_json(CACHE_PROXMOX_VMS) or []

    vms = [ProxmoxVMResponse(**vm) for vm in cached]
    vms.sort(key=lambda v: v.name.lower())

    # Calculate summary stats
    total_cpus = sum(vm.cpus or 0 for vm in vms)
    total_memory_bytes = sum(vm.maxmem or 0 for vm in vms)
    total_memory_gb = round(total_memory_bytes / (1024 ** 3), 1)

    summary = VMSummary(
        total_running=len(vms),
        total_qemu=sum(1 for vm in vms if vm.type == "qemu"),
        total_lxc=sum(1 for vm in vms if vm.type == "lxc"),
        total_cpus=total_cpus,
        total_memory_gb=total_memory_gb,
    )

    return VMListResponse(vms=vms, summary=summary)


@router.get("/vms/summary", response_model=VMSummary)
async def get_vm_summary():
    """Get summary statistics for running VMs."""
    cached = await redis_cache.get_json(CACHE_PROXMOX_VMS) or []

    vms = [ProxmoxVMResponse(**vm) for vm in cached]

    total_cpus = sum(vm.cpus or 0 for vm in vms)
    total_memory_bytes = sum(vm.maxmem or 0 for vm in vms)
    total_memory_gb = round(total_memory_bytes / (1024 ** 3), 1)

    return VMSummary(
        total_running=len(vms),
        total_qemu=sum(1 for vm in vms if vm.type == "qemu"),
        total_lxc=sum(1 for vm in vms if vm.type == "lxc"),
        total_cpus=total_cpus,
        total_memory_gb=total_memory_gb,
    )


class NodeVMInfo(BaseModel):
    """VM info for node detail panel"""
    vmid: int
    name: str
    type: str
    status: str
    cpu: float
    memory: float


class NodeStorageInfo(BaseModel):
    """Storage info for node detail panel"""
    storage: str
    type: str
    used: int
    total: int
    used_percent: float


class NodeInfo(BaseModel):
    """Node info for detail panel"""
    node: str
    status: str
    cpu: float
    memory: float
    maxcpu: int
    maxmem: int
    uptime: int


class ProxmoxNodeDetailResponse(BaseModel):
    """Full Proxmox node detail for sidebar panel"""
    node: NodeInfo | None
    vms: list[NodeVMInfo]
    lxcs: list[NodeVMInfo]
    storage: list[NodeStorageInfo]
    vms_running: int
    vms_total: int
    lxcs_running: int
    lxcs_total: int


@router.get("/vms/node/{node_name}", response_model=ProxmoxNodeDetailResponse)
async def get_node_detail(node_name: str):
    """
    Get detailed Proxmox node info including VMs, containers, and storage.

    The node_name can match the node field OR the instance field.
    """
    cached_nodes = await redis_cache.get_json(CACHE_PROXMOX) or {}
    cached_vms = await redis_cache.get_json(CACHE_PROXMOX_VMS) or []

    # Find matching node - try various matching strategies
    node_data = None
    matched_node_name = None
    matched_instance = None

    # Normalize node_name for matching (remove spaces, lowercase)
    normalized_input = node_name.lower().replace(" ", "").replace("-", "").replace("_", "")

    for key, data in cached_nodes.items():
        node = data.get("node", "")
        instance = data.get("instance", "")

        # Strategy 1: Exact match on node or instance
        if node == node_name or instance == node_name:
            node_data = data
            matched_node_name = node
            matched_instance = instance
            break

        # Strategy 2: Normalized match (e.g., "Proxmox 1" matches "proxmox1")
        normalized_node = node.lower().replace(" ", "").replace("-", "").replace("_", "")
        normalized_instance = instance.lower().replace(" ", "").replace("-", "").replace("_", "")

        if normalized_input == normalized_node or normalized_input == normalized_instance:
            node_data = data
            matched_node_name = node
            matched_instance = instance
            break

        # Strategy 3: Partial match in key or node name
        if normalized_input in key.lower() or normalized_input in normalized_node:
            node_data = data
            matched_node_name = node
            matched_instance = instance
            break

        # Strategy 4: Key contains input (e.g., "host20" in display_name "Host 20")
        if normalized_node in normalized_input or normalized_instance in normalized_input:
            node_data = data
            matched_node_name = node
            matched_instance = instance
            break

    # Build node info
    node_info = None
    if node_data:
        node_info = NodeInfo(
            node=node_data.get("node", node_name),
            status=node_data.get("status", "unknown"),
            cpu=node_data.get("cpu", 0),
            memory=node_data.get("memory", 0),
            maxcpu=node_data.get("maxcpu", 0),
            maxmem=node_data.get("maxmem", 0),
            uptime=node_data.get("uptime", 0),
        )

    # Filter VMs and containers for this node
    all_vms = []
    all_lxcs = []

    for vm in cached_vms:
        # Match by node name or instance
        vm_node = vm.get("node", "")
        vm_instance = vm.get("instance", "")

        if vm_node == matched_node_name or vm_instance == matched_instance or \
           vm_node == node_name or vm_instance == node_name:
            vm_info = NodeVMInfo(
                vmid=vm.get("vmid", 0),
                name=vm.get("name", "unknown"),
                type=vm.get("type", "unknown"),
                status=vm.get("status", "unknown"),
                cpu=vm.get("cpu", 0),
                memory=vm.get("memory", 0),
            )
            if vm.get("type") == "lxc":
                all_lxcs.append(vm_info)
            else:
                all_vms.append(vm_info)

    # Sort by name
    all_vms.sort(key=lambda x: x.name.lower())
    all_lxcs.sort(key=lambda x: x.name.lower())

    # Get storage - need to fetch from API (skip in demo mode)
    storage_list = []
    if matched_node_name and matched_instance:
        try:
            from ..config import get_settings
            from ..polling.proxmox import ProxmoxClient
            integration_settings = get_settings()
            proxmox_configs = integration_settings.get_all_proxmox_configs()

            # Find the right Proxmox instance config
            instance_config = None
            for inst_name, inst_config in proxmox_configs:
                if inst_name == matched_instance:
                    instance_config = inst_config
                    break

            if instance_config:
                async with ProxmoxClient(
                    base_url=instance_config.url,
                    token_id=instance_config.token_id,
                    token_secret=instance_config.token_secret,
                    verify_ssl=instance_config.verify_ssl,
                ) as client:
                    raw_storage = await client.get_node_storage(matched_node_name)
                    for s in raw_storage:
                        # Only include active, enabled storage with actual capacity
                        total = s.get("total", 0)
                        if s.get("active") and s.get("enabled") and total > 0:
                            used = s.get("used", 0)
                            used_pct = (used / total * 100) if total > 0 else 0
                            storage_list.append(NodeStorageInfo(
                                storage=s.get("storage", "unknown"),
                                type=s.get("type", "unknown"),
                                used=used,
                                total=total,
                                used_percent=round(used_pct, 1),
                            ))
        except Exception:
            pass  # Storage fetch failed, continue without it

    # Count running vs total
    vms_running = sum(1 for vm in all_vms if vm.status == "running")
    lxcs_running = sum(1 for lxc in all_lxcs if lxc.status == "running")

    return ProxmoxNodeDetailResponse(
        node=node_info,
        vms=all_vms,
        lxcs=all_lxcs,
        storage=storage_list,
        vms_running=vms_running,
        vms_total=len(all_vms),
        lxcs_running=lxcs_running,
        lxcs_total=len(all_lxcs),
    )
