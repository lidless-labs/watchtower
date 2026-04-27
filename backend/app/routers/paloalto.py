"""
Palo Alto Firewall API Router

Placeholder for future Palo Alto firewall integration.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix="/paloalto", tags=["paloalto"])


@router.get("/firewalls")
async def get_firewalls() -> list[dict]:
    """
    List configured Palo Alto firewalls.

    Returns basic info about configured firewalls (no API calls made).
    """
    settings = get_settings()
    configs = settings.get_palo_alto_configs()

    return [
        {
            "name": fw.name,
            "host": fw.host,
            "model": fw.model,
        }
        for fw in configs
    ]
