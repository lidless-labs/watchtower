"""Security checks for settings connection-test helpers."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers import settings as settings_module
from app.routers.settings import (
    _run_connection_test,
    _validate_settings_section,
    _validate_settings_update,
    _validated_base_url,
)


@pytest.mark.asyncio
async def test_connection_test_rejects_non_http_url():
    with pytest.raises(HTTPException) as exc:
        await _run_connection_test({"type": "influxdb", "url": "file:///etc/passwd"})

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_connection_test_rejects_embedded_credentials():
    with pytest.raises(HTTPException) as exc:
        await _run_connection_test({"type": "influxdb", "url": "https://user:pass@example.com"})

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_connection_test_rejects_metadata_ip():
    with pytest.raises(HTTPException) as exc:
        await _run_connection_test({"type": "influxdb", "url": "http://169.254.169.254"})

    assert exc.value.status_code == 400


def test_validated_url_rejects_hostname_resolving_to_metadata(monkeypatch):
    # A hostname that resolves to the cloud-metadata IP must be blocked even
    # though the host string itself is not a literal metadata address.
    monkeypatch.setattr(settings_module, "_resolve_host_addresses", lambda host: {"169.254.169.254"})

    with pytest.raises(HTTPException) as exc:
        _validated_base_url("http://innocent-name.example.com")

    assert exc.value.status_code == 400


def test_validated_url_allows_private_ip_literal():
    # The app monitors private-network infrastructure, so RFC1918 literals are
    # legitimate targets and must NOT be blocked.
    assert _validated_base_url("http://192.168.1.50:8086") == "http://192.168.1.50:8086"


def test_validated_url_allows_loopback_literal():
    # Single-host installs point InfluxDB at localhost; loopback must be allowed.
    assert _validated_base_url("http://127.0.0.1:8086") == "http://127.0.0.1:8086"


def test_validated_url_allows_public_hostname(monkeypatch):
    monkeypatch.setattr(settings_module, "_resolve_host_addresses", lambda host: {"93.184.216.34"})
    assert _validated_base_url("https://example.com") == "https://example.com"


@pytest.mark.asyncio
async def test_connection_test_error_does_not_leak_exception_string(monkeypatch):
    secret_detail = "https://internal-host.lan:8086 ConnectError"

    async def _boom(_data):
        raise RuntimeError(secret_detail)

    # _run_connection_test builds its testers dict from the module-level
    # functions at call time, so patching the module attribute is enough.
    monkeypatch.setattr(settings_module, "_test_influxdb", _boom)

    result = await _run_connection_test({"type": "influxdb", "url": "http://example.com"})

    assert result["status"] == "error"
    assert result["details"]["error"] == "RuntimeError"
    assert secret_detail not in str(result)


def test_settings_update_rejects_unknown_top_level_key():
    with pytest.raises(HTTPException) as exc:
        _validate_settings_update({"surprise": {"enabled": True}})

    assert exc.value.status_code == 400


def test_settings_update_rejects_unknown_nested_key():
    with pytest.raises(HTTPException) as exc:
        _validate_settings_update({"data_sources": {"librenms": {"url": "https://nms", "extra": "x"}}})

    assert exc.value.status_code == 400


def test_settings_section_rejects_unknown_section():
    with pytest.raises(HTTPException) as exc:
        _validate_settings_section("surprise", {"enabled": True})

    assert exc.value.status_code == 404


def test_settings_section_allows_dynamic_alert_overrides():
    update = {
        "overrides": {
            "router-1": {
                "cpu_warning": 70,
                "cpu_critical": 90,
                "memory_warning": 70,
                "memory_critical": 90,
                "interface_utilization_warning": 70,
                "interface_utilization_critical": 90,
            }
        }
    }

    assert _validate_settings_section("alert_thresholds", update) == update
