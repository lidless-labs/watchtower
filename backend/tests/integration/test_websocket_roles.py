"""Integration tests for WebSocket role-based broadcast filtering.

The unit suite in `tests/test_websocket_roles.py` covers the pure
`_is_allowed()` predicate. These tests exercise the full path: JWT auth on
connect, role-aware filtering through `ws_manager.broadcast()`, and proper
rejection of bad credentials, end-to-end against a real ASGI server.

We start uvicorn in-process on a random port so the server runs on the same
event loop as the tests; that lets us call `ws_manager.broadcast()` directly
from the test body and observe it on the wire.
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

from app.auth import UserRole, create_token
from app.config import config
from app.websocket import websocket_endpoint, ws_manager

pytestmark = pytest.mark.integration

TEST_JWT_SECRET = "websocket-role-jwt-secret-32-bytes"


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
        # Wait for the server to bind a port. Bail out fast if serve_task crashes.
        for _ in range(200):
            if serve_task.done():
                serve_task.result()  # surfaces the underlying exception
                raise RuntimeError("uvicorn exited before binding a port")
            if server.started and server.servers:
                break
            await asyncio.sleep(0.01)
        else:
            raise RuntimeError("uvicorn did not start within 2 seconds")

        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"ws://127.0.0.1:{port}/ws/updates"
    finally:
        # Drop any leftover connections so the next test starts clean.
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


def _viewer_token() -> str:
    config.auth.jwt_secret = TEST_JWT_SECRET
    config.auth.token_version = 1
    return create_token({"username": "viewer-int", "role": UserRole.VIEWER.value})


def _admin_token() -> str:
    config.auth.jwt_secret = TEST_JWT_SECRET
    config.auth.token_version = 1
    return create_token({"username": "admin-int", "role": UserRole.ADMIN.value})


def _expired_token() -> str:
    """JWT signed with the current secret but already past `exp`."""
    config.auth.jwt_secret = TEST_JWT_SECRET
    config.auth.token_version = 1
    payload = {
        "sub": "stale",
        "role": UserRole.VIEWER.value,
        "ver": config.auth.token_version,
        "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
    }
    return jwt.encode(payload, config.auth.jwt_secret, algorithm="HS256")


async def _drain_greeting(ws):
    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1.0))
    assert msg["type"] == "connected"
    return msg


async def test_viewer_receives_only_device_status_change(ws_url):
    """Viewer JWT subscribes; only `device_status_change` broadcasts arrive."""
    token = _viewer_token()
    async with websockets.connect(f"{ws_url}?token={token}") as ws:
        greeting = await _drain_greeting(ws)
        assert greeting["user"]["role"] == UserRole.VIEWER.value
        assert greeting["subscriptions"] == ["device_status_change"]

        # Give the server's connect handler a tick to register the connection.
        for _ in range(50):
            if ws_manager.connection_count >= 1:
                break
            await asyncio.sleep(0.01)
        assert ws_manager.connection_count >= 1, "connection should be registered"

        await ws_manager.broadcast({"type": "new_alerts", "alerts": []})
        await ws_manager.broadcast({"type": "alerts_resolved", "ids": [1]})
        await ws_manager.broadcast({"type": "device_status_change", "device_id": 7})

        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1.0))
        assert msg["type"] == "device_status_change"
        assert msg["device_id"] == 7

        # No further broadcasts should arrive for the viewer.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(ws.recv(), timeout=0.3)


async def test_admin_receives_all_broadcast_types(ws_url):
    """Admin JWT subscribes; receives every defined broadcast type in order."""
    token = _admin_token()
    async with websockets.connect(f"{ws_url}?token={token}") as ws:
        greeting = await _drain_greeting(ws)
        assert greeting["user"]["role"] == UserRole.ADMIN.value

        for _ in range(50):
            if ws_manager.connection_count >= 1:
                break
            await asyncio.sleep(0.01)

        types = ["device_status_change", "new_alerts", "alerts_resolved", "speedtest_result"]
        for t in types:
            await ws_manager.broadcast({"type": t, "marker": t})

        seen = []
        for _ in types:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1.0))
            seen.append(msg["type"])
        assert seen == types

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(ws.recv(), timeout=0.3)


async def test_expired_token_rejected_before_subscription(ws_url):
    """An expired JWT is rejected at connect; no greeting is sent."""
    bad = _expired_token()
    with pytest.raises(websockets.exceptions.ConnectionClosed):
        async with websockets.connect(f"{ws_url}?token={bad}") as ws:
            await asyncio.wait_for(ws.recv(), timeout=1.0)
    # The endpoint closes with code 4001 on auth failure; assert it never
    # registered a connection by looking at the manager state directly.
    assert ws_manager.connection_count == 0
