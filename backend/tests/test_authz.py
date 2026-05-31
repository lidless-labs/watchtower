"""Role-gating tests for the require_role dependency factory.

The hierarchy is admin > operator > viewer. A dep built with `require_role(X)`
must admit X and every strictly higher role and reject every strictly lower
role with 403.

These are unit tests against a synthetic FastAPI app that exposes one endpoint
per role tier; that keeps them independent of the real routers' bodies (which
need data sources, Redis state, etc. that this file does not care about).
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

TEST_JWT_SECRET = "authz-test-jwt-secret-32-bytes-min"


def _make_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _token(role: str) -> str:
    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    return auth_module.create_token({"username": f"u-{role}", "role": role})


@pytest.fixture
def role_app(wired_redis_cache):
    from app.auth import UserRole, require_role

    app = FastAPI()

    @app.get("/admin-only", dependencies=[Depends(require_role(UserRole.ADMIN))])
    async def admin_route():
        return {"ok": "admin"}

    @app.get(
        "/operator-or-above",
        dependencies=[Depends(require_role(UserRole.OPERATOR))],
    )
    async def operator_route():
        return {"ok": "operator"}

    @app.get(
        "/viewer-or-above",
        dependencies=[Depends(require_role(UserRole.VIEWER))],
    )
    async def viewer_route():
        return {"ok": "viewer"}

    return app


@pytest.fixture
async def role_client(role_app):
    async with _make_client(role_app) as ac:
        yield ac


async def test_viewer_blocked_from_admin(role_client):
    r = await role_client.get(
        "/admin-only", headers={"Authorization": f"Bearer {_token('viewer')}"}
    )
    assert r.status_code == 403, f"viewer must be forbidden from admin; got {r.status_code}"


async def test_viewer_blocked_from_operator(role_client):
    r = await role_client.get(
        "/operator-or-above", headers={"Authorization": f"Bearer {_token('viewer')}"}
    )
    assert r.status_code == 403


async def test_viewer_admitted_to_viewer(role_client):
    r = await role_client.get(
        "/viewer-or-above", headers={"Authorization": f"Bearer {_token('viewer')}"}
    )
    assert r.status_code == 200


async def test_operator_blocked_from_admin(role_client):
    r = await role_client.get(
        "/admin-only", headers={"Authorization": f"Bearer {_token('operator')}"}
    )
    assert r.status_code == 403


async def test_operator_admitted_to_operator_and_viewer(role_client):
    headers = {"Authorization": f"Bearer {_token('operator')}"}
    for path in ("/operator-or-above", "/viewer-or-above"):
        r = await role_client.get(path, headers=headers)
        assert r.status_code == 200, f"operator denied at {path}: {r.status_code}"


async def test_admin_admitted_everywhere(role_client):
    headers = {"Authorization": f"Bearer {_token('admin')}"}
    for path in ("/admin-only", "/operator-or-above", "/viewer-or-above"):
        r = await role_client.get(path, headers=headers)
        assert r.status_code == 200, f"admin denied at {path}: {r.status_code}"


async def test_unknown_role_rejected(role_client):
    """A JWT whose role is not in the enum must 403, not pass silently."""
    from app import auth as auth_module
    from app import config as config_module

    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    forged = auth_module.create_token({"username": "x", "role": "superuser"})
    r = await role_client.get(
        "/admin-only", headers={"Authorization": f"Bearer {forged}"}
    )
    assert r.status_code == 403


async def test_missing_token_rejected_with_401(role_client):
    """No Authorization header still hits get_current_user first, so 401."""
    r = await role_client.get("/admin-only")
    assert r.status_code == 401


async def test_role_check_is_independent_of_endpoint_method(role_client):
    """The dep runs on all methods; documenting it via a quick POST sanity check."""
    from app.auth import UserRole, require_role

    app: FastAPI = role_client._transport.app  # type: ignore[attr-defined]

    @app.post("/admin-mutate", dependencies=[Depends(require_role(UserRole.ADMIN))])
    async def admin_post():
        return {"ok": "post"}

    r = await role_client.post(
        "/admin-mutate", headers={"Authorization": f"Bearer {_token('viewer')}"}
    )
    assert r.status_code == 403


async def test_real_alerts_router_role_gating_in_prod(wired_redis_cache):
    """Integration: mount the actual alerts router; viewer hits ack endpoint => 403.

    Synthetic role_app tests prove the dep factory itself. This one proves the
    real router file wired the dep correctly so a refactor that drops the
    decorator regresses the test, not just the unit harness.
    """
    from app.routers import alerts as alerts_module
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(alerts_module.router, prefix="/api")

    async with _make_client(app) as ac:
        r = await ac.post(
            "/api/alert/x/acknowledge",
            headers={"Authorization": f"Bearer {_token('viewer')}"},
        )
    assert r.status_code == 403, (
        f"viewer POSTing acknowledge must 403; if this drops to 200 "
        f"the role decorator on the real router file is gone. got {r.status_code}"
    )
