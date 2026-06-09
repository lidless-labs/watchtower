"""Tests for app.auth and app.routers.auth_router.

Covers:
- create_token / decode_token roundtrip and signature validation.
- Login flow happy path (after admin password is set).
- Bootstrap rate limit kicks in after the configured number of attempts.
- Rate limit on the regular login endpoint.
- Password change requires the correct old password.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

TEST_JWT_SECRET = "test-jwt-secret-32-bytes-minimum"


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
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
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

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = auth_module.create_token({"username": "admin", "role": "admin"})
    decoded = auth_module.decode_token(token)
    assert decoded == {"username": "admin", "role": "admin"}


def test_decode_token_rejects_wrong_signature():
    """A token signed with a different secret must be rejected with 401."""
    import jwt

    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    forged = jwt.encode(
        {"sub": "admin", "role": "admin", "exp": 9999999999, "ver": 1},
        "different-test-jwt-secret-32-bytes",
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as exc:
        auth_module.decode_token(forged)
    assert exc.value.status_code == 401


def test_decode_token_rejects_payload_without_role():
    import jwt

    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    bad = jwt.encode({"sub": "admin", "exp": 9999999999, "ver": 1}, TEST_JWT_SECRET, algorithm="HS256")
    with pytest.raises(HTTPException) as exc:
        auth_module.decode_token(bad)
    assert exc.value.status_code == 401


def test_decode_token_rejects_invalidated_version():
    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = auth_module.create_token({"username": "admin", "role": "admin"})

    config_module.config.auth.token_version = 2

    with pytest.raises(HTTPException) as exc:
        auth_module.decode_token(token)
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


async def test_login_rate_limit_uses_forwarded_ip_from_loopback_proxy(client):
    """Production nginx proxies every request from 127.0.0.1 to uvicorn.

    The limiter should bucket by the forwarded client IP when the peer is the
    trusted loopback proxy, otherwise one caller can lock out every user.
    """
    for _ in range(5):
        r = await client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong"},
            headers={"X-Real-IP": "198.51.100.10"},
        )
        assert r.status_code == 401

    same_client = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong"},
        headers={"X-Real-IP": "198.51.100.10"},
    )
    assert same_client.status_code == 429

    different_client = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "correct-horse-battery"},
        headers={"X-Real-IP": "198.51.100.11"},
    )
    assert different_client.status_code == 200


async def test_bootstrap_rate_limit_kicks_in(app, monkeypatch):
    """4 bootstrap attempts in <60s must hit the 3/60s bootstrap rate limit on the 4th.

    We re-clear admin_password_hash after every successful bootstrap so each
    iteration takes the bootstrap codepath and the rate-limit gate is the
    actual thing under test. dev_mode is required for localhost to count as
    authorized post-CVE; this test is about the rate limit, not authz.
    """
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "dev_mode", True)

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
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
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
    assert config_module.config.auth.token_version == 2
    persisted = Path(config_module.settings.config_path)
    on_disk = yaml.safe_load(persisted.read_text())
    assert auth_module.verify_password("ANewLongerPw1", on_disk["auth"]["admin_password_hash"])
    assert on_disk["auth"]["token_version"] == 2
    assert (persisted.stat().st_mode & 0o777) == 0o600

    r_old_token = await client.get("/api/auth/me", headers=headers)
    assert r_old_token.status_code == 401


async def test_change_password_rejects_short_new_password(client):
    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = auth_module.create_token({"username": "admin", "role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post(
        "/api/auth/change-password",
        json={"old_password": "correct-horse-battery", "new_password": "short"},
        headers=headers,
    )
    # Pydantic Field(min_length=8) -> 422 on validation
    assert r.status_code == 422


async def test_bootstrap_rejects_localhost_without_token_in_prod(app, monkeypatch):
    """Localhost source IP must NOT auto-authorize bootstrap when dev_mode=False.

    A same-host reverse proxy (nginx -> uvicorn on 127.0.0.1) makes every public
    request look local from uvicorn's perspective. Trusting that as "this must
    be the operator on the box" is an auth bypass: any internet user can hit
    /auth/login through the proxy and run first-login if the admin password is
    still unset. Production must require the env-token regardless of source.
    """
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "dev_mode", False)
    monkeypatch.delenv("WATCHTOWER_BOOTSTRAP_TOKEN", raising=False)
    config_module.config.auth.admin_password_hash = ""

    async with _make_client(app) as bc:
        r = await bc.post(
            "/api/auth/login",
            json={"username": "admin", "password": "newAdminPw1"},
        )
    assert r.status_code == 403, (
        f"localhost bootstrap in production must require a token, got "
        f"{r.status_code} {r.text}"
    )


async def test_bootstrap_localhost_allowed_in_dev_mode(app, monkeypatch):
    """In dev_mode, localhost without a token still works for first-login."""
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "dev_mode", True)
    monkeypatch.delenv("WATCHTOWER_BOOTSTRAP_TOKEN", raising=False)
    config_module.config.auth.admin_password_hash = ""

    async with _make_client(app) as bc:
        r = await bc.post(
            "/api/auth/login",
            json={"username": "admin", "password": "newAdminPw1"},
        )
    assert r.status_code == 200, (
        f"dev-mode localhost bootstrap should succeed, got {r.status_code} {r.text}"
    )


async def test_bootstrap_token_works_in_prod(app, monkeypatch):
    """A valid WATCHTOWER_BOOTSTRAP_TOKEN unblocks first-login from any source."""
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "dev_mode", False)
    monkeypatch.setenv("WATCHTOWER_BOOTSTRAP_TOKEN", "production-secret-xyz")
    config_module.config.auth.admin_password_hash = ""

    async with _make_client(app) as bc:
        r = await bc.post(
            "/api/auth/login",
            json={"username": "admin", "password": "newAdminPw1"},
            headers={"X-Watchtower-Bootstrap-Token": "production-secret-xyz"},
        )
    assert r.status_code == 200, (
        f"token-authorized prod bootstrap should succeed, got "
        f"{r.status_code} {r.text}"
    )


# ── Session cookie auth ──────────────────────────────────────────────────────


async def test_login_sets_httponly_strict_session_cookie(client):
    r = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "correct-horse-battery"},
    )
    assert r.status_code == 200

    set_cookie = r.headers.get("set-cookie", "").lower()
    assert "watchtower_session=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    # Plain-HTTP test transport must not get the Secure flag (it would make
    # the cookie unusable on HTTP LAN installs).
    assert "secure" not in set_cookie


async def test_session_cookie_authenticates_without_bearer_header(client):
    r = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "correct-horse-battery"},
    )
    assert r.status_code == 200

    # httpx carries the Set-Cookie jar; no Authorization header on purpose.
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"username": "admin", "role": "admin"}


async def test_bearer_header_takes_precedence_over_cookie(client):
    r = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "correct-horse-battery"},
    )
    assert r.status_code == 200

    # A bad explicit credential must fail even when a valid cookie rides along,
    # otherwise a broken API client would silently run with cookie identity.
    me = await client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert me.status_code == 401


async def test_logout_clears_session_cookie(client):
    r = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "correct-horse-battery"},
    )
    assert r.status_code == 200

    out = await client.post("/api/auth/logout")
    assert out.status_code == 200

    me = await client.get("/api/auth/me")
    assert me.status_code == 401


async def test_change_password_reissues_session(client, app):
    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    token = auth_module.create_token({"username": "admin", "role": "admin"})

    r = await client.post(
        "/api/auth/change-password",
        json={"old_password": "correct-horse-battery", "new_password": "ANewLongerPw1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()

    # The rotation bumps token_version, killing the caller's old token. The
    # response must hand back a fresh token (and cookie) so the session survives.
    assert "watchtower_session=" in r.headers.get("set-cookie", "")
    new_token = body["token"]
    assert auth_module.decode_token(new_token) == {"username": "admin", "role": "admin"}

    me_cookie = await client.get("/api/auth/me")
    assert me_cookie.status_code == 200
