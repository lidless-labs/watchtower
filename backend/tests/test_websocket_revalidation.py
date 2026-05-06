"""Tests for the WebSocket token revalidation sweep.

Locks in the runtime invariant that mid-flight invalid tokens (expired,
tampered, or signed with a stale secret) get their sockets closed within
roughly one sweep interval, with the same close code as connect-time
rejection (4001).

These cases drive `_revalidate_once` directly with a tiny fake WebSocket so
nothing here depends on a real ASGI server or event-loop scheduling. The
matching end-to-end test lives in `tests/integration/test_websocket_revalidation.py`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pytest
from starlette.websockets import WebSocketState

from app import websocket as ws_module
from app.auth import UserRole
from app.config import config
from app.websocket import (
    _EXPIRED_CLOSE_CODE,
    ConnectionManager,
    _Connection,
    _revalidate_once,
    revalidate_loop,
)


class _FakeWS:
    """Stand-in for a real Starlette WebSocket inside the manager.

    `_revalidate_once` only ever calls `close(code=...)` and uses the object
    by identity (`is`) for the manager's per-connection bookkeeping. Anything
    beyond those two surfaces is intentionally absent: a richer fake makes
    coverage gaps easier to hide.
    """

    def __init__(self) -> None:
        self.closed_with: int | None = None

    @property
    def application_state(self) -> WebSocketState:
        return WebSocketState.CONNECTED

    async def close(self, code: int) -> None:
        self.closed_with = code


def _mint(role: str, *, exp_offset_seconds: int) -> str:
    """Return a JWT signed with the live config secret expiring at now+offset.

    Negative offsets produce already-expired tokens.
    """
    payload = {
        "sub": f"user-{role}",
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=exp_offset_seconds),
    }
    return jwt.encode(payload, config.auth.jwt_secret, algorithm="HS256")


def _attach(manager: ConnectionManager, ws: Any, role: str, token: str) -> None:
    """Install a connection without going through the live `connect()` path.

    Connecting for real means accepting an ASGI WebSocket, which we don't have
    in unit tests. The manager's revalidation surface only reads from
    `_connections`, so direct insertion is the cheapest way to exercise it.
    """
    manager._connections.append(_Connection(websocket=ws, role=role, token=token))


async def test_expired_token_closes_and_removes():
    """An expired JWT gets its socket closed with 4001 and removed from the manager."""
    manager = ConnectionManager()
    fresh_ws = _FakeWS()
    expired_ws = _FakeWS()
    _attach(manager, fresh_ws, UserRole.ADMIN.value, _mint(UserRole.ADMIN.value, exp_offset_seconds=3600))
    _attach(manager, expired_ws, UserRole.VIEWER.value, _mint(UserRole.VIEWER.value, exp_offset_seconds=-60))

    await _revalidate_once(manager)

    assert expired_ws.closed_with == _EXPIRED_CLOSE_CODE
    assert fresh_ws.closed_with is None
    assert manager.connection_count == 1
    assert manager.active_connections == [fresh_ws]


async def test_tampered_token_closes():
    """Flipping a byte in the JWT signature makes decode fail; the socket is closed."""
    manager = ConnectionManager()
    ws = _FakeWS()
    good = _mint(UserRole.ADMIN.value, exp_offset_seconds=3600)
    # JWT format is header.payload.signature; mutate the last char of the
    # signature segment so HS256 verification fails.
    head, payload, sig = good.split(".")
    flipped_char = "B" if sig[-1] != "B" else "C"
    tampered = ".".join([head, payload, sig[:-1] + flipped_char])
    _attach(manager, ws, UserRole.ADMIN.value, tampered)

    await _revalidate_once(manager)

    assert ws.closed_with == _EXPIRED_CLOSE_CODE
    assert manager.connection_count == 0


async def test_fresh_valid_session_survives_sweep():
    """A non-expired, properly signed token leaves the connection intact."""
    manager = ConnectionManager()
    ws = _FakeWS()
    _attach(manager, ws, UserRole.OPERATOR.value, _mint(UserRole.OPERATOR.value, exp_offset_seconds=3600))

    await _revalidate_once(manager)

    assert ws.closed_with is None
    assert manager.connection_count == 1


async def test_already_closed_socket_does_not_break_sweep():
    """A peer that hangs up between snapshot and close does not derail cleanup.

    Monkeypatch `ws.close` to raise (Starlette raises on close-after-close)
    and assert the sweep swallows it, leaves no connection behind, and
    finishes without propagating the exception. `_drop_websockets` runs
    before the close loop so victim removal is independent of whether
    `close()` succeeds.
    """
    manager = ConnectionManager()
    ws = _FakeWS()
    _attach(manager, ws, UserRole.VIEWER.value, _mint(UserRole.VIEWER.value, exp_offset_seconds=-60))

    close_calls: list[int] = []

    async def raising_close(code: int) -> None:
        close_calls.append(code)
        raise RuntimeError("peer already closed")

    ws.close = raising_close  # type: ignore[assignment]

    # Must not raise even though `close` does.
    await _revalidate_once(manager)

    assert close_calls == [_EXPIRED_CLOSE_CODE], (
        "sweep must still attempt close() even though _drop_websockets has "
        "already removed the victim from _connections"
    )
    assert manager.connection_count == 0


async def test_victim_removed_before_close_to_block_concurrent_broadcast():
    """The expired connection is gone from `_connections` before `ws.close()` awaits.

    Locks in the design refinement Codex flagged: holding the close call
    outside the manager lock is fine, but the entry must be unregistered
    *before* we await close, otherwise a concurrent `broadcast()` can send
    to a doomed socket while we are closing it.

    We force `ws.close` to inspect the manager mid-flight; the connection
    must already be gone at that point.
    """
    manager = ConnectionManager()
    ws = _FakeWS()
    _attach(manager, ws, UserRole.VIEWER.value, _mint(UserRole.VIEWER.value, exp_offset_seconds=-60))

    seen_count_during_close: list[int] = []

    async def inspecting_close(code: int) -> None:
        async with manager._lock:
            seen_count_during_close.append(len(manager._connections))

    ws.close = inspecting_close  # type: ignore[assignment]

    await _revalidate_once(manager)

    assert seen_count_during_close == [0], (
        "victim must be unregistered before close() runs, otherwise concurrent "
        "broadcast can send to a doomed socket"
    )


async def test_outer_loop_catch_all_keeps_task_alive(monkeypatch):
    """A failure inside `_revalidate_once` is logged but the loop survives.

    First tick raises, second tick succeeds. We drive the loop with a fake
    `sleep` that yields twice and then cancels, so the loop runs exactly two
    iterations before shutdown.
    """
    manager = ConnectionManager()
    calls: list[int] = []

    async def flaky_revalidate(_manager: ConnectionManager) -> None:
        calls.append(len(calls) + 1)
        if calls == [1]:
            raise RuntimeError("simulated decode bug")

    sleeps: list[int] = []

    async def fake_sleep(_interval: float) -> None:
        sleeps.append(len(sleeps) + 1)
        if len(sleeps) >= 3:
            raise asyncio.CancelledError()

    monkeypatch.setattr(ws_module, "_revalidate_once", flaky_revalidate)

    with pytest.raises(asyncio.CancelledError):
        await revalidate_loop(manager, interval=0.0, sleep=fake_sleep)

    assert calls == [1, 2], "second tick must run even after the first raised"
    assert sleeps == [1, 2, 3]
