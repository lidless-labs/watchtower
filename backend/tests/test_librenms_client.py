from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.polling.librenms import LibreNMSAPIError, LibreNMSClient

FIXTURES = Path(__file__).parent / "fixtures"


def payload(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture
def make_client(monkeypatch):
    real_async_client = httpx.AsyncClient

    def factory(handler):
        def mock_transport_client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            return real_async_client(*args, **kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", mock_transport_client)
        return LibreNMSClient("https://librenms.example.com", "fixture-token")

    return factory


@pytest.mark.asyncio
async def test_get_devices_parses_fixture(make_client):
    async with make_client(lambda request: httpx.Response(200, json=payload("librenms_devices.json"))) as client:
        devices = await client.get_devices()
        assert [(device.device_id, device.hostname, device.status) for device in devices] == [
            (7, "switch-a.example.com", 1), (8, "server-b.example.com", 0)
        ]


@pytest.mark.asyncio
async def test_get_devices_empty_payload(make_client):
    async with make_client(lambda request: httpx.Response(200, json={})) as client:
        assert await client.get_devices() == []


@pytest.mark.asyncio
async def test_get_devices_malformed_record_raises(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"devices": [{"hostname": "broken"}]})) as client:
        with pytest.raises(ValidationError):
            await client.get_devices()


@pytest.mark.asyncio
async def test_get_devices_uses_auth_header_and_api_path(make_client):
    def handler(request):
        assert request.url.path == "/api/v0/devices"
        assert request.headers["X-Auth-Token"] == "fixture-token"
        return httpx.Response(200, json={"devices": []})

    async with make_client(handler) as client:
        await client.get_devices()


@pytest.mark.asyncio
async def test_get_device_returns_first_or_none(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"devices": payload("librenms_devices.json")["devices"][:1]})) as client:
        assert (await client.get_device(7)).hostname == "switch-a.example.com"
    async with make_client(lambda request: httpx.Response(200, json={"devices": []})) as client:
        assert await client.get_device(7) is None


@pytest.mark.asyncio
async def test_get_device_encodes_path_segment_and_handles_http_error(make_client):
    def handler(request):
        assert request.url.raw_path.endswith(b"/devices/name%2Fpart")
        return httpx.Response(404)

    async with make_client(handler) as client:
        assert await client.get_device("name/part") is None


@pytest.mark.asyncio
async def test_get_ports_parses_fixture_and_scopes_device(make_client):
    def handler(request):
        assert request.url.path.endswith("/devices/7/ports")
        assert "ifName" in request.url.params["columns"]
        return httpx.Response(200, json=payload("librenms_ports.json"))

    async with make_client(handler) as client:
        ports = await client.get_ports(7)
        assert ports[0].ifName == "eth0"
        assert ports[0].ifInOctets_rate == 125000


@pytest.mark.asyncio
async def test_get_ports_accepts_empty_and_missing_fields(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"ports": []})) as client:
        assert await client.get_ports() == []
    data = {"ports": [{"ifName": "eth1"}]}
    async with make_client(lambda request: httpx.Response(200, json=data)) as client:
        assert (await client.get_ports())[0].device_id is None


@pytest.mark.asyncio
async def test_get_port_supports_singular_and_plural_response(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"port": payload("librenms_ports.json")["ports"]})) as client:
        assert (await client.get_port(3)).ifName == "eth0"
    async with make_client(lambda request: httpx.Response(200, json=payload("librenms_ports.json"))) as client:
        assert (await client.get_port(3)).port_id == 3


@pytest.mark.asyncio
async def test_get_port_empty_and_http_status_error_return_none(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"port": []})) as client:
        assert await client.get_port(3) is None
    async with make_client(lambda request: httpx.Response(404)) as client:
        assert await client.get_port(3) is None


@pytest.mark.asyncio
async def test_get_port_malformed_record_raises(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"port": [{"ifSpeed": "fast"}]})) as client:
        with pytest.raises(ValidationError):
            await client.get_port(3)


@pytest.mark.asyncio
@pytest.mark.parametrize(("state", "expected"), [("ok", 0), ("alert", 1), ("ack", 2)])
async def test_get_alerts_maps_state_filter(make_client, state, expected):
    def handler(request):
        assert request.url.params["state"] == str(expected)
        return httpx.Response(200, json=payload("librenms_alerts.json"))

    async with make_client(handler) as client:
        alerts = await client.get_alerts(state)
        assert [alert.state for alert in alerts] == [1, 2]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", [None, "unknown"])
async def test_get_alerts_unfiltered_state(make_client, state):
    def handler(request):
        assert "state" not in request.url.params
        return httpx.Response(200, json={"alerts": []})

    async with make_client(handler) as client:
        assert await client.get_alerts(state) == []


@pytest.mark.asyncio
async def test_get_active_alerts_requests_active_and_acknowledged(make_client):
    def handler(request):
        assert request.url.params["state"] == "1,2"
        return httpx.Response(200, json=payload("librenms_alerts.json"))

    async with make_client(handler) as client:
        alerts = await client.get_active_alerts()
        assert [alert.id for alert in alerts] == [31, 32]


@pytest.mark.asyncio
async def test_alert_malformed_record_raises(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"alerts": [{"id": 1}]})) as client:
        with pytest.raises(ValidationError):
            await client.get_alerts()


@pytest.mark.asyncio
async def test_acknowledge_alert_sends_encoded_write_and_accepts_ok(make_client):
    def handler(request):
        assert request.method == "PUT"
        assert request.url.raw_path.endswith(b"/alerts/31%2Fpart")
        assert json.loads(request.content) == {"note": "", "until_clear": False}
        return httpx.Response(200, json={"status": "ok"})

    async with make_client(handler) as client:
        await client.acknowledge_alert("31/part", until_clear=False)


@pytest.mark.asyncio
async def test_acknowledge_alert_translates_rejection(make_client):
    async with make_client(lambda request: httpx.Response(403, json={"message": "denied"})) as client:
        with pytest.raises(LibreNMSAPIError, match="denied") as error:
            await client.acknowledge_alert(31, "note")
        assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_acknowledge_alert_rejects_invalid_success_body(make_client):
    async with make_client(lambda request: httpx.Response(200, json={"status": "error"})) as client:
        with pytest.raises(LibreNMSAPIError):
            await client.acknowledge_alert(31)


@pytest.mark.asyncio
async def test_unmute_alert_accepts_success(make_client):
    def handler(request):
        assert request.method == "PUT" and request.url.path.endswith("/alerts/unmute/31")
        return httpx.Response(200, json={"status": "ok"})

    async with make_client(handler) as client:
        await client.unmute_alert(31)


@pytest.mark.asyncio
async def test_links_health_and_vlan_endpoints_handle_empty_or_http_errors(make_client):
    async with make_client(lambda request: httpx.Response(404)) as client:
        assert await client.get_links() == []
        assert await client.get_device_health(7) == []
        assert await client.get_vlans() == []
        assert await client.get_device_vlans(7) == []
        assert await client.health_check() is False
