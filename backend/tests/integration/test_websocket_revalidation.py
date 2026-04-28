"""End-to-end tests for the WebSocket token revalidation sweep.

The unit suite in `tests/test_websocket_revalidation.py` drives
`_revalidate_once` directly with a fake socket. These tests exercise the
full path: a real ASGI WebSocket connection, the actual `revalidate_loop`
running on the test loop, and `websockets.connect()` observing the close
frame on the wire.

We start uvicorn in-process on a random port (same pattern as
`test_websocket_roles.py`) so the server runs on the same event loop as the
test body and can interact with `ws_manager` synchronously.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import uvicorn
import websockets
from fastapi import FastAPI

from app import websocket as ws_module
from app.auth import UserRole
from app.config import config
from app.websocket import (
    _EXPIRED_CLOSE_CODE,
    revalidate_loop,
    websocket_endpoint,
    ws_manager,
)

pytestmark = pytest.mark.integration


@pytest.fixture
async def ws_url():
    """Start uvicorn in-process on a random port; yield the WS URL."""
    app = FastAPI()
    app.websocket("/ws/updates")(websocket_endpoint)

    server_config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        log_level="warning",
        lifespan="off",
    )
    server = uvicorn.Server(server_config)
    serve_task = asyncio.create_task(server.serve())

    try:
        for _ in range(200):
            if serve_task.done():
                serve_task.result()
                raise RuntimeError("uvicorn exited before binding a port")
            if server.started and server.servers:
                break
            await asyncio.sleep(0.01)
        else:
            raise RuntimeError("uvicorn did not start within 2 seconds")

        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"ws://127.0.0.1:{port}/ws/updates"
    finally:
        async with ws_manager._lock:
            ws_manager._connections = []
        server.should_exit = True
        if not serve_task.done():
            try:
                await asyncio.wait_for(serve_task, timeout=2.0)
            except asyncio.TimeoutError:
                serve_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await serve_task


def _token_with_exp(role: str, exp_offset_seconds: int) -> str:
    """Mint a JWT signed with the live secret expiring at now+offset."""
    payload = {
        "sub": f"user-{role}",
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=exp_offset_seconds),
    }
    return jwt.encode(payload, config.auth.jwt_secret, algorithm="HS256")


async def _drain_greeting(ws):
    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=2.0))
    assert msg["type"] == "connected"
    return msg


async def test_mid_flight_expiry_triggers_close(ws_url):
    """A token that expires after the connection is established gets closed on the next sweep.

    We mint a token with `exp = now + 2`, connect, then drive the sweep at a
    0.5s interval until the close frame arrives. The close code surfaced by
    `websockets` is what the spec expects; if a future library version
    surfaces 1006 instead (some versions do for unsolicited close frames),
    pin to that value and update this comment.
    """
    token = _token_with_exp(UserRole.VIEWER.value, exp_offset_seconds=2)

    sweep_task = asyncio.create_task(revalidate_loop(ws_manager, interval=0.5))
    try:
        async with websockets.connect(f"{ws_url}?token={token}") as ws:
            await _drain_greeting(ws)

            # Wait for the close frame. Up to ~5s: 2s of token validity plus
            # a couple of 0.5s sweep ticks plus loop scheduling slack.
            with pytest.raises(websockets.exceptions.ConnectionClosed) as excinfo:
                await asyncio.wait_for(ws.recv(), timeout=5.0)

            assert excinfo.value.code == _EXPIRED_CLOSE_CODE, (
                f"expected close code {_EXPIRED_CLOSE_CODE} on mid-flight expiry, "
                f"got {excinfo.value.code}"
            )

        # Manager should have removed the dead connection.
        for _ in range(50):
            if ws_manager.connection_count == 0:
                break
            await asyncio.sleep(0.01)
        assert ws_manager.connection_count == 0
    finally:
        sweep_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweep_task


async def test_fresh_token_survives_two_sweeps(ws_url, monkeypatch):
    """A long-lived token stays connected across multiple sweep ticks and still receives broadcasts.

    We instrument `_revalidate_once` so the test only proceeds once at least
    two ticks have actually fired. Without that, sleeping past the interval
    is no proof that the loop ran; a crashed `revalidate_loop` would also
    leave the connection alive and broadcasts working.
    """
    token = _token_with_exp(UserRole.ADMIN.value, exp_offset_seconds=3600)

    tick_count = 0
    real_revalidate_once = ws_module._revalidate_once

    async def counting_revalidate(manager) -> None:
        nonlocal tick_count
        await real_revalidate_once(manager)
        tick_count += 1

    monkeypatch.setattr(ws_module, "_revalidate_once", counting_revalidate)

    sweep_task = asyncio.create_task(revalidate_loop(ws_manager, interval=0.2))
    try:
        async with websockets.connect(f"{ws_url}?token={token}") as ws:
            await _drain_greeting(ws)

            for _ in range(50):
                if ws_manager.connection_count >= 1:
                    break
                await asyncio.sleep(0.01)
            assert ws_manager.connection_count >= 1

            # Wait until at least two full sweeps have actually run.
            for _ in range(50):
                if tick_count >= 2:
                    break
                await asyncio.sleep(0.05)
            assert tick_count >= 2, (
                f"revalidate_loop should have ticked at least twice, saw {tick_count}"
            )

            assert ws_manager.connection_count == 1
            await ws_manager.broadcast({"type": "device_status_change", "device_id": 42})
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1.0))
            assert msg["type"] == "device_status_change"
            assert msg["device_id"] == 42
    finally:
        sweep_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweep_task
