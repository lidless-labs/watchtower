"""Settings API routes for config management and integration health checks."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from ..auth import UserRole, get_current_user
from ..cache import redis_cache
from ..config import get_config, get_config_dict, mask_secrets, persist_config

router = APIRouter(prefix="/settings", tags=["settings"])


class ConnectionTestRequest(BaseModel):
    type: str
    model_config = ConfigDict(extra="allow")


def _require_admin(current_user: dict) -> None:
    if current_user.get("role") != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Admin access required")


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path}"


async def _test_librenms(payload: dict[str, Any]) -> dict[str, Any]:
    url = payload.get("url", "")
    api_key = payload.get("api_key", "")
    if not url or not api_key:
        raise HTTPException(status_code=400, detail="url and api_key are required")

    async with httpx.AsyncClient(timeout=10.0, verify=payload.get("verify_ssl", True)) as client:
        response = await client.get(
            _join_url(url, "/api/v0/system"),
            headers={"X-Auth-Token": api_key},
        )
        response.raise_for_status()

    return {"endpoint": _join_url(url, "/api/v0/system"), "http_status": response.status_code}


async def _test_proxmox(payload: dict[str, Any]) -> dict[str, Any]:
    url = payload.get("url", "")
    token_id = payload.get("token_id", "")
    token_secret = payload.get("token_secret", "")
    if not url or not token_id or not token_secret:
        raise HTTPException(status_code=400, detail="url, token_id, and token_secret are required")

    token = f"PVEAPIToken={token_id}={token_secret}"

    async with httpx.AsyncClient(timeout=10.0, verify=payload.get("verify_ssl", True)) as client:
        response = await client.get(
            _join_url(url, "/api2/json/version"),
            headers={"Authorization": token},
        )
        response.raise_for_status()

    return {"endpoint": _join_url(url, "/api2/json/version"), "http_status": response.status_code}


async def _test_influxdb(payload: dict[str, Any]) -> dict[str, Any]:
    url = payload.get("url", "")
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    headers: dict[str, str] = {}
    token = payload.get("token")
    if token:
        headers["Authorization"] = f"Token {token}"

    async with httpx.AsyncClient(timeout=10.0, verify=payload.get("verify_ssl", True)) as client:
        response = await client.get(_join_url(url, "/health"), headers=headers)
        response.raise_for_status()

    return {"endpoint": _join_url(url, "/health"), "http_status": response.status_code}


async def _test_netdisco(payload: dict[str, Any]) -> dict[str, Any]:
    url = payload.get("url", "")
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    headers: dict[str, str] = {}
    api_key = payload.get("api_key", "")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    auth = None
    username = payload.get("username", "")
    password = payload.get("password", "")
    if username and password:
        auth = (username, password)

    async with httpx.AsyncClient(timeout=10.0, verify=payload.get("verify_ssl", True)) as client:
        response = await client.get(
            _join_url(url, "/api/v2/object"),
            headers=headers,
            auth=auth,
        )
        response.raise_for_status()

    return {"endpoint": _join_url(url, "/api/v2/object"), "http_status": response.status_code}


async def _run_connection_test(data: dict[str, Any]) -> dict[str, Any]:
    integration_type = data.get("type", "").lower()

    testers = {
        "librenms": _test_librenms,
        "proxmox": _test_proxmox,
        "influxdb": _test_influxdb,
        "netdisco": _test_netdisco,
    }

    tester = testers.get(integration_type)
    if not tester:
        raise HTTPException(status_code=400, detail="Unsupported connection type")

    try:
        details = await tester(data)
        return {
            "status": "ok",
            "message": "Connected successfully",
            "details": details,
        }
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        return {
            "status": "error",
            "message": "Connection test failed",
            "details": {
                "http_status": exc.response.status_code,
                "error": str(exc),
            },
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "message": "Connection test failed",
            "details": {"error": str(exc)},
        }


@router.get("")
async def get_settings(current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    config_dict = get_config_dict()
    return mask_secrets(config_dict)


@router.put("")
async def put_settings(
    body: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)

    persist_config(body)
    return mask_secrets(get_config_dict())


@router.patch("/{section}")
async def patch_settings_section(
    section: str,
    body: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)

    persist_config({section: body})
    return mask_secrets(get_config_dict())


@router.post("/test-connection")
async def test_connection(
    payload: ConnectionTestRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)

    data = payload.model_dump()
    return await _run_connection_test(data)


@router.get("/status")
async def get_settings_status(_current_user: dict = Depends(get_current_user)):
    config = get_config()

    status: dict[str, Any] = {
        "librenms": {"configured": bool(config.data_sources.librenms.url), "connected": False},
        "netdisco": {"configured": bool(config.data_sources.netdisco.url), "connected": False},
        "proxmox": {"configured": bool(config.data_sources.proxmox.url), "connected": False},
        "influxdb": {
            "configured": bool(config.influxdb.url and config.influxdb.enabled),
            "connected": False,
        },
        "redis": {"connected": False},
        "speedtest": {"enabled": bool(config.speedtest.enabled)},
    }

    try:
        await redis_cache.client.ping()
        status["redis"]["connected"] = True
    except Exception as exc:  # noqa: BLE001
        status["redis"]["error"] = str(exc)

    checks: list[tuple[str, dict[str, Any]]] = []
    if status["librenms"]["configured"]:
        checks.append(("librenms", {
            "type": "librenms",
            "url": config.data_sources.librenms.url,
            "api_key": config.data_sources.librenms.api_key,
        }))
    if status["netdisco"]["configured"]:
        checks.append(("netdisco", {
            "type": "netdisco",
            "url": config.data_sources.netdisco.url,
            "api_key": config.data_sources.netdisco.api_key,
            "username": config.data_sources.netdisco.username,
            "password": config.data_sources.netdisco.password,
        }))
    if status["proxmox"]["configured"]:
        checks.append(("proxmox", {
            "type": "proxmox",
            "url": config.data_sources.proxmox.url,
            "token_id": config.data_sources.proxmox.token_id,
            "token_secret": config.data_sources.proxmox.token_secret,
            "verify_ssl": config.data_sources.proxmox.verify_ssl,
        }))
    if status["influxdb"]["configured"]:
        checks.append(("influxdb", {
            "type": "influxdb",
            "url": config.influxdb.url,
            "token": config.influxdb.token,
        }))

    for name, payload in checks:
        result = await _run_connection_test(payload)
        status[name]["connected"] = result.get("status") == "ok"
        if result.get("status") != "ok":
            status[name]["error"] = result.get("message")
            status[name]["details"] = result.get("details")

    return status
