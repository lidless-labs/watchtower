"""WebSocket manager for real-time updates."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
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
    # Starlette/ASGI WebSockets are not safe for concurrent `send_json` on
    # the same connection: two coroutines writing to the underlying ASGI
    # send channel can interleave frame data. Every send call site
    # (broadcast, send_personal, anything else added later) must take this
    # lock around `await websocket.send_json(...)` to serialize sends per
    # connection while leaving cross-connection sends free to overlap.
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


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
        await self._drop_websockets([websocket])

    async def _drop_websockets(self, websockets: list[WebSocket]) -> None:
        """Remove the given websockets from `_connections` by identity.

        Shared cleanup for `broadcast`, `disconnect`, and `_revalidate_once`.
        Identity (`id()`) keying matters: a Starlette WebSocket subclass or
        a fake in tests could compare equal to a different instance, and
        equality-based removal would silently drop the wrong connection.
        Acquiring the lock once for a batch is also cheaper than per-call
        churn when broadcast surfaces multiple dead peers in one pass.
        """
        if not websockets:
            return
        target_ids = {id(ws) for ws in websockets}
        async with self._lock:
            self._connections = [
                c for c in self._connections if id(c.websocket) not in target_ids
            ]

    async def send_personal(self, message: dict[str, Any], websocket: WebSocket) -> None:
        """Send a message to a specific client, bypassing role filtering.

        Routes through the registered `_Connection.send_lock` so a personal
        send (e.g. the connect-time greeting or a `pong`) cannot interleave
        frames with a concurrent broadcast or a revalidation `close()` on
        the same websocket.

        If the websocket is not currently registered with the manager
        (e.g. the revalidation sweep already dropped it from
        `_connections` and is about to close it under its `send_lock`),
        the send is skipped. Falling back to a direct `send_json` would
        race the in-flight close on the same ASGI send channel; the
        upcoming close will surface to the receive loop as
        `WebSocketDisconnect` and the next round of cleanup will handle
        it.
        """
        async with self._lock:
            conn = next(
                (c for c in self._connections if c.websocket is websocket),
                None,
            )
        if conn is None:
            return
        try:
            async with conn.send_lock:
                # Recheck membership: the revalidation sweep can drop this
                # `_Connection` between releasing `self._lock` above and
                # acquiring `send_lock` here, in which case the socket is
                # either already closed or about to be. `send_lock` alone
                # serializes against frame interleaving but does not stop
                # us from emitting one final pong/greeting to a doomed
                # peer; the explicit recheck does.
                async with self._lock:
                    if not any(c is conn for c in self._connections):
                        return
                await conn.websocket.send_json(message)
        except Exception:
            await self.disconnect(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast a message to all connected clients whose role allows it.

        Three phases, lock policy mirrors `_revalidate_once`:

        1. Snapshot the recipient list under the lock.
        2. Await `send_json` on each recipient OUTSIDE the lock. Holding
           the lock across a network await turns one slow or hung client
           into a system-wide stall on every other manager operation
           (other broadcasts, connects, disconnects, the sweep tick).
        3. Re-acquire the lock to prune any sockets whose send raised,
           keyed by identity so equality quirks on a WebSocket subclass
           cannot drop the wrong entry.

        Filtering is done by `message["type"]`. Connections whose role does
        not include this message type are silently skipped.
        """
        if not self._connections:
            return

        message_type = message.get("type")
        async with self._lock:
            recipients: list[_Connection] = [
                c for c in self._connections if _is_allowed(c.role, message_type)
            ]

        if not recipients:
            return

        disconnected: list[WebSocket] = []
        for conn in recipients:
            try:
                async with conn.send_lock:
                    await conn.websocket.send_json(message)
            except Exception:
                disconnected.append(conn.websocket)

        if disconnected:
            await self._drop_websockets(disconnected)

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

    Four phases:

    1. Snapshot `_Connection` objects under `manager._lock`.
    2. Decode each token outside the lock; build the victim list as
       `_Connection` references (not bare WebSockets) so the close phase
       can serialize with concurrent broadcasts via the per-connection
       `send_lock`.
    3. Drop victims from `_connections` so new broadcasts skip them.
    4. For each victim, acquire `send_lock` BEFORE awaiting
       `websocket.close()`. A close frame is a send-channel write; if it
       races a broadcast's `send_json` on the same socket the ASGI send
       channel can interleave frames. Removal from `_connections` does
       NOT close this race on its own: a concurrent broadcast that
       already snapshotted this `_Connection` still holds a live
       reference and will take the same `send_lock` to send. Routing
       close through `send_lock` is the actual serialization point.
    """
    async with manager._lock:
        snapshot = list(manager._connections)

    victims: list[_Connection] = []
    for conn in snapshot:
        try:
            decode_token(conn.token)
        except HTTPException:
            victims.append(conn)

    if not victims:
        return

    await manager._drop_websockets([conn.websocket for conn in victims])

    for conn in victims:
        try:
            async with conn.send_lock:
                await conn.websocket.close(code=_EXPIRED_CLOSE_CODE)
        except Exception:
            # Already-closed sockets raise here; nothing left to clean up
            # because `_drop_websockets` above already removed every victim
            # from `_connections`.
            pass


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
