"""Notification delivery API router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from app.services.notification_service import notification_service
from app.config import get_config

router = APIRouter()


def _get_config_dict() -> dict:
    cfg = get_config()
    return cfg.model_dump()


@router.get("/history")
async def notification_history(limit: int = Query(default=50, le=200)):
    return {"history": notification_service.get_history(limit)}


@router.get("/stats")
async def notification_stats():
    return notification_service.get_stats()


@router.post("/test/{channel}", dependencies=[Depends(require_admin)])
async def test_channel(channel: str):
    if channel not in {"discord", "pushover", "email"}:
        raise HTTPException(status_code=400, detail=f"Unknown channel: {channel}")

    config = _get_config_dict()
    record = await notification_service.test_channel(channel, config)
    return record.to_dict()
