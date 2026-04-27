"""Tests for app.auth and app.routers.auth_router.

Covers:
- create_token / decode_token roundtrip and signature validation.
- Login flow happy path (after admin password is set).
- Bootstrap rate limit kicks in after the configured number of attempts.
- Rate limit on the regular login endpoint.
- Password change requires the correct old password.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient


def _make_client(app: FastAPI) -> AsyncClient:
    """Build an AsyncClient bound to a FastAPI app.

    Uses ASGITransport explicitly so this works on httpx 0.26 *and* 0.28+
    (the `app=` shortcut was removed in 0.28). Centralizing the wiring keeps
    the dep-bump PR for httpx from rewriting every test.
    """
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def app(wired_redis_cache, monkeypatch, tmp_path):
    """Build a minimal FastAPI app with just the auth router mounted.

    Uses a temp config.yaml so persisting credentials doesn't pollute the repo.
    """
    from app import auth as auth_module
    from app import config as config_module
    from app.routers import auth_router

    # Point persisted-config writes at a temp file.
    cfg_path = tmp_path / "config.yaml"
    monkeypatch.setattr(config_module.settings, "config_path", str(cfg_path))

    # Reset auth state to a known baseline.
    config_module.config.auth.admin_user = "admin"
    config_module.config.auth.admin_password_hash = auth_module.hash_password("correct-horse-battery")
    config_module.config.auth.jwt_secret = "test-secret-not-the-default"
    config_module.config.auth.session_hours = 1

    application = FastAPI()
    application.include_router(auth_router.router, prefix="/api")
    return application


@pytest.fixture
async def client(app):
    async with _make_client(app) as ac:
        yield ac


def test_create_and_decode_token_roundtrip(wired_redis_cache):
    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = "rt-secret"
    token = auth_module.create_token({"username": "admin", "role": "admin"})
    decoded = auth_module.decode_token(token)
    assert decoded == {"username": "admin", "role": "admin"}


def test_decode_token_rejects_wrong_signature():
    """A token signed with a different secret must be rejected with 401."""
    import jwt

    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = "the-real-secret"
    forged = jwt.encode(
        {"sub": "admin", "role": "admin", "exp": 9999999999},
        "guessed-secret",
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as exc:
        auth_module.decode_token(forged)
    assert exc.value.status_code == 401


def test_decode_token_rejects_payload_without_role():
    import jwt

    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = "secret-x"
    bad = jwt.encode({"sub": "admin", "exp": 9999999999}, "secret-x", algorithm="HS256")
    with pytest.raises(HTTPException) as exc:
        auth_module.decode_token(bad)
    assert exc.value.status_code == 401


async def test_login_happy_path_returns_token(client):
    response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "correct-horse-battery"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["token"]
    assert data["user"] == {"username": "admin", "role": "admin"}
    assert data["initial_setup"] is False


async def test_login_wrong_password_401(client):
    response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong"},
    )
    assert response.status_code == 401


async def test_login_rate_limit_kicks_in_after_threshold(client):
    """5 wrong-password attempts in quick succession, then 6th must be 429."""
    for _ in range(5):
        r = await client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong"},
        )
        assert r.status_code == 401
    over = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong"},
    )
    assert over.status_code == 429, (
        "rate-limit must reject the 6th login attempt, regardless of credential validity"
    )


async def test_bootstrap_rate_limit_kicks_in(app):
    """4 bootstrap attempts in <60s must hit the 3/60s bootstrap rate limit on the 4th.

    We re-clear admin_password_hash after every successful bootstrap so each
    iteration takes the bootstrap codepath and the rate-limit gate is the
    actual thing under test. Localhost (127.0.0.1) is implicitly authorized
    for bootstrap, so authorization isn't what would block us.
    """
    from app import config as config_module

    async with _make_client(app) as bc:
        # Each within-quota bootstrap call sets the password (200), so we
        # blank it immediately to keep the next call on the bootstrap path.
        for attempt in range(3):
            config_module.config.auth.admin_password_hash = ""
            r = await bc.post(
                "/api/auth/login",
                json={"username": "admin", "password": "newAdminPw1"},
            )
            assert r.status_code == 200, (
                f"bootstrap attempt {attempt + 1} of 3 should succeed under quota, "
                f"got {r.status_code} {r.text}"
            )

        # 4th attempt within 60s: bootstrap rate limit must fire.
        config_module.config.auth.admin_password_hash = ""
        over = await bc.post(
            "/api/auth/login",
            json={"username": "admin", "password": "newAdminPw1"},
        )
        assert over.status_code == 429, (
            f"bootstrap rate limit must engage on the 4th attempt, got {over.status_code}"
        )


async def test_change_password_requires_old_password(client, app):
    from app import auth as auth_module
    from app import config as config_module

    # Issue a valid admin token without going through /login (avoid extra
    # rate-limit pressure in tests that share the same fakeredis bucket).
    config_module.config.auth.jwt_secret = "cp-secret"
    token = auth_module.create_token({"username": "admin", "role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}

    r_bad = await client.post(
        "/api/auth/change-password",
        json={"old_password": "wrong", "new_password": "ANewLongerPw1"},
        headers=headers,
    )
    assert r_bad.status_code == 401

    r_ok = await client.post(
        "/api/auth/change-password",
        json={"old_password": "correct-horse-battery", "new_password": "ANewLongerPw1"},
        headers=headers,
    )
    assert r_ok.status_code == 200
    # Hash should now verify the new password.
    assert auth_module.verify_password("ANewLongerPw1", config_module.config.auth.admin_password_hash)


async def test_change_password_rejects_short_new_password(client):
    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = "cp-secret-2"
    token = auth_module.create_token({"username": "admin", "role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post(
        "/api/auth/change-password",
        json={"old_password": "correct-horse-battery", "new_password": "short"},
        headers=headers,
    )
    # Pydantic Field(min_length=8) -> 422 on validation
    assert r.status_code == 422
