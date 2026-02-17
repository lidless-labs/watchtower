"""Watchtower NOC Dashboard - FastAPI Application."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import get_current_user
from .cache import redis_cache
from .config import config, settings, get_config
from .polling import scheduler
from .routers import alerts_router, devices_router, topology_router, history_router, settings_router
from .routers.auth_router import router as auth_router
from .routers.diagnostics import router as diagnostics_router
from .routers.discovery import router as discovery_router
from .routers.vms import router as vms_router
from .routers.speedtest import router as speedtest_router
from .routers.paloalto import router as paloalto_router
from .routers.portgroups import router as portgroups_router
from .routers.ports import router as ports_router
from .routers.notifications import router as notifications_router
from .websocket import websocket_endpoint, ws_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown events."""
    global config  # noqa: PLW0603 — needed to reassign module-level singleton

    import asyncio
    import logging
    import secrets

    logger = logging.getLogger("watchtower.startup")

    # Startup
    await redis_cache.connect()

    if settings.demo_mode:
        # Demo mode: pre-populate cache with fake data and start simulator
        from .demo_simulator import initialize_demo_cache, demo_simulator
        from .history.demo_seeder import seed_demo_history
        from .history.demo_store import demo_history_store

        await initialize_demo_cache()
        seed_demo_history(demo_history_store)
        asyncio.create_task(demo_simulator())
        print("[DEMO] Demo mode active - using simulated data")
    else:
        # Production mode: start real polling scheduler if LibreNMS is configured
        config = get_config()

        # ── JWT secret safety check (after config reload) ────────────────
        if config.auth.jwt_secret == "change-me-in-production":
            generated = secrets.token_urlsafe(32)
            config.auth.jwt_secret = generated
            logger.critical(
                "JWT secret is still the default 'change-me-in-production'! "
                "A random secret has been generated for THIS session. "
                "Set auth.jwt_secret in config.yaml for persistent sessions."
            )

        # Sync YAML config → env settings for InfluxDB
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

    yield

    # Shutdown
    if not settings.demo_mode and settings.influxdb_enabled:
        from .history.client import influx_client
        await influx_client.disconnect()
    await scheduler.stop()
    await redis_cache.disconnect()


app = FastAPI(
    title="Watchtower",
    description="Network Operations Center Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration
origins = ["*"] if settings.dev_mode else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
if settings.demo_mode:
    app.include_router(topology_router, prefix="/api", tags=["topology"])
    app.include_router(devices_router, prefix="/api", tags=["devices"])
    app.include_router(alerts_router, prefix="/api", tags=["alerts"])
    app.include_router(diagnostics_router, prefix="/api", tags=["diagnostics"])
    app.include_router(discovery_router, prefix="/api", tags=["discovery"])
    app.include_router(vms_router, prefix="/api", tags=["vms"])
    app.include_router(speedtest_router, prefix="/api", tags=["speedtest"])
    app.include_router(paloalto_router, prefix="/api", tags=["paloalto"])
    app.include_router(portgroups_router, prefix="/api", tags=["port-groups"])
    app.include_router(ports_router, prefix="/api", tags=["ports"])
    app.include_router(history_router, prefix="/api", tags=["history"])
    app.include_router(settings_router, prefix="/api", tags=["settings"])
    app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
else:
    protected = [Depends(get_current_user)]
    app.include_router(topology_router, prefix="/api", tags=["topology"], dependencies=protected)
    app.include_router(devices_router, prefix="/api", tags=["devices"], dependencies=protected)
    app.include_router(alerts_router, prefix="/api", tags=["alerts"], dependencies=protected)
    app.include_router(diagnostics_router, prefix="/api", tags=["diagnostics"], dependencies=protected)
    app.include_router(discovery_router, prefix="/api", tags=["discovery"], dependencies=protected)
    app.include_router(vms_router, prefix="/api", tags=["vms"], dependencies=protected)
    app.include_router(speedtest_router, prefix="/api", tags=["speedtest"], dependencies=protected)
    app.include_router(paloalto_router, prefix="/api", tags=["paloalto"], dependencies=protected)
    app.include_router(portgroups_router, prefix="/api", tags=["port-groups"], dependencies=protected)
    app.include_router(ports_router, prefix="/api", tags=["ports"], dependencies=protected)
    app.include_router(history_router, prefix="/api", tags=["history"], dependencies=protected)
    app.include_router(settings_router, prefix="/api", tags=["settings"], dependencies=protected)
    app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"], dependencies=protected)

app.include_router(auth_router, prefix="/api", tags=["auth"])


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "watchtower",
        "websocket_clients": ws_manager.connection_count,
    }


@app.get("/api/config")
async def get_app_config():
    """Get application configuration (for frontend to detect demo mode)."""
    return {
        "demo_mode": settings.demo_mode,
        "dev_mode": settings.dev_mode,
    }


# WebSocket endpoint
app.websocket("/ws/updates")(websocket_endpoint)
