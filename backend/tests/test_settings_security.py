"""Security checks for settings connection-test helpers."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers.settings import (
    _run_connection_test,
    _validate_settings_section,
    _validate_settings_update,
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
