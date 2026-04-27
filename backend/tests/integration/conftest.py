"""Fixtures for tests that require a real Redis instance.

Tests under tests/integration/ are skipped when REDIS_URL is not set, so
running `pytest -q` locally without Redis still passes. CI sets
REDIS_URL=redis://localhost:6379/0 against a service container.
"""

from __future__ import annotations

import os
import uuid

import pytest


@pytest.fixture
def integration_prefix() -> str:
    """A per-test key prefix that callers should embed in every Redis key.

    We never call FLUSHDB so a misset REDIS_URL cannot wipe an unrelated
    Redis instance; teardown only deletes keys under this prefix.
    """
    return f"itest:{uuid.uuid4().hex[:12]}:"


@pytest.fixture
async def real_redis_client(integration_prefix):
    """Async redis.asyncio client wired to a real Redis at REDIS_URL.

    Auto-skips when REDIS_URL is unset. On teardown, SCAN/DEL only the keys
    matching this test's prefix; never FLUSHDB. Tests must build their keys
    by concatenating `integration_prefix + ...` so cleanup actually finds
    them.
    """
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        pytest.skip("REDIS_URL not set; integration tests require a real Redis instance")

    import redis.asyncio as aioredis

    client = aioredis.from_url(redis_url, decode_responses=True)
    try:
        yield client
    finally:
        match = f"{integration_prefix}*"
        async for batch in _scan_iter(client, match):
            if batch:
                await client.delete(*batch)
        await client.aclose()


async def _scan_iter(client, match: str, count: int = 200):
    """Yield batches of keys matching `match` via SCAN."""
    cursor = 0
    while True:
        cursor, keys = await client.scan(cursor=cursor, match=match, count=count)
        if keys:
            yield keys
        if cursor == 0:
            return


@pytest.fixture
async def wired_real_redis(real_redis_client):
    """Bind redis_cache to a real Redis client for the duration of the test.

    Mirrors the unit-test wired_redis_cache fixture but against real Redis,
    so the same ratelimit primitives execute their EVAL/EVALSHA against the
    live Lua sandbox instead of fakeredis[lua]'s lupa interpreter.
    """
    from app.cache import redis_cache

    original = getattr(redis_cache, "_client", None)
    redis_cache._client = real_redis_client
    try:
        yield real_redis_client
    finally:
        redis_cache._client = original
