"""Diagnostics API routes for testing data source connectivity."""

import logging

from fastapi import APIRouter

from app.cache import redis_cache
from app.polling.librenms import LibreNMSClient
from app.polling.netdisco import NetdiscoClient
from app.polling.proxmox import ProxmoxClient
from app.polling.scheduler import scheduler, CACHE_DEVICES, CACHE_ALERTS, CACHE_LAST_POLL, CACHE_PROXMOX, CACHE_PROXMOX_VMS
from app.config import get_config, get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/config")
async def check_config():
    """Show configured data sources (URLs only, no secrets)."""
    config = get_config()
    return {
        "librenms": {
            "url": config.data_sources.librenms.url or "(not configured)",
            "has_api_key": bool(config.data_sources.librenms.api_key),
        },
        "netdisco": {
            "url": config.data_sources.netdisco.url or "(not configured)",
            "has_api_key": bool(config.data_sources.netdisco.api_key),
        },
        "proxmox": {
            "url": config.data_sources.proxmox.url or "(not configured)",
            "has_token": bool(config.data_sources.proxmox.token_id),
        },
    }


@router.get("/test/librenms")
async def test_librenms():
    """Test LibreNMS API connectivity."""
    config = get_config()

    if not config.data_sources.librenms.url:
        return {"status": "not_configured", "message": "LibreNMS URL not set in config.yaml"}

    if not config.data_sources.librenms.api_key:
        return {"status": "not_configured", "message": "LibreNMS API key not set in config.yaml"}

    try:
        async with LibreNMSClient() as client:
            healthy = await client.health_check()
            if healthy:
                devices = await client.get_devices()
                return {
                    "status": "ok",
                    "message": f"Connected to LibreNMS at {config.data_sources.librenms.url}",
                    "device_count": len(devices),
                    "sample_devices": [
                        {"hostname": d.hostname, "ip": d.ip, "status": "up" if d.status == 1 else "down"}
                        for d in devices[:5]
                    ],
                }
            else:
                return {"status": "error", "message": "Health check failed"}
    except Exception:
        logger.exception("LibreNMS connectivity test failed")
        return {"status": "error", "message": "Connection failed. Check server logs for details."}


@router.get("/test/netdisco")
async def test_netdisco():
    """Test Netdisco API connectivity."""
    config = get_config()

    if not config.data_sources.netdisco.url:
        return {"status": "not_configured", "message": "Netdisco URL not set in config.yaml"}

    has_auth = (
        config.data_sources.netdisco.api_key or
        (config.data_sources.netdisco.username and config.data_sources.netdisco.password)
    )
    if not has_auth:
        return {"status": "not_configured", "message": "Netdisco credentials not set in config.yaml (need api_key or username/password)"}

    try:
        async with NetdiscoClient() as client:
            healthy = await client.health_check()
            if healthy:
                devices = await client.get_all_devices()
                return {
                    "status": "ok",
                    "message": f"Connected to Netdisco at {config.data_sources.netdisco.url}",
                    "device_count": len(devices),
                    "sample_devices": [
                        {"name": d.name or d.ip, "ip": d.ip, "vendor": d.vendor}
                        for d in devices[:5]
                    ],
                }
            else:
                return {"status": "error", "message": "Health check failed"}
    except Exception:
        logger.exception("Netdisco connectivity test failed")
        return {"status": "error", "message": "Connection failed. Check server logs for details."}


@router.get("/test/proxmox")
async def test_proxmox():
    """Test Proxmox API connectivity."""
    settings = get_settings()
    proxmox_configs = settings.get_all_proxmox_configs()

    if not proxmox_configs:
        return {"status": "not_configured", "message": "Proxmox not configured in config.yaml"}

    results = []
    for instance_name, config in proxmox_configs:
        try:
            async with ProxmoxClient(
                base_url=config.url,
                token_id=config.token_id,
                token_secret=config.token_secret,
                verify_ssl=config.verify_ssl,
            ) as client:
                healthy = await client.health_check()
                if healthy:
                    nodes = await client.get_nodes()
                    vms = await client.get_vms(running_only=True)
                    results.append({
                        "instance": instance_name,
                        "status": "ok",
                        "url": config.url,
                        "node_count": len(nodes),
                        "running_vms": len(vms),
                        "nodes": [
                            {"name": n.node, "status": n.status, "cpu": n.cpu_percent, "memory": n.memory_percent}
                            for n in nodes
                        ],
                    })
                else:
                    results.append({
                        "instance": instance_name,
                        "status": "error",
                        "url": config.url,
                        "message": "Health check failed",
                    })
        except Exception:
            logger.exception("Proxmox connectivity test failed for %s", instance_name)
            results.append({
                "instance": instance_name,
                "status": "error",
                "url": config.url,
                "message": "Connection failed. Check server logs for details.",
            })

    connected = sum(1 for r in results if r["status"] == "ok")
    return {
        "status": "ok" if connected == len(results) else ("partial" if connected > 0 else "error"),
        "message": f"{connected}/{len(results)} Proxmox instances connected",
        "instances": results,
    }


@router.get("/test/all")
async def test_all_sources():
    """Test all configured data sources."""
    results = {}

    # Test LibreNMS
    results["librenms"] = await test_librenms()

    # Test Netdisco
    results["netdisco"] = await test_netdisco()

    # Test Proxmox
    results["proxmox"] = await test_proxmox()

    # Summary
    def is_configured(r):
        return r.get("status") != "not_configured"

    def is_connected(r):
        return r.get("status") == "ok"

    configured = sum(1 for r in results.values() if is_configured(r))
    connected = sum(1 for r in results.values() if is_connected(r))

    return {
        "summary": f"{connected}/{configured} sources connected",
        "sources": results,
    }


@router.get("/scheduler")
async def get_scheduler_status():
    """Get polling scheduler status."""
    last_poll = await redis_cache.get_json(CACHE_LAST_POLL)
    config = get_config()

    # Safely check scheduler state
    try:
        is_running = (
            scheduler._scheduler is not None
            and scheduler._scheduler.running
        )
    except Exception:
        is_running = False

    return {
        "running": is_running,
        "intervals": {
            "device_status": config.polling.device_status,
            "interfaces": config.polling.interfaces,
            "topology": config.polling.topology,
        },
        "last_poll": last_poll,
    }


@router.post("/poll/now")
async def trigger_poll():
    """Trigger an immediate poll of all sources."""
    await scheduler.poll_now()
    return {"status": "ok", "message": "Poll triggered"}


@router.get("/cache/devices")
async def get_cached_devices():
    """View cached device data from last poll."""
    devices = await redis_cache.get_json(CACHE_DEVICES)
    last_poll = await redis_cache.get_json(CACHE_LAST_POLL)

    if not devices:
        return {"status": "empty", "message": "No cached device data. Run /api/diagnostics/poll/now to trigger a poll."}

    return {
        "last_poll": last_poll,
        "device_count": len(devices) if devices else 0,
        "devices": devices,
    }


@router.get("/cache/alerts")
async def get_cached_alerts():
    """View cached alerts from last poll."""
    alerts = await redis_cache.get_json(CACHE_ALERTS)

    if alerts is None:
        return {"status": "empty", "message": "No cached alert data."}

    return {
        "alert_count": len(alerts),
        "alerts": alerts,
    }


@router.get("/cache/proxmox")
async def get_cached_proxmox():
    """View cached Proxmox node data from last poll."""
    nodes = await redis_cache.get_json(CACHE_PROXMOX)

    if not nodes:
        return {"status": "empty", "message": "No cached Proxmox data. Check Proxmox config and run /api/diagnostics/poll/now."}

    return {
        "node_count": len(nodes),
        "nodes": nodes,
    }


@router.get("/cache/proxmox/vms")
async def get_cached_proxmox_vms():
    """View cached Proxmox VM data from last poll."""
    vms = await redis_cache.get_json(CACHE_PROXMOX_VMS)

    if not vms:
        return {"status": "empty", "message": "No cached VM data."}

    return {
        "vm_count": len(vms),
        "vms": vms,
    }
