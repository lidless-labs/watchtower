"""WebSocket manager for real-time updates."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from .auth import decode_token


class ConnectionManager:
    """Manages WebSocket connections and broadcasts."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new authenticated WebSocket connection."""
        await websocket.accept()
        async with self._lock:
            self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    async def send_personal(self, message: dict[str, Any], websocket: WebSocket) -> None:
        """Send a message to a specific client."""
        try:
            await websocket.send_json(message)
        except Exception:
            await self.disconnect(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast a message to all connected clients."""
        if not self.active_connections:
            return

        disconnected = []
        async with self._lock:
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    disconnected.append(connection)

        for conn in disconnected:
            await self.disconnect(conn)

    @property
    def connection_count(self) -> int:
        """Return the number of active connections."""
        return len(self.active_connections)


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

    if websocket.application_state != WebSocketState.CONNECTED:
        await ws_manager.connect(websocket)
    else:
        async with ws_manager._lock:
            if websocket not in ws_manager.active_connections:
                ws_manager.active_connections.append(websocket)

    await ws_manager.send_personal(
        {
            "type": "connected",
            "message": "Connected to Watchtower",
            "user": user,
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
