"""WebSocket manager for real-time updates."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from .auth import UserRole, decode_token


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


class ConnectionManager:
    """Manages WebSocket connections and role-aware broadcasts."""

    def __init__(self):
        self._connections: list[_Connection] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, role: str) -> None:
        """Accept a new authenticated WebSocket connection.

        Caller must already have authenticated the JWT and resolved a role.
        """
        await websocket.accept()
        async with self._lock:
            self._connections.append(_Connection(websocket=websocket, role=role))

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


async def _authenticate_websocket(websocket: WebSocket) -> dict[str, Any] | None:
    token = (websocket.query_params.get("token") or "").strip()

    if token:
        try:
            return decode_token(token)
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
        return decode_token(candidate)
    except Exception:
        return None


async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint handler."""
    user = await _authenticate_websocket(websocket)
    if not user:
        await _close_unauthorized(websocket)
        return

    role = user.get("role") or ""
    # An authenticated JWT with no role (or an unknown role) has no broadcast
    # subscription, so fail closed rather than silently letting the client
    # sit attached and receive nothing.
    if role not in ROLE_ALLOWED_MESSAGE_TYPES:
        await _close_unauthorized(websocket)
        return

    if websocket.application_state != WebSocketState.CONNECTED:
        await ws_manager.connect(websocket, role)
    else:
        async with ws_manager._lock:
            already_attached = any(
                c.websocket is websocket for c in ws_manager._connections
            )
            if not already_attached:
                ws_manager._connections.append(_Connection(websocket=websocket, role=role))

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
