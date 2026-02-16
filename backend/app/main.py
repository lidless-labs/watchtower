"""Watchtower NOC Dashboard - FastAPI Application."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import get_current_user
from .cache import redis_cache
from .config import settings, get_config
from .polling import scheduler
from .routers import alerts_router, devices_router, topology_router
from .routers.auth_router import router as auth_router
from .routers.diagnostics import router as diagnostics_router
from .routers.discovery import router as discovery_router
from .routers.vms import router as vms_router
from .routers.speedtest import router as speedtest_router
from .routers.paloalto import router as paloalto_router
from .routers.portgroups import router as portgroups_router
from .routers.ports import router as ports_router
from .websocket import websocket_endpoint, ws_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown events."""
    import asyncio

    # Startup
    await redis_cache.connect()

    if settings.demo_mode:
        # Demo mode: pre-populate cache with fake data and start simulator
        from .demo_simulator import initialize_demo_cache, demo_simulator
        await initialize_demo_cache()
        asyncio.create_task(demo_simulator())
        print("[DEMO] Demo mode active - using simulated data")
    else:
        # Production mode: start real polling scheduler if LibreNMS is configured
        config = get_config()
        if config.data_sources.librenms.url:
            scheduler.start()

    yield

    # Shutdown
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
