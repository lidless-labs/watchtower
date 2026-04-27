"""Redis-backed rate limiting and cooldown primitives.

Replaces per-process in-memory counters so limits hold across uvicorn workers
and survive process restarts. When Redis is unavailable, falls back to a
per-worker in-process limiter so a Redis outage cannot fully disable login
throttling or notification storm controls.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections import deque

from .cache import redis_cache

logger = logging.getLogger(__name__)


# Atomic sliding-window check via a single EVAL.
# KEYS[1]  = sorted-set key
# ARGV[1]  = now (epoch seconds, float)
# ARGV[2]  = cutoff (now - window)
# ARGV[3]  = limit
# ARGV[4]  = ttl (seconds, integer)
# ARGV[5]  = unique member id
# Returns {allowed (1|0), count_after}.
_SLIDING_WINDOW_LUA = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[2])
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  return {0, count}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[5])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return {1, count + 1}
"""


# Atomic claim_cooldown: compares stored timestamp against the *current* configured
# cooldown so config changes (e.g. lowering cooldown_minutes) take effect immediately.
# KEYS[1] = key
# ARGV[1] = now (float seconds)
# ARGV[2] = cooldown_seconds (current config)
# ARGV[3] = ceiling_ttl (long ceiling so abandoned keys eventually expire)
# Returns 1 if claimed (caller proceeds), 0 if still cooling.
_CLAIM_COOLDOWN_LUA = """
local existing = redis.call('GET', KEYS[1])
if existing then
  local age = tonumber(ARGV[1]) - tonumber(existing)
  if age < tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
"""


# In-process fallback state (per worker). Used only when Redis errors out so a
# Redis outage cannot fully unprotect the dashboard.
_LOCAL_WINDOWS: dict[str, deque[float]] = {}
_LOCAL_COOLDOWNS: dict[str, float] = {}
_LOCAL_LOCK = asyncio.Lock()


_LOCAL_MAX_KEYS = 10_000  # Cap unbounded growth during a Redis outage.
# Generous retention so a later config raise from minutes to "lots of hours/days"
# still sees the original timestamp. 30d covers every sane NOC cooldown.
_LOCAL_COOLDOWN_RETENTION = 30 * 24 * 3600


def _purge_local(now: float) -> None:
    """Drop empty buckets and stale cooldowns. Caller must hold _LOCAL_LOCK."""
    if _LOCAL_WINDOWS:
        empty = [k for k, b in _LOCAL_WINDOWS.items() if not b]
        for k in empty:
            del _LOCAL_WINDOWS[k]
    if _LOCAL_COOLDOWNS:
        cutoff = now - _LOCAL_COOLDOWN_RETENTION
        stale = [k for k, ts in _LOCAL_COOLDOWNS.items() if ts < cutoff]
        for k in stale:
            del _LOCAL_COOLDOWNS[k]
    # Hard cap to prevent unbounded growth from unique-key floods (e.g. spoofed IPs).
    if len(_LOCAL_WINDOWS) > _LOCAL_MAX_KEYS:
        for k in list(_LOCAL_WINDOWS)[: len(_LOCAL_WINDOWS) - _LOCAL_MAX_KEYS]:
            del _LOCAL_WINDOWS[k]
    if len(_LOCAL_COOLDOWNS) > _LOCAL_MAX_KEYS:
        # Evict oldest first.
        ordered = sorted(_LOCAL_COOLDOWNS.items(), key=lambda kv: kv[1])
        for k, _ in ordered[: len(_LOCAL_COOLDOWNS) - _LOCAL_MAX_KEYS]:
            del _LOCAL_COOLDOWNS[k]


async def _local_sliding_window(key: str, limit: int, window: int) -> tuple[bool, int]:
    """Per-worker fallback used when Redis is unreachable."""
    now = time.time()
    cutoff = now - window
    async with _LOCAL_LOCK:
        bucket = _LOCAL_WINDOWS.setdefault(key, deque())
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            _purge_local(now)
            return False, len(bucket)
        bucket.append(now)
        _purge_local(now)
        return True, len(bucket)


async def _local_claim_cooldown(key: str, cooldown_seconds: int, token: str) -> bool:
    """Per-worker fallback used when Redis is unreachable.

    The caller's token (a `f"{ts:.6f}"` string) is stored as the claim value so
    release_cooldown() can do a CAS-style delete.
    """
    if cooldown_seconds <= 0:
        return True
    now = time.time()
    async with _LOCAL_LOCK:
        last = _LOCAL_COOLDOWNS.get(key)
        if last is not None and (now - last) < cooldown_seconds:
            return False
        # Store the token's float for CAS comparison on release.
        _LOCAL_COOLDOWNS[key] = float(token)
        _purge_local(now)
        return True


async def sliding_window_check(
    key: str,
    limit: int,
    window_seconds: int,
) -> tuple[bool, int]:
    """Check and record a hit against a sliding-window rate limit.

    Returns (allowed, count_after_record). On Redis failure, falls back to a
    per-worker in-process bucket so a Redis outage cannot fully disable
    throttling.
    """
    if limit <= 0 or window_seconds <= 0:
        return True, 0

    try:
        client = redis_cache.client
    except RuntimeError:
        return await _local_sliding_window(key, limit, window_seconds)

    now = time.time()
    cutoff = now - window_seconds
    member = f"{now:.6f}:{secrets.token_hex(4)}"
    ttl = window_seconds + 1

    try:
        result = await client.eval(
            _SLIDING_WINDOW_LUA,
            1,
            key,
            f"{now:.6f}",
            f"{cutoff:.6f}",
            str(limit),
            str(ttl),
            member,
        )
        return bool(int(result[0])), int(result[1])
    except Exception as exc:
        logger.warning(
            "sliding_window_check Redis failure for %s; using local fallback: %s",
            key,
            exc,
        )
        return await _local_sliding_window(key, limit, window_seconds)


# CAS release: only delete if the token (claim timestamp) still owns the key.
# Prevents a delayed releaser from clobbering a fresh claim by another worker.
_RELEASE_COOLDOWN_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


async def release_cooldown(key: str, token: str) -> None:
    """Release a cooldown previously claimed by `token` (the value returned by claim_cooldown).

    Used when a follow-up gate (rate limit, validation) rejects the dispatch
    after the cooldown was atomically claimed, so the alert/channel is not
    suppressed for a notification that never sent. The token is checked
    compare-and-delete style so a delayed release cannot clobber a newer claim.
    """
    if not token:
        return
    try:
        client = redis_cache.client
    except RuntimeError:
        async with _LOCAL_LOCK:
            current = _LOCAL_COOLDOWNS.get(key)
            if current is not None and f"{current:.6f}" == token:
                _LOCAL_COOLDOWNS.pop(key, None)
        return
    try:
        await client.eval(_RELEASE_COOLDOWN_LUA, 1, key, token)
    except Exception as exc:
        logger.warning("release_cooldown Redis failure for %s: %s", key, exc)
    async with _LOCAL_LOCK:
        current = _LOCAL_COOLDOWNS.get(key)
        if current is not None and f"{current:.6f}" == token:
            _LOCAL_COOLDOWNS.pop(key, None)


async def peek_cooldown(key: str, cooldown_seconds: int) -> bool:
    """Return True if a cooldown lock is currently active for key.

    Read-only: does not record or refresh the timestamp. Use this to
    short-circuit work that should not count against any other quota when the
    request would be cooldown-suppressed anyway.
    """
    if cooldown_seconds <= 0:
        return False

    try:
        client = redis_cache.client
    except RuntimeError:
        async with _LOCAL_LOCK:
            last = _LOCAL_COOLDOWNS.get(key)
            return last is not None and (time.time() - last) < cooldown_seconds

    try:
        existing = await client.get(key)
    except Exception as exc:
        logger.warning("peek_cooldown Redis failure for %s; using local: %s", key, exc)
        async with _LOCAL_LOCK:
            last = _LOCAL_COOLDOWNS.get(key)
            return last is not None and (time.time() - last) < cooldown_seconds

    if not existing:
        return False
    try:
        return (time.time() - float(existing)) < cooldown_seconds
    except (TypeError, ValueError):
        return False


async def claim_cooldown(key: str, cooldown_seconds: int) -> str | None:
    """Atomically claim a cooldown lock.

    Returns a token string (the claim timestamp) on success, or None if a
    prior claim is still within the current cooldown window. Reads the stored
    send-timestamp and compares against the *current* cooldown_seconds, so
    lowering the cooldown in config takes effect immediately.

    The returned token must be passed to release_cooldown() to revoke the
    claim. On Redis failure, falls back to a per-worker in-process record.
    """
    if cooldown_seconds <= 0:
        return f"{time.time():.6f}"  # nominal token, no real lock taken

    now = time.time()
    token = f"{now:.6f}"

    try:
        client = redis_cache.client
    except RuntimeError:
        ok = await _local_claim_cooldown(key, cooldown_seconds, token)
        return token if ok else None

    # Generous ceiling (30d) so timestamps survive any reasonable
    # cooldown_minutes raise. Abandoned keys still expire eventually.
    ceiling_ttl = max(cooldown_seconds + 60, 30 * 24 * 3600)

    try:
        result = await client.eval(
            _CLAIM_COOLDOWN_LUA,
            1,
            key,
            token,
            str(cooldown_seconds),
            str(ceiling_ttl),
        )
        return token if bool(int(result)) else None
    except Exception as exc:
        logger.warning(
            "claim_cooldown Redis failure for %s; using local fallback: %s",
            key,
            exc,
        )
        ok = await _local_claim_cooldown(key, cooldown_seconds, token)
        return token if ok else None
