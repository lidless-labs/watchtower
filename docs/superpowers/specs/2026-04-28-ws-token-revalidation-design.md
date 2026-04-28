# WebSocket Token Re-validation Design

Date: 2026-04-28
Status: Approved (brainstorming complete)

## Problem

WebSocket connections authenticate once, at connect time, via `_authenticate_websocket` and `decode_token`. After the connection is accepted the receive loop runs indefinitely. A JWT that expires while the socket is open keeps receiving role-gated broadcasts until the client disconnects on its own. Same gap if `JWT_SECRET` rotates: existing sockets stay attached even though new connects with old tokens would be rejected.

## Goal

Mid-flight invalid tokens (expired, tampered, or signed with a stale secret) get their sockets closed within roughly 60 seconds, with the same close behavior as connect-time rejection: code 4001, no payload.

## Non-Goals

- **Role demotion without token rotation.** Alice's old `role: admin` token is cryptographically valid until `exp`. JWT statelessness means we can't catch this without a server-side revocation list, which is its own state surface.
- **Frontend reconnect-loop hardening.** The frontend reconnects every 3 seconds on any close and reuses the same token from `useAuthStore` each time. After expiry the connect path will reject every reconnect. That is existing behavior; this change does not make it worse and the fix belongs in a separate frontend PR.
- **Revocation list / blocklist.** New persistent state. Out of scope.

## Architecture

A free function `revalidate_loop` lives in `backend/app/websocket.py`. The lifespan handler in `backend/app/main.py` starts one task with `asyncio.create_task(revalidate_loop(ws_manager))` and cancels it on shutdown.

Each tick takes a snapshot of `(websocket, token)` pairs under the manager's lock, runs `decode_token` on each entry outside the lock, builds a kill list, then closes and disconnects victims.

```
+-------------------+      every 60s      +------------------+
| revalidate_loop   | ------------------> | _revalidate_once |
+-------------------+                     +------------------+
                                                  |
                              snapshot under lock |
                                                  v
                                       +----------------------+
                                       | decode_token outside |
                                       | lock; build victims  |
                                       +----------------------+
                                                  |
                                                  v
                                       +----------------------+
                                       | for v in victims:    |
                                       |   ws.close(4001)     |
                                       |   manager.disconnect |
                                       +----------------------+
```

## State Changes

### `_Connection` dataclass gains a `token` field

```python
@dataclass
class _Connection:
    websocket: WebSocket
    role: str
    token: str
```

### `_authenticate_websocket` returns the raw token alongside the payload

Current return type: `dict[str, Any] | None`.
New return type: `tuple[dict[str, Any], str] | None`.

Both code paths (query-param token and first-message JSON body) already hold the raw token in scope; the function just stops discarding it.

### Two construction sites in `websocket.py` thread the token through

- `ConnectionManager.connect(websocket, role)` becomes `connect(websocket, role, token)`.
- The "already in CONNECTED state" branch inside `websocket_endpoint` that appends a `_Connection` directly takes the same change. The token is already in scope from `_authenticate_websocket`.

### No external callers

`_Connection`, `connect`, and `_authenticate_websocket` are all internal to `websocket.py`. The exported surface (`ws_manager.broadcast`, `disconnect`, `connection_count`, `active_connections`) does not see `_Connection` internals and does not change.

### Memory cost

One additional string reference per connection. JWTs are roughly 200 to 300 bytes; at 1000 simultaneous connections that adds about 300 KB. Negligible.

## The Revalidation Sweep

```python
_REVALIDATION_INTERVAL_DEFAULT = 60.0
_EXPIRED_CLOSE_CODE = 4001  # match _close_unauthorized

async def revalidate_loop(
    manager: ConnectionManager,
    interval: float = _REVALIDATION_INTERVAL_DEFAULT,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    while True:
        try:
            await sleep(interval)
            await _revalidate_once(manager)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ws revalidate sweep failed; continuing")


async def _revalidate_once(manager: ConnectionManager) -> None:
    async with manager._lock:
        snapshot = [(c.websocket, c.token) for c in manager._connections]

    victims: list[WebSocket] = []
    for ws, token in snapshot:
        try:
            decode_token(token)
        except HTTPException:
            victims.append(ws)

    for ws in victims:
        try:
            await ws.close(code=_EXPIRED_CLOSE_CODE)
        except Exception:
            pass  # already-closed sockets raise; still want to remove
        await manager.disconnect(ws)
```

### Why this shape

- **Snapshot under lock, decode and I/O outside.** Decode is microseconds (HS256), but `await ws.close()` is real network I/O. Holding the lock across that would block every concurrent `broadcast`, `connect`, and `disconnect`. The victim list is by-identity, and `manager.disconnect` already filters by identity (`is`), so a connection that disappeared between snapshot and close becomes a no-op.
- **Catch-all in the outer loop.** A single decode bug or logger glitch must not silently kill the background task and leave the system without revalidation. `CancelledError` is re-raised so shutdown still works.
- **`_revalidate_once` is callable directly from unit tests.** No need to drive `sleep`.
- **Tolerates already-closed sockets.** If a peer disconnects between snapshot and close, `ws.close()` raises; the swallow continues to `manager.disconnect`, which is idempotent.

### Lifespan wiring

```python
# inside the existing lifespan in main.py
from contextlib import suppress

revalidate_task = asyncio.create_task(revalidate_loop(ws_manager))
try:
    yield
finally:
    revalidate_task.cancel()
    with suppress(asyncio.CancelledError):
        await revalidate_task
```

Awaiting the cancellation makes shutdown deterministic in tests.

## Testing

### Unit (`backend/tests/test_websocket_revalidation.py`)

Direct calls to `_revalidate_once`. No event-loop driving, no real WebSocket. A tiny fake stands in:

```python
class _FakeWS:
    def __init__(self): self.closed_with: int | None = None
    @property
    def application_state(self): return WebSocketState.CONNECTED
    async def close(self, code: int): self.closed_with = code
```

1. **Expired token closes and removes.** Mint two real JWTs via `jwt.encode`: one fresh (`exp = now + 3600`), one expired (`exp = now - 60`). Wire both into `manager._connections` directly. Call `_revalidate_once(manager)`. Assert the expired fake's `closed_with == 4001`, the fresh fake is untouched, and `manager.connection_count() == 1`.
2. **Tampered token closes.** Mint a token, mutate a byte of the signature, install. Assert closed.
3. **Fresh, valid role left alone.** Sanity check that valid sessions survive a sweep.
4. **Snapshot-then-close race is safe.** Pre-seed one expired connection, monkeypatch `ws.close` to clear `manager._connections` before raising. Assert no exception escapes, `manager.disconnect` is still called and is a no-op.
5. **Outer-loop catch-all keeps the task alive.** Inject a `_revalidate_once` that raises on the first call and succeeds on the second. Drive `revalidate_loop` with a fake `sleep` that yields twice and then raises `CancelledError`. Assert both calls fired and the loop did not die before cancellation.

### Integration (`backend/tests/integration/test_websocket_revalidation.py`)

Reuses the in-process uvicorn fixture from `tests/integration/conftest.py` (PR #19).

6. **Mid-flight expiry.** Mint a token with `exp = now + 2`. Connect via `websockets.connect()`. Start `revalidate_loop(ws_manager, interval=0.5)` on the test loop. Wait up to 5 seconds for the close frame. Assert the close code is 4001 (`ConnectionClosedError.code`); if the `websockets` library surfaces 1006 instead, pin to that and add a comment about the empirical behavior.
7. **Fresh token survives a sweep.** Same setup, `exp = now + 3600`. Run two `_revalidate_once` ticks. Assert the connection is still alive and can still receive a `manager.broadcast`.

### No fakeredis dependency

WebSocket revalidation does not touch Redis. The existing `wired_redis_cache` fixture is unrelated.

## Risks and Mitigations

- **Race: socket disconnects between snapshot and close.** `ws.close()` raises; swallowed. `manager.disconnect` is identity-filtered and idempotent.
- **Background task dies silently.** Outer-loop catch-all logs and continues. `CancelledError` re-raised so shutdown is clean.
- **Stale secret rotation does not catch existing sockets.** That is exactly the gap this design closes; `decode_token` will raise on signature mismatch under the new secret, the loop closes the socket on the next tick.
- **60-second worst-case slop.** With 8-hour sessions that is 0.2% of session lifetime. No config knob added; if anyone needs tuning, plumb it then.

## Out of Scope (restated for the spec)

- Frontend changes to `useWebSocket.ts` (separate PR).
- JWT revocation list.
- Role-demotion handling that requires server-side state.

## Acceptance

- All seven test cases pass.
- `pytest backend/tests/test_websocket_revalidation.py` and `pytest backend/tests/integration/test_websocket_revalidation.py` are green locally.
- CI Backend (lint, type-check, test) and Frontend (type-check, test) green on the PR.
- A connection with an expired token is observed closing within roughly `interval` seconds during manual verification.
