"""Integration tests for app.ratelimit against a real Redis instance.

The unit suite uses fakeredis[lua], which runs Lua via lupa rather than
Redis's actual Lua sandbox. These tests re-validate the security-critical
primitives against a real Redis to catch any divergence (number/string
coercion, KEYS/ARGV semantics, atomicity guarantees) before it reaches
production.

Skipped automatically when REDIS_URL is unset.
"""

from __future__ import annotations

import asyncio
import time

import pytest

pytestmark = pytest.mark.integration


async def test_concurrent_claims_only_one_wins(wired_real_redis, integration_prefix):
    """Real Lua claim-first: under contention exactly one claim returns a token."""
    from app.ratelimit import claim_cooldown

    key = f"{integration_prefix}cd:concurrent"
    results = await asyncio.gather(
        *[claim_cooldown(key, cooldown_seconds=60) for _ in range(8)]
    )
    winners = [t for t in results if t]
    assert len(winners) == 1, f"expected exactly one winner, got {len(winners)}: {results}"


async def test_release_cooldown_with_wrong_token_does_not_clobber(
    wired_real_redis, integration_prefix
):
    """Token-based CAS in real Lua: a wrong-token release must be a no-op.

    The function intentionally returns None on both success and no-op, so we
    assert behavior via downstream claim_cooldown calls instead of the return
    value: a stale release should leave the lock intact, and only the correct
    token should free it for the next claimant.
    """
    from app.ratelimit import claim_cooldown, release_cooldown

    key = f"{integration_prefix}cd:cas"
    token = await claim_cooldown(key, cooldown_seconds=60)
    assert token

    # Stale or forged release must not delete the lock.
    await release_cooldown(key, "not-the-token")
    second = await claim_cooldown(key, cooldown_seconds=60)
    assert second is None, "lock must still be held after a forged release"

    # The legitimate owner can release.
    await release_cooldown(key, token)
    third = await claim_cooldown(key, cooldown_seconds=60)
    assert third, "legitimate release should free the lock for the next claim"


async def test_cooldown_persists_across_client_reconnect(
    wired_real_redis, integration_prefix
):
    """A claim must survive the caller's client closing and reconnecting.

    Validates that cooldown lives in Redis state, not in the client object.
    """
    import os

    import redis.asyncio as aioredis

    from app.cache import redis_cache
    from app.ratelimit import claim_cooldown

    key = f"{integration_prefix}cd:persist"
    token = await claim_cooldown(key, cooldown_seconds=60)
    assert token

    original = redis_cache._client
    await original.aclose()

    fresh = aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    redis_cache._client = fresh
    try:
        second = await claim_cooldown(key, cooldown_seconds=60)
        assert second is None, "lock must persist across client reconnect"
    finally:
        await fresh.aclose()
        # Restore (closed) original; outer fixture wires its own client back.
        redis_cache._client = original


async def test_cooldown_rereads_current_seconds(wired_real_redis, integration_prefix):
    """The Lua compares stored ts against the *current* cooldown_seconds.

    We exercise the Redis path (not the Python early-return for cooldown<=0)
    by claiming with a positive cooldown, then directly aging the stored ts
    via SET so it appears 100s old, then issuing a claim with cooldown=10.
    The Lua must see (now - stored) > cooldown_seconds and grant the new
    claim. This catches a regression where cooldown was treated as the
    write-time value rather than the call-time value.
    """
    from app.ratelimit import claim_cooldown

    key = f"{integration_prefix}cd:reread"

    first = await claim_cooldown(key, cooldown_seconds=60)
    assert first

    # Age the stored timestamp to 100s in the past.
    aged_ts = f"{time.time() - 100:.6f}"
    await wired_real_redis.set(key, aged_ts, ex=3600)

    # New claim with a 10s cooldown must succeed because (now - aged_ts) = 100 > 10.
    second = await claim_cooldown(key, cooldown_seconds=10)
    assert second, "Lua must re-evaluate cooldown_seconds against the stored ts"

    # And immediately after, a fresh claim within the new 10s window is blocked.
    third = await claim_cooldown(key, cooldown_seconds=10)
    assert third is None, "fresh claim must be locked out by the newly written ts"
