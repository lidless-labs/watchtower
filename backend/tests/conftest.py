"""Shared test fixtures for the backend test suite."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def fakeredis_client():
    """Async fakeredis client wired to the same Lua semantics ratelimit uses.

    fakeredis without the [lua] extra silently raises ResponseError on EVAL,
    which then trips the ratelimit module's `except` block and routes the
    test through the in-process FALLBACK path. That makes the test pass
    while bypassing the security primitive under test. Importing lupa here
    is the cheapest way to make a missing extra fail loudly at fixture
    setup instead of silently.
    """
    import fakeredis  # required test dep; do not importorskip
    import lupa  # noqa: F401  # presence proves fakeredis[lua] is installed

    return fakeredis.FakeAsyncRedis(decode_responses=True)


@pytest.fixture
async def wired_redis_cache(fakeredis_client):
    """Bind redis_cache to a fakeredis client for the duration of the test.

    Restores the original client (if any) on teardown so tests do not leak
    state across modules.
    """
    from app.cache import redis_cache

    original = getattr(redis_cache, "_client", None)
    redis_cache._client = fakeredis_client
    try:
        yield fakeredis_client
    finally:
        redis_cache._client = original


@pytest.fixture
def disconnected_redis_cache():
    """Force redis_cache to behave as if Redis were unreachable.

    The rate-limit primitives catch RuntimeError from `.client` and fall back
    to per-worker in-process state, which is what we want to exercise here.
    """
    from app.cache import redis_cache

    original = getattr(redis_cache, "_client", None)
    redis_cache._client = None
    try:
        yield
    finally:
        redis_cache._client = original


@pytest.fixture(autouse=True)
def _reset_local_ratelimit_state():
    """Clear ratelimit module fallback state between tests.

    The module keeps `_LOCAL_WINDOWS` and `_LOCAL_COOLDOWNS` dicts at module
    scope. Cross-test leakage produces false-positive rate-limit hits when
    tests share keys.
    """
    try:
        from app import ratelimit
    except ImportError:
        yield
        return
    ratelimit._LOCAL_WINDOWS.clear()
    ratelimit._LOCAL_COOLDOWNS.clear()
    yield
    ratelimit._LOCAL_WINDOWS.clear()
    ratelimit._LOCAL_COOLDOWNS.clear()


@pytest.fixture(autouse=True)
def _restore_config_singleton():
    """Snapshot and restore the config singleton around each test.

    Tests freely mutate `config.auth.*` to exercise login/JWT/cooldown logic.
    Without restoration, leaks like a custom jwt_secret or empty
    admin_password_hash become order-dependent landmines for later tests.
    """
    try:
        from app import config as config_module
    except ImportError:
        yield
        return
    snapshot = config_module.config.model_dump()
    yield
    restored = type(config_module.config)(**snapshot)
    for field_name in type(config_module.config).model_fields:
        setattr(config_module.config, field_name, getattr(restored, field_name))
