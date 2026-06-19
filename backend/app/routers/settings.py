"""Settings API routes for config management and integration health checks."""

from __future__ import annotations

import ipaddress
import logging
from typing import Any, get_args, get_origin

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from ..auth import UserRole, get_current_user
from ..cache import redis_cache
from ..config import AppConfig, get_config, get_config_dict, mask_secrets, persist_config
from ..logging_utils import log_event

router = APIRouter(prefix="/settings", tags=["settings"])
logger = logging.getLogger(__name__)

_METADATA_HOSTS = {
    "169.254.169.254",
    "metadata.google.internal",
}


class ConnectionTestRequest(BaseModel):
    type: str
    model_config = ConfigDict(extra="allow")


def _require_admin(current_user: dict) -> None:
    if current_user.get("role") != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Admin access required")


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path}"


def _nested_model_type(annotation: Any) -> type[BaseModel] | None:
    origin = get_origin(annotation)
    args = get_args(annotation)

    if origin is dict:
        return None

    if origin in {list, tuple} and args:
        return _nested_model_type(args[0])

    if origin is not None and args:
        for arg in args:
            nested = _nested_model_type(arg)
            if nested:
                return nested
        return None

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation

    return None


def _reject_unknown_settings_keys(model_type: type[BaseModel], data: Any, path: str = "") -> None:
    if not isinstance(data, dict):
        return

    for key, value in data.items():
        field = model_type.model_fields.get(key)
        if field is None:
            raise HTTPException(status_code=400, detail=f"Unknown settings key: {path}{key}")

        nested_model = _nested_model_type(field.annotation)
        if nested_model and isinstance(value, dict):
            _reject_unknown_settings_keys(nested_model, value, f"{path}{key}.")
        elif nested_model and isinstance(value, list):
            for index, item in enumerate(value):
                _reject_unknown_settings_keys(nested_model, item, f"{path}{key}[{index}].")


def _validate_settings_update(updates: Any) -> dict[str, Any]:
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail="Settings update must be an object")
    _reject_unknown_settings_keys(AppConfig, updates)
    return updates


def _validate_settings_section(section: str, body: Any) -> dict[str, Any]:
    field = AppConfig.model_fields.get(section)
    if field is None:
        raise HTTPException(status_code=404, detail="Settings section not found")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Settings section update must be an object")

    nested_model = _nested_model_type(field.annotation)
    if nested_model:
        _reject_unknown_settings_keys(nested_model, body, f"{section}.")
    return body


def _validated_base_url(raw_url: Any) -> str:
    url_text = str(raw_url or "").strip()
    if not url_text:
        raise HTTPException(status_code=400, detail="url is required")

    try:
        parsed = httpx.URL(url_text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="url must be a valid HTTP(S) URL") from exc

    if parsed.scheme not in {"http", "https"} or not parsed.host:
        raise HTTPException(status_code=400, detail="url must be a valid HTTP(S) URL")

    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="url must not include embedded credentials")

    host = (parsed.host or "").strip("[]").lower()
    if host in _METADATA_HOSTS:
        raise HTTPException(status_code=400, detail="url host is not allowed")

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None

    if address and (
        address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        raise HTTPException(status_code=400, detail="url host is not allowed")

    return url_text


async def _test_librenms(payload: dict[str, Any]) -> dict[str, Any]:
    url = _validated_base_url(payload.get("url"))
    api_key = payload.get("api_key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key is required")

    async with httpx.AsyncClient(timeout=10.0, verify=payload.get("verify_ssl", True)) as client:
        response = await client.get(
            _join_url(url, "/api/v0/system"),
            headers={"X-Auth-Token": api_key},
        )
        response.raise_for_status()

    return {"endpoint": _join_url(url, "/api/v0/system"), "http_status": response.status_code}


async def _test_proxmox(payload: dict[str, Any]) -> dict[str, Any]:
    url = _validated_base_url(payload.get("url"))
    token_id = payload.get("token_id", "")
    token_secret = payload.get("token_secret", "")
    if not token_id or not token_secret:
        raise HTTPException(status_code=400, detail="token_id and token_secret are required")

    token = f"PVEAPIToken={token_id}={token_secret}"

    async with httpx.AsyncClient(timeout=10.0, verify=payload.get("verify_ssl", True)) as client:
        response = await client.get(
            _join_url(url, "/api2/json/version"),
            headers={"Authorization": token},
        )
        response.raise_for_status()

    return {"endpoint": _join_url(url, "/api2/json/version"), "http_status": response.status_code}


async def _test_influxdb(payload: dict[str, Any]) -> dict[str, Any]:
    url = _validated_base_url(payload.get("url"))

    headers: dict[str, str] = {}
    token = payload.get("token")
    if token:
        headers["Authorization"] = f"Token {token}"

    async with httpx.AsyncClient(timeout=10.0, verify=payload.get("verify_ssl", True)) as client:
        response = await client.get(_join_url(url, "/health"), headers=headers)
        response.raise_for_status()

    return {"endpoint": _join_url(url, "/health"), "http_status": response.status_code}


async def _test_netdisco(payload: dict[str, Any]) -> dict[str, Any]:
    url = _validated_base_url(payload.get("url"))

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
        # Return the upstream status code and the exception class only. The full
        # str(exc) carries the target URL and internal host/port detail that
        # should not reach the client; log it server-side instead.
        log_event(
            logger,
            logging.WARNING,
            "settings.connection_test_failed",
            integration_type=integration_type,
            error=exc.__class__.__name__,
            detail=str(exc),
        )
        return {
            "status": "error",
            "message": "Connection test failed",
            "details": {
                "http_status": exc.response.status_code,
                "error": exc.__class__.__name__,
            },
        }
    except Exception as exc:  # noqa: BLE001
        log_event(
            logger,
            logging.WARNING,
            "settings.connection_test_failed",
            integration_type=integration_type,
            error=exc.__class__.__name__,
            detail=str(exc),
        )
        return {
            "status": "error",
            "message": "Connection test failed",
            "details": {"error": exc.__class__.__name__},
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

    updates = _validate_settings_update(body)
    log_event(
        logger,
        logging.INFO,
        "settings.update",
        username=current_user.get("username", "unknown"),
        sections=",".join(sorted(updates.keys())),
    )
    persist_config(updates)
    return mask_secrets(get_config_dict())


@router.patch("/{section}")
async def patch_settings_section(
    section: str,
    body: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)

    updates = _validate_settings_section(section, body)
    log_event(
        logger,
        logging.INFO,
        "settings.section_update",
        username=current_user.get("username", "unknown"),
        section=section,
        keys=",".join(sorted(updates.keys())),
    )
    persist_config({section: updates})
    return mask_secrets(get_config_dict())


@router.post("/test-connection")
async def test_connection(
    payload: ConnectionTestRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)

    data = payload.model_dump()
    log_event(
        logger,
        logging.INFO,
        "settings.connection_test",
        username=current_user.get("username", "unknown"),
        integration_type=data.get("type", ""),
    )
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
        log_event(
            logger,
            logging.WARNING,
            "settings.redis_status_failed",
            error=exc.__class__.__name__,
            detail=str(exc),
        )
        status["redis"]["error"] = exc.__class__.__name__

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
