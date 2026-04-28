"""WebSocket manager for real-time updates."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from .auth import UserRole, decode_token

logger = logging.getLogger(__name__)


# Per-role allowlist of broadcast message types. Admin and operator see the
# full stream; viewer is restricted to non-sensitive device-status updates so
# a JWT minted for a read-only user can't observe alert volume, recovery
# patterns, or speedtest history.
#
# Update this map (NOT the call sites) when a new broadcast type is added.
_FULL_BROADCAST = frozenset({
    "device_status_change",
    "new_alerts",
    "alerts_resolved",
    "speedtest_result",
})

ROLE_ALLOWED_MESSAGE_TYPES: dict[str, frozenset[str]] = {
    UserRole.ADMIN.value: _FULL_BROADCAST,
    UserRole.OPERATOR.value: _FULL_BROADCAST,
    UserRole.VIEWER.value: frozenset({"device_status_change"}),
}


def _is_allowed(role: str, message_type: str | None) -> bool:
    """True if a client with `role` should receive a broadcast of this type.

    Unknown message types are treated conservatively: only admin/operator see
    them, so a new broadcast added without updating the allowlist defaults
    closed for viewers (information disclosure is the failure mode we care
    about). Roles outside the known set get nothing.
    """
    allowed = ROLE_ALLOWED_MESSAGE_TYPES.get(role)
    if allowed is None:
        return False
    if message_type is None:
        return False
    if message_type in allowed:
        return True
    # Unknown type: only admin/operator (which have _FULL_BROADCAST) see it.
    return allowed is _FULL_BROADCAST


@dataclass
class _Connection:
    websocket: WebSocket
    role: str
    token: str


class ConnectionManager:
    """Manages WebSocket connections and role-aware broadcasts."""

    def __init__(self):
        self._connections: list[_Connection] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, role: str, token: str) -> None:
        """Accept a new authenticated WebSocket connection.

        Caller must already have authenticated the JWT and resolved a role.
        The raw token is retained so the revalidation sweep can re-decode it
        on each tick and close sockets whose JWT has since expired or whose
        signing secret has rotated.
        """
        await websocket.accept()
        async with self._lock:
            self._connections.append(
                _Connection(websocket=websocket, role=role, token=token)
            )

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        async with self._lock:
            self._connections = [c for c in self._connections if c.websocket is not websocket]

    async def send_personal(self, message: dict[str, Any], websocket: WebSocket) -> None:
        """Send a message to a specific client, bypassing role filtering."""
        try:
            await websocket.send_json(message)
        except Exception:
            await self.disconnect(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast a message to all connected clients whose role allows it.

        Filtering is done by `message["type"]`. Connections whose role does
        not include this message type are silently skipped.
        """
        if not self._connections:
            return

        message_type = message.get("type")
        disconnected: list[WebSocket] = []
        async with self._lock:
            for conn in self._connections:
                if not _is_allowed(conn.role, message_type):
                    continue
                try:
                    await conn.websocket.send_json(message)
                except Exception:
                    disconnected.append(conn.websocket)

        for ws in disconnected:
            await self.disconnect(ws)

    @property
    def connection_count(self) -> int:
        """Return the number of active connections."""
        return len(self._connections)

    @property
    def active_connections(self) -> list[WebSocket]:
        """Read-only view kept for backward compatibility with tests/diagnostics
        that just want the websocket list. Prefer `connection_count` for a
        plain count, or extend ConnectionManager directly for new uses."""
        return [c.websocket for c in self._connections]


ws_manager = ConnectionManager()


async def _close_unauthorized(websocket: WebSocket) -> None:
    if websocket.application_state == WebSocketState.CONNECTING:
        await websocket.accept()
    await websocket.close(code=4001)


async def _authenticate_websocket(
    websocket: WebSocket,
) -> tuple[dict[str, Any], str] | None:
    token = (websocket.query_params.get("token") or "").strip()

    if token:
        try:
            return decode_token(token), token
        except Exception:
            return None

    if websocket.application_state == WebSocketState.CONNECTING:
        await websocket.accept()

    try:
        raw_message = await websocket.receive_text()
    except WebSocketDisconnect:
        return None

    try:
        message = json.loads(raw_message)
    except json.JSONDecodeError:
        return None

    candidate = str(message.get("token") or "").strip()
    if not candidate:
        return None

    try:
        return decode_token(candidate), candidate
    except Exception:
        return None


async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint handler."""
    auth = await _authenticate_websocket(websocket)
    if not auth:
        await _close_unauthorized(websocket)
        return

    user, token = auth
    role = user.get("role") or ""
    # An authenticated JWT with no role (or an unknown role) has no broadcast
    # subscription, so fail closed rather than silently letting the client
    # sit attached and receive nothing.
    if role not in ROLE_ALLOWED_MESSAGE_TYPES:
        await _close_unauthorized(websocket)
        return

    if websocket.application_state != WebSocketState.CONNECTED:
        await ws_manager.connect(websocket, role, token)
    else:
        async with ws_manager._lock:
            already_attached = any(
                c.websocket is websocket for c in ws_manager._connections
            )
            if not already_attached:
                ws_manager._connections.append(
                    _Connection(websocket=websocket, role=role, token=token)
                )

    await ws_manager.send_personal(
        {
            "type": "connected",
            "message": "Connected to Watchtower",
            "user": user,
            "subscriptions": sorted(ROLE_ALLOWED_MESSAGE_TYPES[role]),
        },
        websocket,
    )

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await ws_manager.send_personal({"type": "pong"}, websocket)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)


# Default sweep period. 60s gives 0.2% slop on an 8h session, which is below
# any reasonable detection threshold for stale auth and avoids creating a
# config knob nobody asks for.
_REVALIDATION_INTERVAL_DEFAULT = 60.0
# Match the connect-time rejection code in `_close_unauthorized` so the
# frontend sees one consistent "auth refused" signal.
_EXPIRED_CLOSE_CODE = 4001


async def _revalidate_once(manager: ConnectionManager) -> None:
    """Decode every live connection's stored token; close the ones that fail.

    Three phases, two lock sections:

    1. Snapshot `(websocket, token)` pairs under lock.
    2. Decode each token outside the lock; build the victim list.
    3. Re-acquire the lock and remove victims from `_connections` BEFORE
       awaiting `ws.close()`. Removal under the lock is what prevents a
       concurrent `broadcast()` from sending to a doomed socket while we
       are closing it; Starlette WebSockets are not safe for concurrent
       send + close on the same connection.
    4. Close each victim outside the lock. `manager.disconnect` is then a
       no-op (idempotent identity removal) but is still called so a
       broken-connection branch in broadcast can also feed cleanup
       through the same path.
    """
    async with manager._lock:
        snapshot = [(c.websocket, c.token) for c in manager._connections]

    victims: list[WebSocket] = []
    for ws, token in snapshot:
        try:
            decode_token(token)
        except HTTPException:
            victims.append(ws)

    if not victims:
        return

    victim_ids = {id(ws) for ws in victims}
    async with manager._lock:
        manager._connections = [
            c for c in manager._connections if id(c.websocket) not in victim_ids
        ]

    for ws in victims:
        try:
            await ws.close(code=_EXPIRED_CLOSE_CODE)
        except Exception:
            # Already-closed sockets raise here; we still want any defensive
            # cleanup downstream to fire.
            pass
        await manager.disconnect(ws)


async def revalidate_loop(
    manager: ConnectionManager,
    interval: float = _REVALIDATION_INTERVAL_DEFAULT,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Periodically re-decode every live connection's JWT and close expired ones.

    A single decode bug or logger glitch must not silently kill the background
    task and leave the system without revalidation, so we catch everything
    that is not a `CancelledError`. Cancellation propagates so lifespan
    shutdown stays deterministic.
    """
    while True:
        try:
            await sleep(interval)
            await _revalidate_once(manager)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ws revalidate sweep failed; continuing")
