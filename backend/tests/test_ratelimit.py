"""Tests for app.ratelimit primitives.

Covers:
- Sliding-window allow/deny with both fakeredis and the per-worker fallback.
- claim_cooldown returning a CAS token, rejecting fresh duplicate claims.
- release_cooldown not clobbering a newer claim (token mismatch is a no-op).
- Cooldown re-evaluation when cooldown_seconds is lowered between checks
  (the Lua compares stored ts against the *current* config).
"""

from __future__ import annotations

import asyncio
import time


async def test_sliding_window_allows_under_limit(wired_redis_cache):
    from app.ratelimit import sliding_window_check

    for i in range(3):
        allowed, count = await sliding_window_check("test:rl:a", limit=5, window_seconds=60)
        assert allowed, f"hit {i} should be allowed under limit"
        assert count == i + 1


async def test_sliding_window_denies_over_limit(wired_redis_cache):
    from app.ratelimit import sliding_window_check

    for _ in range(5):
        ok, _ = await sliding_window_check("test:rl:b", limit=5, window_seconds=60)
        assert ok
    blocked, count = await sliding_window_check("test:rl:b", limit=5, window_seconds=60)
    assert not blocked
    assert count == 5


async def test_sliding_window_local_fallback_when_redis_down(disconnected_redis_cache):
    """A Redis outage MUST NOT silently allow unlimited login attempts."""
    from app.ratelimit import sliding_window_check

    for i in range(3):
        ok, _ = await sliding_window_check("test:rl:fb", limit=3, window_seconds=60)
        assert ok, f"local fallback hit {i} should be allowed"
    blocked, _ = await sliding_window_check("test:rl:fb", limit=3, window_seconds=60)
    assert not blocked, "local fallback must enforce the same limit when Redis is down"


async def test_claim_cooldown_returns_token_then_blocks_duplicate(wired_redis_cache):
    from app.ratelimit import claim_cooldown

    token = await claim_cooldown("test:cd:a", cooldown_seconds=60)
    assert token, "first claim must succeed"

    second = await claim_cooldown("test:cd:a", cooldown_seconds=60)
    assert second is None, "duplicate claim within cooldown must return None"


async def test_claim_cooldown_zero_seconds_is_no_op(wired_redis_cache):
    from app.ratelimit import claim_cooldown

    a = await claim_cooldown("test:cd:zero", cooldown_seconds=0)
    b = await claim_cooldown("test:cd:zero", cooldown_seconds=0)
    assert a and b, "cooldown_seconds<=0 means no real lock; both should succeed"


async def test_claim_cooldown_rereads_current_config(wired_redis_cache):
    """The Lua must compare stored ts against the *current* cooldown_seconds.

    We exercise the Lua path (not the Python early-return for cooldown<=0) by
    claiming with a positive cooldown, then directly aging the stored ts via
    SET so it appears 100s old, then issuing a claim with cooldown=10. The Lua
    must see (now - stored) > cooldown_seconds and grant the new claim. This
    catches regressions where cooldown is treated as the write-time value
    rather than the call-time value.
    """
    from app.ratelimit import claim_cooldown

    key = "test:cd:reread"

    first = await claim_cooldown(key, cooldown_seconds=60)
    assert first

    # Age the stored timestamp to 100s in the past via the underlying client,
    # bypassing the Python wrapper so the Lua sees a real prior claim.
    aged_ts = f"{time.time() - 100:.6f}"
    await wired_redis_cache.set(key, aged_ts, ex=3600)

    # New claim with a 10s cooldown must succeed because (now - aged_ts) = 100 > 10.
    second = await claim_cooldown(key, cooldown_seconds=10)
    assert second, "Lua must re-evaluate cooldown_seconds against the stored ts"

    # And a fresh claim within the new 10s window is immediately blocked.
    third = await claim_cooldown(key, cooldown_seconds=10)
    assert third is None, "fresh claim must be locked out by the newly written ts"


async def test_release_cooldown_with_correct_token_clears_lock(wired_redis_cache):
    from app.ratelimit import claim_cooldown, release_cooldown

    token = await claim_cooldown("test:cd:rel", cooldown_seconds=60)
    assert token

    await release_cooldown("test:cd:rel", token)

    # After release, a new claim must succeed.
    new = await claim_cooldown("test:cd:rel", cooldown_seconds=60)
    assert new, "release should free the cooldown for the next claim"


async def test_release_cooldown_with_wrong_token_does_not_clobber(wired_redis_cache):
    """A delayed releaser MUST NOT clobber a newer claim from another worker."""
    from app.ratelimit import claim_cooldown, release_cooldown

    token1 = await claim_cooldown("test:cd:cas", cooldown_seconds=60)
    assert token1

    # Worker A's release arrives late. Stale token must not delete the key.
    await release_cooldown("test:cd:cas", "0.0")  # bogus token

    # The original cooldown must still be in effect.
    blocked = await claim_cooldown("test:cd:cas", cooldown_seconds=60)
    assert blocked is None, "stale release must not free the active cooldown"


async def test_local_fallback_cooldown_token_release(disconnected_redis_cache):
    """In-process fallback must also enforce CAS on release_cooldown."""
    from app.ratelimit import claim_cooldown, release_cooldown

    token = await claim_cooldown("test:cd:fb", cooldown_seconds=60)
    assert token

    await release_cooldown("test:cd:fb", "0.0")  # wrong token, must no-op
    blocked = await claim_cooldown("test:cd:fb", cooldown_seconds=60)
    assert blocked is None

    await release_cooldown("test:cd:fb", token)  # correct token
    fresh = await claim_cooldown("test:cd:fb", cooldown_seconds=60)
    assert fresh, "correct-token release should free the local cooldown"


async def test_concurrent_claims_only_one_wins(wired_redis_cache):
    """Atomic claim must serialize across concurrent callers (no double-fire)."""
    from app.ratelimit import claim_cooldown

    results = await asyncio.gather(
        *(claim_cooldown("test:cd:race", cooldown_seconds=60) for _ in range(20))
    )
    winners = [t for t in results if t is not None]
    assert len(winners) == 1, f"expected exactly 1 winner, got {len(winners)}"
