# API routers
from .topology import router as topology_router
from .devices import router as devices_router
from .alerts import router as alerts_router
from .history import router as history_router
from .settings import router as settings_router

__all__ = ["topology_router", "devices_router", "alerts_router", "history_router", "settings_router"]
