"""Watchtower NOC Dashboard - FastAPI Application."""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import get_current_user, require_admin
from .cache import redis_cache
from .config import (
    config,
    is_placeholder_jwt_secret,
    persist_config,
    reload_config,
    settings,
    validate_jwt_secret_for_runtime,
)
from .polling import scheduler
from .logging_utils import log_event
from .routers import alerts_router, devices_router, topology_router, history_router, settings_router
from .routers.alerts import shutdown_notification_worker
from .routers.auth_router import router as auth_router
from .routers.diagnostics import router as diagnostics_router
from .routers.discovery import router as discovery_router
from .routers.vms import router as vms_router
from .routers.speedtest import router as speedtest_router
from .routers.paloalto import router as paloalto_router
from .routers.portgroups import router as portgroups_router
from .routers.ports import router as ports_router
from .routers.notifications import router as notifications_router
from .websocket import revalidate_loop, websocket_endpoint, ws_manager

logger = logging.getLogger("watchtower.runtime")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown events."""
    import asyncio
    import contextlib
    import secrets

    startup_logger = logging.getLogger("watchtower.startup")

    # Startup
    await redis_cache.connect()
    reload_config()

    if is_placeholder_jwt_secret(config.auth.jwt_secret):
        generated = secrets.token_urlsafe(32)
        try:
            persist_config({"auth": {"jwt_secret": generated}})
            log_event(
                startup_logger,
                logging.WARNING,
                "startup.jwt_secret_generated",
                persisted=True,
            )
        except Exception as exc:
            config.auth.jwt_secret = generated
            log_event(
                startup_logger,
                logging.CRITICAL,
                "startup.jwt_secret_generated",
                persisted=False,
                error=exc.__class__.__name__,
            )

    validate_jwt_secret_for_runtime(config.auth.jwt_secret, dev_mode=settings.dev_mode)

    if config.influxdb.enabled or settings.influxdb_enabled:
        if config.influxdb.url:
            settings.influxdb_url = config.influxdb.url
        if config.influxdb.token:
            settings.influxdb_token = config.influxdb.token
        if config.influxdb.org:
            settings.influxdb_org = config.influxdb.org
        if config.influxdb.bucket:
            settings.influxdb_bucket = config.influxdb.bucket
        settings.influxdb_enabled = True

    if settings.influxdb_enabled:
        from .history.client import influx_client
        await influx_client.connect()

    if config.data_sources.librenms.url:
        scheduler.start()

    revalidate_task = asyncio.create_task(revalidate_loop(ws_manager))

    try:
        yield
    finally:
        revalidate_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await revalidate_task

    # Shutdown
    if settings.influxdb_enabled:
        from .history.client import influx_client
        await influx_client.disconnect()
    await shutdown_notification_worker()
    await scheduler.stop()
    await redis_cache.disconnect()


app = FastAPI(
    title="Watchtower",
    description="Network Operations Center Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
] if settings.dev_mode else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

protected = [Depends(get_current_user)]
admin_only = [Depends(require_admin)]

# Read-leaning routers: any authenticated role can view. Endpoints that
# mutate inside these routers (alert ack/resolve, speedtest trigger,
# notification test send) opt up to operator/admin via per-route
# dependencies declared in the router files.
app.include_router(topology_router, prefix="/api", tags=["topology"], dependencies=protected)
app.include_router(devices_router, prefix="/api", tags=["devices"], dependencies=protected)
app.include_router(alerts_router, prefix="/api", tags=["alerts"], dependencies=protected)
app.include_router(vms_router, prefix="/api", tags=["vms"], dependencies=protected)
app.include_router(speedtest_router, prefix="/api", tags=["speedtest"], dependencies=protected)
app.include_router(portgroups_router, prefix="/api", tags=["port-groups"], dependencies=protected)
app.include_router(ports_router, prefix="/api", tags=["ports"], dependencies=protected)
app.include_router(history_router, prefix="/api", tags=["history"], dependencies=protected)
app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"], dependencies=protected)

# Admin-only routers: all endpoints inside expose either credential probing
# (diagnostics/test/*), internal cache state, or config mutation surfaces.
app.include_router(diagnostics_router, prefix="/api", tags=["diagnostics"], dependencies=admin_only)
app.include_router(discovery_router, prefix="/api", tags=["discovery"], dependencies=admin_only)
app.include_router(paloalto_router, prefix="/api", tags=["paloalto"], dependencies=admin_only)
app.include_router(settings_router, prefix="/api", tags=["settings"], dependencies=admin_only)

app.include_router(auth_router, prefix="/api", tags=["auth"])


@app.get("/health")
async def health_check():
    """Liveness check endpoint."""
    return {
        "status": "healthy",
        "service": "watchtower",
        "websocket_clients": ws_manager.connection_count,
    }


@app.get("/ready")
async def readiness_check():
    """Readiness check for dependencies needed to serve authenticated API traffic."""
    checks: dict[str, dict[str, object]] = {
        "config": {"ok": True},
        "jwt_secret": {"ok": True},
        "redis": {"ok": False},
    }

    try:
        validate_jwt_secret_for_runtime(config.auth.jwt_secret, dev_mode=settings.dev_mode)
    except RuntimeError as exc:
        checks["jwt_secret"] = {"ok": False, "error": str(exc)}

    try:
        await redis_cache.client.ping()
        checks["redis"] = {"ok": True}
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = {"ok": False, "error": exc.__class__.__name__}

    ready = all(bool(check["ok"]) for check in checks.values())
    if not ready:
        failed = ",".join(name for name, check in checks.items() if not check["ok"])
        log_event(logger, logging.WARNING, "readiness.failed", failed_checks=failed)
    status_code = 200 if ready else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if ready else "not_ready",
            "service": "watchtower",
            "checks": checks,
        },
    )


@app.get("/api/config")
async def get_app_config():
    """Get application configuration."""
    return {
        "dev_mode": settings.dev_mode,
    }


# WebSocket endpoint
app.websocket("/ws/updates")(websocket_endpoint)
