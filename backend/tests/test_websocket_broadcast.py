"""Tests for ConnectionManager.broadcast lock policy.

Two invariants under test:

- broadcast must not hold `manager._lock` while awaiting `send_json` on
  individual connections, otherwise any slow or hung client stalls every
  concurrent manager operation (other broadcasts, connects, disconnects,
  the revalidation sweep).
- a connection whose `send_json` raises is pruned by identity, mirroring
  the snapshot-then-prune pattern in `_revalidate_once`.

These tests drive `ConnectionManager` directly with tiny fake WebSockets so
nothing here depends on a real ASGI server. They use real timing (an
`asyncio.Event` in a slow `send_json`) rather than mocked sleeps, because
mocked sleeps pass the same way against a still-locked manager and would
hide the bug they are meant to catch.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from starlette.websockets import WebSocketState

from app import websocket as ws_module
from app.auth import UserRole
from app.websocket import ConnectionManager, _Connection, _revalidate_once


class _FastFakeWS:
    """Stand-in WebSocket whose `send_json` records and returns immediately."""

    def __init__(self) -> None:
        self.received: list[dict[str, Any]] = []

    @property
    def application_state(self) -> WebSocketState:
        return WebSocketState.CONNECTED

    async def send_json(self, message: dict[str, Any]) -> None:
        self.received.append(message)


class _BlockingFakeWS:
    """Stand-in WebSocket whose `send_json` parks on an `asyncio.Event`.

    `send_started` flips the moment `send_json` is entered, so a test can
    wait for the manager to actually be mid-await before probing for the
    lock-held bug. `release` lets the test let the send finish at the end.
    """

    def __init__(self) -> None:
        self.send_started = asyncio.Event()
        self.release = asyncio.Event()

    @property
    def application_state(self) -> WebSocketState:
        return WebSocketState.CONNECTED

    async def send_json(self, message: dict[str, Any]) -> None:
        self.send_started.set()
        await self.release.wait()


class _RaisingFakeWS:
    """Stand-in WebSocket whose `send_json` always raises."""

    def __init__(self) -> None:
        self.send_called = False

    @property
    def application_state(self) -> WebSocketState:
        return WebSocketState.CONNECTED

    async def send_json(self, message: dict[str, Any]) -> None:
        self.send_called = True
        raise RuntimeError("simulated peer drop mid-send")


class _ProbingLock:
    """`asyncio.Lock` that flips `acquire_blocked` when a coroutine waits.

    The recheck race tests need to know the racing coroutine has actually
    parked on `conn.send_lock` before we drop the connection. Yielding
    the loop a fixed number of times via `await asyncio.sleep(0)` is a
    hope, not a proof: if `_drop_websockets` runs before the racing
    coroutine reaches `send_lock`, the recipient snapshot inside
    `broadcast` was never taken (or `send_personal`'s lookup never ran),
    and the test passes without exercising the recheck path at all.

    Ducktypes the surface that `async with conn.send_lock:` and a manual
    pre-acquire from a test need: `acquire`, `release`, `locked`, and
    the async context manager protocol.
    """

    def __init__(self) -> None:
        self._inner = asyncio.Lock()
        self.acquire_blocked = asyncio.Event()

    async def acquire(self) -> bool:
        if self._inner.locked():
            self.acquire_blocked.set()
        return await self._inner.acquire()

    def release(self) -> None:
        self._inner.release()

    def locked(self) -> bool:
        return self._inner.locked()

    async def __aenter__(self) -> "_ProbingLock":
        await self.acquire()
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        self.release()


def _attach(manager: ConnectionManager, ws: Any, role: str) -> None:
    """Install a connection without going through the live `connect()` path.

    `connect()` would `await websocket.accept()`, which the fakes do not
    implement. Broadcast only reads `_connections` and calls `send_json`,
    so direct insertion is enough.
    """
    manager._connections.append(_Connection(websocket=ws, role=role, token=""))


async def test_broadcast_does_not_hold_lock_across_send_json():
    """A slow `send_json` must not stall an unrelated `disconnect()`.

    Pre-fix behavior: `broadcast()` holds `manager._lock` for the entire
    iteration over `_connections`, including the `await send_json(...)`
    on each one. One stuck client = system-wide stall on every other
    manager operation.

    We fire a broadcast that gets pinned on a blocking client, wait for
    the manager to be actively mid-`send_json`, then time how long an
    unrelated `disconnect()` takes. Without the fix it waits on the
    blocked send (effectively forever); with the fix it returns
    immediately because the lock has already been released.
    """
    manager = ConnectionManager()
    blocking = _BlockingFakeWS()
    _attach(manager, blocking, UserRole.ADMIN.value)

    broadcast_task = asyncio.create_task(
        manager.broadcast({"type": "device_status_change", "status": "down"})
    )
    try:
        await asyncio.wait_for(blocking.send_started.wait(), timeout=1.0)

        unrelated = _FastFakeWS()
        try:
            await asyncio.wait_for(manager.disconnect(unrelated), timeout=0.25)
        except asyncio.TimeoutError:  # pragma: no cover - failure path
            pytest.fail(
                "disconnect() blocked while broadcast awaited send_json - "
                "broadcast is holding manager._lock across a network await"
            )
    finally:
        blocking.release.set()
        await broadcast_task


async def test_revalidation_close_serializes_with_in_flight_broadcast():
    """`_revalidate_once` must not call `close()` while a broadcast is mid-send.

    Pre-fix (this PR's first revision included), `_revalidate_once` called
    `await ws.close()` without holding the per-connection `send_lock`. A
    concurrent `broadcast()` snapshotted the same `_Connection`, took
    `send_lock`, and entered `send_json`. The close frame and the in-flight
    data frame then raced on the ASGI send channel. Removing the connection
    from `_connections` does NOT close this race because the broadcast
    snapshot already holds a live `_Connection` reference.

    Setup: empty-string token => `decode_token` raises HTTPException =>
    sweep marks this connection a victim. Block `send_json` mid-flight,
    fire the real `_revalidate_once`, and assert `close()` does not run
    until the broadcast releases `send_lock`.
    """

    class _BlockingFakeWSWithClose:
        def __init__(self) -> None:
            self.send_started = asyncio.Event()
            self.release = asyncio.Event()
            self.close_called_before_release = False
            self.close_called = False

        @property
        def application_state(self) -> WebSocketState:
            return WebSocketState.CONNECTED

        async def send_json(self, message: dict[str, Any]) -> None:
            self.send_started.set()
            await self.release.wait()

        async def close(self, code: int = 1000) -> None:
            if not self.release.is_set():
                self.close_called_before_release = True
            self.close_called = True

    manager = ConnectionManager()
    ws = _BlockingFakeWSWithClose()
    _attach(manager, ws, UserRole.ADMIN.value)

    broadcast_task = asyncio.create_task(
        manager.broadcast({"type": "device_status_change"})
    )
    sweep_task: asyncio.Task[None] | None = None
    try:
        await asyncio.wait_for(ws.send_started.wait(), timeout=1.0)

        sweep_task = asyncio.create_task(_revalidate_once(manager))

        # Give the sweep ample wall-clock time to traverse its
        # snapshot/decode/drop phases and contend on `send_lock`. If the
        # sweep bypassed the lock, close() would land here.
        await asyncio.sleep(0.05)

        assert not ws.close_called, (
            "_revalidate_once closed the websocket while a broadcast was "
            "mid-send_json on the same connection; close must serialize "
            "via the per-connection send_lock"
        )
    finally:
        ws.release.set()
        await broadcast_task
        if sweep_task is not None:
            await sweep_task

    assert ws.close_called, "sweep should have closed the expired connection"
    assert not ws.close_called_before_release, (
        "close() ran before send_json was released; per-connection "
        "send_lock did not serialize close against the in-flight send"
    )


async def test_broadcast_rechecks_membership_under_send_lock():
    """`broadcast` must recheck `_connections` after acquiring `send_lock`.

    Symmetric to the `send_personal` recheck. `broadcast()` snapshots
    recipients under `manager._lock`, releases the lock, and then awaits
    `send_lock` per recipient. The revalidation sweep can drop a snapped
    `_Connection` from `_connections` in that window. Without the
    in-`send_lock` recheck, `broadcast` still calls `send_json` and
    delivers one final post-expiry message to a connection whose JWT is
    no longer valid - a real auth leak, not just a cleanup miss.

    Setup pre-acquires the connection's `send_lock` so the test can
    deterministically interleave: start `broadcast`, let it block on
    `send_lock`, drop the connection from `_connections`, release the
    lock, and assert no send happened.
    """
    manager = ConnectionManager()
    fake = _FastFakeWS()
    _attach(manager, fake, UserRole.ADMIN.value)
    conn = manager._connections[0]
    conn.send_lock = _ProbingLock()  # type: ignore[assignment]

    await conn.send_lock.acquire()

    broadcast_task = asyncio.create_task(
        manager.broadcast({"type": "device_status_change", "id": 1})
    )

    # Wait deterministically for broadcast to snapshot recipients and
    # park on `send_lock`. Without this, `_drop_websockets` could fire
    # before broadcast's snapshot and the test would pass without
    # exercising the recheck path at all.
    await asyncio.wait_for(conn.send_lock.acquire_blocked.wait(), timeout=1.0)

    # Simulate the revalidation sweep dropping the connection between
    # broadcast's recipient snapshot and its send_lock acquisition.
    await manager._drop_websockets([fake])

    conn.send_lock.release()
    await broadcast_task

    assert fake.received == [], (
        "broadcast sent to a connection that was dropped between recipient "
        "snapshot and send_lock acquisition; the in-send_lock membership "
        "recheck should have caught this"
    )


async def test_send_personal_rechecks_membership_under_send_lock():
    """`send_personal` must recheck `_connections` after acquiring `send_lock`.

    The race: `send_personal` looks up the `_Connection` under
    `manager._lock`, releases the lock, and then awaits `send_lock`. The
    revalidation sweep can drop this connection from `_connections`
    in that window. Without the in-`send_lock` recheck, `send_personal`
    proceeds to send one final pong/greeting to a connection that the
    sweep is about to (or already did) close.

    Setup pre-acquires `send_lock` so the test can deterministically
    interleave: start `send_personal`, let it block on `send_lock`,
    drop the connection from `_connections`, release the lock, and
    assert no send happened.
    """
    manager = ConnectionManager()
    fake = _FastFakeWS()
    _attach(manager, fake, UserRole.ADMIN.value)
    conn = manager._connections[0]
    conn.send_lock = _ProbingLock()  # type: ignore[assignment]

    await conn.send_lock.acquire()

    send_personal_task = asyncio.create_task(
        manager.send_personal({"type": "pong"}, fake)
    )

    # Wait deterministically for send_personal to park on `send_lock`.
    # Without this, `_drop_websockets` could fire before send_personal's
    # lookup completes and the test would pass without exercising the
    # recheck path.
    await asyncio.wait_for(conn.send_lock.acquire_blocked.wait(), timeout=1.0)

    # Simulate the revalidation sweep dropping the connection between
    # send_personal's lookup and its send_lock acquisition.
    await manager._drop_websockets([fake])

    conn.send_lock.release()
    await send_personal_task

    assert fake.received == [], (
        "send_personal sent to a connection that was dropped between "
        "lookup and send_lock acquisition; the in-send_lock membership "
        "recheck should have caught this"
    )


async def test_send_personal_skips_unmanaged_websocket():
    """`send_personal` must not bypass `send_lock` for unmanaged sockets.

    `_revalidate_once` drops a victim from `_connections` BEFORE acquiring
    its `send_lock` to close it. If a `ping` arrives in that window,
    `websocket_endpoint` calls `send_personal({"type": "pong"}, ws)`. A
    pre-fix `send_personal` looked up the `_Connection`, saw `None`, and
    fell back to a direct `await websocket.send_json(...)` with no
    `send_lock`. That race-d the sweep's in-flight `close()` on the same
    ASGI send channel.

    The contract: when no `_Connection` is registered for the websocket,
    `send_personal` must NOT send. The pong is dropped (the socket is
    being closed anyway).
    """
    manager = ConnectionManager()
    fake = _FastFakeWS()

    # Never attached, mirroring a socket that's been removed from
    # _connections by the revalidation sweep.
    await manager.send_personal({"type": "pong"}, fake)

    assert fake.received == [], (
        "send_personal sent to an unmanaged websocket; this race-s the "
        "revalidation sweep's close() because the send bypasses send_lock"
    )


async def test_non_serializable_payload_does_not_disconnect_recipients():
    """A non-serializable payload must surface as `TypeError`, not a peer drop.

    Pre-fix `except Exception` around `send_json` conflated two unrelated
    failure modes: Starlette's `json.dumps` raising `TypeError` on a
    server-side payload bug (e.g. a stray `datetime` or custom object),
    and Starlette's `RuntimeError` after the peer closed. The first must
    propagate so the bug surfaces; the second is a legitimate disconnect
    signal. Misclassifying the first would prune every healthy recipient
    of the broadcast on a single bad call.

    Pre-validating with `json.dumps` upfront makes `TypeError` raise
    before any per-recipient lock or send is touched, so connection
    state stays untouched on a payload bug.
    """

    class _NotSerializable:
        pass

    manager = ConnectionManager()
    healthy = _FastFakeWS()
    _attach(manager, healthy, UserRole.ADMIN.value)

    bad_payload = {
        "type": "device_status_change",
        "blob": _NotSerializable(),
    }

    with pytest.raises(TypeError):
        await manager.broadcast(bad_payload)

    assert manager.connection_count == 1, (
        "broadcast disconnected a healthy recipient on a payload bug; "
        "TypeError from json.dumps must propagate, not be swallowed as "
        "a peer drop"
    )
    assert manager.active_connections == [healthy]
    assert healthy.received == []

    with pytest.raises(TypeError):
        await manager.send_personal(bad_payload, healthy)

    assert manager.connection_count == 1, (
        "send_personal disconnected a healthy socket on a payload bug"
    )
    assert healthy.received == []


async def test_concurrent_broadcast_delivers_to_free_recipients():
    """A second broadcast must deliver to free recipients while the first is pinned.

    The user-observable guarantee: a single hung client doesn't block
    broadcasts to every other client. Pre-fix, a second `broadcast()`
    cannot even acquire `_lock` while the first is mid-`send_json`, so
    every connected client waits for the slowest one.

    Iteration order matters here. With `_connections == [fast, blocking]`
    a broadcast hits `fast` first (immediate) before pinning on `blocking`.
    So if a second broadcast starts while the first is pinned, the fix
    lets it get past its own snapshot and deliver to `fast` immediately.
    The bug holds the lock and prevents broadcast 2 from even starting.
    """
    manager = ConnectionManager()
    fast = _FastFakeWS()
    blocking = _BlockingFakeWS()
    _attach(manager, fast, UserRole.ADMIN.value)
    _attach(manager, blocking, UserRole.ADMIN.value)

    first = asyncio.create_task(
        manager.broadcast({"type": "device_status_change", "n": 1})
    )
    second: asyncio.Task[None] | None = None
    try:
        await asyncio.wait_for(blocking.send_started.wait(), timeout=1.0)
        assert fast.received == [{"type": "device_status_change", "n": 1}], (
            "first broadcast must reach fast before pinning on blocking"
        )

        second = asyncio.create_task(
            manager.broadcast({"type": "device_status_change", "n": 2})
        )

        async def _wait_for_second_delivery() -> None:
            while len(fast.received) < 2:
                await asyncio.sleep(0.005)

        try:
            await asyncio.wait_for(_wait_for_second_delivery(), timeout=0.25)
        except asyncio.TimeoutError:  # pragma: no cover - failure path
            pytest.fail(
                "second broadcast() could not deliver to a free recipient "
                "while first was pinned - lock-during-await stalls the lane"
            )

        assert fast.received[-1] == {"type": "device_status_change", "n": 2}
    finally:
        blocking.release.set()
        await first
        if second is not None:
            await second


async def test_failing_send_prunes_by_identity():
    """A connection whose `send_json` raises is removed from the manager.

    The fix routes failing sends through identity-keyed pruning so that a
    concurrent disconnect or reconnect cannot accidentally remove the
    wrong entry. The behavioral guarantee tests can rely on: post-broadcast,
    the failed websocket is no longer reachable from `connection_count` or
    `active_connections`, and the broadcast itself does not raise.
    """
    manager = ConnectionManager()
    raising = _RaisingFakeWS()
    healthy = _FastFakeWS()
    _attach(manager, raising, UserRole.ADMIN.value)
    _attach(manager, healthy, UserRole.ADMIN.value)

    await manager.broadcast({"type": "device_status_change", "id": 1})

    assert raising.send_called, "broadcast must attempt the send before pruning"
    assert manager.connection_count == 1
    assert manager.active_connections == [healthy]
    assert healthy.received == [{"type": "device_status_change", "id": 1}]


async def test_pruning_uses_identity_not_equality():
    """Pruning must key on `id(websocket)`, never on `==`.

    A future fake (or a real Starlette WebSocket subclass) could compare
    equal to another instance even when they are distinct sockets. The
    sweep already prunes by `id()`; broadcast must do the same so the
    two cleanup paths cannot disagree about which connection to drop.
    """

    class _AlwaysEqualWS:
        def __init__(self, raises: bool) -> None:
            self.raises = raises
            self.received: list[dict[str, Any]] = []

        @property
        def application_state(self) -> WebSocketState:
            return WebSocketState.CONNECTED

        async def send_json(self, message: dict[str, Any]) -> None:
            if self.raises:
                raise RuntimeError("dead peer")
            self.received.append(message)

        def __eq__(self, other: object) -> bool:
            return isinstance(other, _AlwaysEqualWS)

        def __hash__(self) -> int:
            return 0

    manager = ConnectionManager()
    dead = _AlwaysEqualWS(raises=True)
    alive = _AlwaysEqualWS(raises=False)
    _attach(manager, dead, UserRole.ADMIN.value)
    _attach(manager, alive, UserRole.ADMIN.value)

    await manager.broadcast({"type": "device_status_change", "id": 7})

    assert manager.connection_count == 1
    assert manager.active_connections[0] is alive
    assert alive.received == [{"type": "device_status_change", "id": 7}]


async def test_concurrent_sends_to_same_connection_are_serialized():
    """Two concurrent broadcasts to the same client must not interleave sends.

    Pre-fix-B, two `broadcast()` calls could enter `send_json` on the same
    `_Connection` concurrently. Starlette/ASGI WebSockets are not safe for
    that: writes to the underlying send channel can interleave frame data.
    The per-connection `send_lock` on `_Connection` is what prevents it.

    We track in-flight `send_json` calls per WS. The fake yields the event
    loop mid-send so a competing coroutine has a real chance to interleave.
    With the per-connection lock, max-in-flight stays at 1 for a given WS.
    """

    class _OrderedFakeWS:
        def __init__(self) -> None:
            self.in_flight = 0
            self.max_in_flight = 0
            self.received: list[dict[str, Any]] = []

        @property
        def application_state(self) -> WebSocketState:
            return WebSocketState.CONNECTED

        async def send_json(self, message: dict[str, Any]) -> None:
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            # Yield the event loop so a competing coroutine has a real
            # chance to enter send_json before this one returns. Without
            # this yield the test passes against a still-broken impl.
            await asyncio.sleep(0)
            self.received.append(message)
            self.in_flight -= 1

    manager = ConnectionManager()
    ws = _OrderedFakeWS()
    _attach(manager, ws, UserRole.ADMIN.value)

    await asyncio.gather(
        manager.broadcast({"type": "device_status_change", "n": 1}),
        manager.broadcast({"type": "device_status_change", "n": 2}),
        manager.broadcast({"type": "device_status_change", "n": 3}),
    )

    assert ws.max_in_flight == 1, (
        f"concurrent sends to the same WebSocket must be serialized via "
        f"the per-connection send_lock; max_in_flight={ws.max_in_flight}"
    )
    assert len(ws.received) == 3


async def test_send_personal_serializes_against_concurrent_broadcast():
    """A `send_personal` call must not interleave frames with a broadcast.

    Both call sites end up in `send_json` on the same WebSocket. The
    per-connection `send_lock` is the only thing that prevents the
    underlying ASGI send channel from racing.
    """

    class _OrderedFakeWS:
        def __init__(self) -> None:
            self.in_flight = 0
            self.max_in_flight = 0
            self.received: list[dict[str, Any]] = []

        @property
        def application_state(self) -> WebSocketState:
            return WebSocketState.CONNECTED

        async def send_json(self, message: dict[str, Any]) -> None:
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            await asyncio.sleep(0)
            self.received.append(message)
            self.in_flight -= 1

    manager = ConnectionManager()
    ws = _OrderedFakeWS()
    _attach(manager, ws, UserRole.ADMIN.value)

    await asyncio.gather(
        manager.broadcast({"type": "device_status_change", "via": "broadcast"}),
        manager.send_personal({"type": "pong", "via": "personal"}, ws),
    )

    assert ws.max_in_flight == 1, (
        "send_personal and broadcast must serialize via the per-connection "
        "send_lock"
    )
    assert len(ws.received) == 2


async def test_broadcast_during_slow_send_does_not_block_revalidation_sweep():
    """The revalidation sweep must not get stuck behind a slow broadcast.

    The sweep takes `manager._lock` to snapshot connections and again to
    prune victims. Pre-fix, broadcast holds that lock across `send_json`,
    so a single hung peer freezes auth re-validation for every other
    connected user, not just the slow one.

    We don't need to drive `_revalidate_once` itself here; the lock is
    the entire surface. If acquiring `manager._lock` from outside the
    broadcast completes within a tight bound while broadcast is mid-send,
    the sweep is also fine.
    """
    manager = ConnectionManager()
    blocking = _BlockingFakeWS()
    _attach(manager, blocking, UserRole.ADMIN.value)

    broadcast_task = asyncio.create_task(
        manager.broadcast({"type": "device_status_change"})
    )
    try:
        await asyncio.wait_for(blocking.send_started.wait(), timeout=1.0)

        async def _take_lock() -> None:
            async with manager._lock:
                pass

        try:
            await asyncio.wait_for(_take_lock(), timeout=0.25)
        except asyncio.TimeoutError:  # pragma: no cover - failure path
            pytest.fail(
                "manager._lock was held during broadcast send_json await; "
                "revalidation sweep would be stalled by a slow client"
            )
    finally:
        blocking.release.set()
        await broadcast_task


async def test_broadcast_skips_stuck_recipient_within_timeout(monkeypatch):
    """A `send_json` that never returns must not block delivery to others.

    The fix (#24) wraps `send_json` in `asyncio.wait_for` at
    `_SEND_TIMEOUT_SECONDS`. We patch the constant down to 0.1s so the
    timeout fires fast, register one stuck and one healthy recipient,
    and assert:

      1. broadcast completes within roughly the timeout window (not
         hanging forever behind the stuck peer);
      2. the healthy recipient still received the message;
      3. the stuck recipient is dropped from `_connections` by the
         timeout-triggered prune path.

    Iteration order matters: the stuck peer must be visited first so
    a pre-fix impl would hang before reaching the healthy one.
    """
    monkeypatch.setattr(ws_module, "_SEND_TIMEOUT_SECONDS", 0.1)

    manager = ConnectionManager()
    blocking = _BlockingFakeWS()
    healthy = _FastFakeWS()
    _attach(manager, blocking, UserRole.ADMIN.value)
    _attach(manager, healthy, UserRole.ADMIN.value)

    message = {"type": "device_status_change", "id": 1}
    try:
        # Generous upper bound: the timeout is 0.1s, healthy send is
        # immediate, so 1.0s leaves room for scheduler jitter while
        # still catching an unbounded hang.
        await asyncio.wait_for(manager.broadcast(message), timeout=1.0)
    except asyncio.TimeoutError:  # pragma: no cover - failure path
        pytest.fail(
            "broadcast did not return within the timeout window; "
            "stuck recipient is holding send_lock unbounded"
        )
    finally:
        blocking.release.set()

    assert healthy.received == [message], (
        "broadcast must still deliver to healthy recipients while pruning "
        "the stuck one"
    )
    assert manager.connection_count == 1
    assert manager.active_connections == [healthy], (
        "stuck recipient must be dropped from _connections after the "
        "send_json timeout fires"
    )


async def test_broadcast_timeout_releases_send_lock_for_followups(monkeypatch):
    """After a recipient times out, its `send_lock` must be released.

    If broadcast's timeout-path bailed without releasing the lock, a
    subsequent `send_personal` (e.g. a pong) on the same connection
    would block forever on `send_lock.acquire`. We construct that
    sequence and assert the second send completes promptly.

    The stuck connection itself has been pruned by the first broadcast,
    so the second send returns silently (no `_Connection` registered).
    The test guards against the regression where `acquire()` succeeded
    but the timeout escape skipped `release()`.
    """
    monkeypatch.setattr(ws_module, "_SEND_TIMEOUT_SECONDS", 0.1)

    manager = ConnectionManager()
    blocking = _BlockingFakeWS()
    _attach(manager, blocking, UserRole.ADMIN.value)
    conn = manager._connections[0]

    try:
        await asyncio.wait_for(
            manager.broadcast({"type": "device_status_change"}),
            timeout=1.0,
        )
    finally:
        blocking.release.set()

    # After timeout-prune the connection's send_lock should be free.
    assert not conn.send_lock.locked(), (
        "broadcast leaked send_lock on timeout-prune path; subsequent "
        "operations on this connection would deadlock"
    )
