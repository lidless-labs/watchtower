from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.polling import proxmox
from app.polling.proxmox import ProxmoxClient

FIXTURES = Path(__file__).parent / "fixtures"


def payload(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture
async def make_client():
    clients = []

    def factory(handler):
        client = ProxmoxClient("https://pve.example.com", "user@pam!token", "fixture-secret")
        client._client = httpx.AsyncClient(
            base_url="https://pve.example.com/api2/json",
            headers={"Authorization": "PVEAPIToken=user@pam!token=fixture-secret"},
            transport=httpx.MockTransport(handler),
        )
        clients.append(client._client)
        return client

    yield factory
    for client in clients:
        await client.aclose()


@pytest.mark.asyncio
async def test_get_nodes_parses_fixture(make_client):
    nodes = await make_client(lambda request: httpx.Response(200, json=payload("proxmox_nodes.json"))).get_nodes()
    assert [(node.node, node.status) for node in nodes] == [("pve-a", "online"), ("pve-b", "offline")]


@pytest.mark.asyncio
async def test_get_nodes_empty_data(make_client):
    assert await make_client(lambda request: httpx.Response(200, json={"data": []})).get_nodes() == []


@pytest.mark.asyncio
async def test_get_nodes_malformed_record_raises(make_client):
    with pytest.raises(ValidationError):
        await make_client(lambda request: httpx.Response(200, json={"data": [{"node": "bad"}]})).get_nodes()


@pytest.mark.asyncio
async def test_auth_header_and_api_path(make_client):
    def handler(request):
        assert request.url.path == "/api2/json/nodes"
        assert request.headers["Authorization"].startswith("PVEAPIToken=")
        return httpx.Response(200, json={"data": []})

    await make_client(handler).get_nodes()


@pytest.mark.asyncio
async def test_node_statistics_and_percentages(make_client):
    client = make_client(lambda request: httpx.Response(200, json={"data": {"cpu": 0.25, "maxcpu": 8, "mem": 1, "maxmem": 4}}))
    node = await client.get_node("pve-a")
    assert (node.node, node.status, node.cpu_percent, node.memory_percent) == ("pve-a", "online", 25.0, 25.0)


@pytest.mark.asyncio
async def test_get_node_encodes_path_and_http_error_returns_none(make_client):
    def handler(request):
        assert request.url.raw_path.endswith(b"/nodes/pve%2Fa/status")
        return httpx.Response(404)

    assert await make_client(handler).get_node("pve/a") is None


@pytest.mark.asyncio
async def test_vm_listing_skips_offline_nodes_and_adds_type(make_client):
    def handler(request):
        if request.url.path.endswith("/nodes"):
            return httpx.Response(200, json=payload("proxmox_nodes.json"))
        if request.url.path.endswith("/qemu"):
            return httpx.Response(200, json=payload("proxmox_vms.json"))
        assert "/pve-a/lxc" in request.url.path
        return httpx.Response(200, json={"data": []})

    vms = await make_client(handler).get_vms()
    assert len(vms) == 2
    assert all(vm.node == "pve-a" and vm.type == "qemu" for vm in vms)


@pytest.mark.asyncio
async def test_vm_listing_running_only_and_malformed_record(make_client):
    def handler(request):
        if request.url.path.endswith("/nodes"):
            return httpx.Response(200, json={"data": [{"node": "pve-a", "status": "online"}]})
        if request.url.path.endswith("/qemu"):
            return httpx.Response(200, json={"data": [{"vmid": 1, "name": "missing-status"}, *payload("proxmox_vms.json")["data"]]})
        return httpx.Response(200, json={"data": []})

    vms = await make_client(handler).get_vms(running_only=True)
    assert [vm.vmid for vm in vms] == [101]


@pytest.mark.asyncio
async def test_vm_node_timeout_is_skipped(monkeypatch, caplog):
    monkeypatch.setattr(proxmox, "_PROXMOX_NODE_FETCH_TIMEOUT", 0.001)
    client = ProxmoxClient("https://pve.example.com", "id", "secret")

    async def fake_get(endpoint, params=None):
        if endpoint == "/nodes":
            return {"data": [{"node": "pve-a", "status": "online"}]}
        if endpoint.endswith("/qemu"):
            await asyncio.sleep(0.05)
            return {"data": [{"vmid": 201, "name": "late-vm", "status": "running"}]}
        return {"data": []}

    client._get = fake_get
    assert await client.get_vms() == []
    assert "Timed out fetching qemu data for Proxmox node pve-a" in caplog.text


@pytest.mark.asyncio
async def test_vm_node_http_error_is_skipped(caplog):
    client = ProxmoxClient("https://pve.example.com", "id", "secret")

    async def fake_get(endpoint, params=None):
        if endpoint == "/nodes":
            return {"data": [{"node": "pve-a", "status": "online"}]}
        if endpoint.endswith("/lxc"):
            return {"data": [{"vmid": 202, "name": "sibling-vm", "status": "running"}]}
        request = httpx.Request("GET", "https://pve.example.com")
        raise httpx.HTTPStatusError("missing", request=request, response=httpx.Response(500, request=request))

    client._get = fake_get
    vms = await client.get_vms()
    assert [(vm.vmid, vm.type) for vm in vms] == [(202, "lxc")]
    assert "Failed to fetch qemu data for Proxmox node pve-a" in caplog.text


@pytest.mark.asyncio
async def test_vm_batch_timeout_cancels_pending_fetches(monkeypatch, caplog):
    monkeypatch.setattr(proxmox, "_PROXMOX_VM_BATCH_TIMEOUT", 0.001)
    monkeypatch.setattr(proxmox, "_PROXMOX_NODE_FETCH_TIMEOUT", 1)
    client = ProxmoxClient("https://pve.example.com", "id", "secret")
    cancelled = []

    async def fake_get(endpoint, params=None):
        if endpoint == "/nodes":
            return {"data": [{"node": "pve-a", "status": "online"}]}
        try:
            await asyncio.sleep(0.1)
            return {"data": [{"vmid": 203, "name": "late-vm", "status": "running"}]}
        except asyncio.CancelledError:
            cancelled.append(endpoint)
            raise

    client._get = fake_get
    assert await client.get_vms() == []
    assert cancelled
    assert "Timed out fetching Proxmox VM inventory after" in caplog.text


@pytest.mark.asyncio
async def test_get_node_vms_combines_types_and_filters_running(make_client):
    def handler(request):
        if request.url.path.endswith("/qemu"):
            return httpx.Response(200, json={"data": [payload("proxmox_vms.json")["data"][0]]})
        return httpx.Response(200, json={"data": [dict(payload("proxmox_vms.json")["data"][1], vmid=103)]})

    vms = await make_client(handler).get_node_vms("pve-a", running_only=True)
    assert [(vm.vmid, vm.type) for vm in vms] == [(101, "qemu")]


@pytest.mark.asyncio
async def test_get_node_vms_http_errors_are_tolerated(make_client):
    assert await make_client(lambda request: httpx.Response(500)).get_node_vms("pve-a") == []


@pytest.mark.asyncio
async def test_storage_parses_defaults_and_handles_http_error(make_client):
    client = make_client(lambda request: httpx.Response(200, json={"data": [{"storage": "local", "used": 2}]}))
    storage = await client.get_node_storage("pve-a")
    assert storage[0]["storage"] == "local" and storage[0]["enabled"] == 1
    assert await make_client(lambda request: httpx.Response(404)).get_node_storage("pve-a") == []


@pytest.mark.asyncio
async def test_health_check_success_and_failure(make_client):
    assert await make_client(lambda request: httpx.Response(200, json={"data": "ok"})).health_check() is True
    assert await make_client(lambda request: httpx.Response(500)).health_check() is False


def test_node_and_vm_zero_memory_are_safe():
    from app.polling.proxmox import ProxmoxNode, ProxmoxVM

    node = ProxmoxNode(node="pve-a", status="online", mem=3, maxmem=0)
    vm = ProxmoxVM(vmid=1, name="vm", node="pve-a", type="qemu", status="stopped", maxmem=0)
    assert node.memory_percent == vm.memory_percent == 0
    assert vm.cpu_percent == 0
