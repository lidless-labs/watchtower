"""Authentication API routes."""

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import UserRole, create_token, get_current_user, hash_password, verify_password
from ..config import config, persist_config, settings
from ..logging_utils import log_event
from ..ratelimit import sliding_window_check

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Max 5 login attempts per IP per 5 minutes.
_RATE_LIMIT_MAX = 5
_RATE_LIMIT_WINDOW = 300

_BOOTSTRAP_RATE_LIMIT_MAX = 3
_BOOTSTRAP_RATE_LIMIT_WINDOW = 60


async def _check_rate_limit(ip: str) -> None:
    """Raise 429 if IP exceeds login attempt threshold."""
    allowed, _ = await sliding_window_check(
        f"watchtower:ratelimit:login:{ip}",
        _RATE_LIMIT_MAX,
        _RATE_LIMIT_WINDOW,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")


async def _check_bootstrap_rate_limit(ip: str) -> None:
    """Raise 429 if bootstrap attempts exceed the per-minute cap."""
    allowed, _ = await sliding_window_check(
        f"watchtower:ratelimit:bootstrap:{ip}",
        _BOOTSTRAP_RATE_LIMIT_MAX,
        _BOOTSTRAP_RATE_LIMIT_WINDOW,
    )
    if not allowed:
        _log_bootstrap_attempt(ip, False, "rate_limited")
        raise HTTPException(status_code=429, detail="Too many bootstrap attempts. Try again later.")


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


def _persist_admin_password_hash(password_hash: str) -> None:
    next_token_version = config.auth.token_version + 1
    persist_config({
        "auth": {
            "admin_user": config.auth.admin_user,
            "admin_password_hash": password_hash,
            "jwt_secret": config.auth.jwt_secret,
            "session_hours": config.auth.session_hours,
            "token_version": next_token_version,
        }
    })


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _is_localhost(ip: str) -> bool:
    return ip in {"127.0.0.1", "::1", "localhost"}


def _extract_bootstrap_token(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()

    return (
        request.headers.get("X-Watchtower-Bootstrap-Token", "").strip()
        or request.query_params.get("bootstrap_token", "").strip()
    )


def _log_bootstrap_attempt(ip: str, allowed: bool, reason: str) -> None:
    log_event(
        logger,
        logging.WARNING,
        "auth.bootstrap_attempt",
        ip=ip,
        allowed=allowed,
        reason=reason,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def _authorize_bootstrap(request: Request, client_ip: str) -> None:
    bootstrap_env_token = os.getenv("WATCHTOWER_BOOTSTRAP_TOKEN", "").strip()
    provided_token = _extract_bootstrap_token(request)

    # Localhost-as-trusted only holds in dev_mode. Production typically runs
    # uvicorn behind a same-host reverse proxy, which makes every public
    # request look local from uvicorn's perspective. Treating that as the
    # operator-on-the-box is an auth bypass.
    if settings.dev_mode and _is_localhost(client_ip):
        _log_bootstrap_attempt(client_ip, True, "localhost+dev_mode")
        return

    if bootstrap_env_token and provided_token == bootstrap_env_token:
        _log_bootstrap_attempt(client_ip, True, "valid_bootstrap_token")
        return

    reason = "missing_bootstrap_token" if bootstrap_env_token else "bootstrap_token_not_configured"
    _log_bootstrap_attempt(client_ip, False, reason)
    raise HTTPException(status_code=403, detail="First-login bootstrap is restricted")


@router.post("/login")
async def login(payload: LoginRequest, request: Request):
    """Authenticate an admin user and return JWT token."""
    client_ip = _client_ip(request)
    await _check_rate_limit(client_ip)

    if payload.username != config.auth.admin_user:
        log_event(logger, logging.WARNING, "auth.login_failed", ip=client_ip, reason="unknown_user", username=payload.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    initial_setup = False

    if not config.auth.admin_password_hash:
        await _check_bootstrap_rate_limit(client_ip)
        _authorize_bootstrap(request, client_ip)

        if len(payload.password) < 8:
            raise HTTPException(
                status_code=400,
                detail="Password must be at least 8 characters for initial setup.",
            )
        log_event(logger, logging.WARNING, "auth.initial_password_set", ip=client_ip, username=config.auth.admin_user)
        password_hash = hash_password(payload.password)
        _persist_admin_password_hash(password_hash)
        initial_setup = True
    elif not verify_password(payload.password, config.auth.admin_password_hash):
        log_event(logger, logging.WARNING, "auth.login_failed", ip=client_ip, reason="bad_password", username=payload.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = {
        "username": config.auth.admin_user,
        "role": UserRole.ADMIN.value,
    }
    token = create_token(user)
    log_event(
        logger,
        logging.INFO,
        "auth.login_succeeded",
        ip=client_ip,
        username=user["username"],
        initial_setup=initial_setup,
    )

    return {
        "token": token,
        "user": user,
        "expires_in": config.auth.session_hours * 3600,
        "initial_setup": initial_setup,
    }


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    """Return current authenticated user info."""
    return current_user


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    """Change admin password."""
    if current_user.get("role") != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Admin access required")

    if not config.auth.admin_password_hash or not verify_password(
        payload.old_password, config.auth.admin_password_hash
    ):
        log_event(
            logger,
            logging.WARNING,
            "auth.password_change_failed",
            username=current_user.get("username"),
            reason="bad_current_password",
        )
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    new_hash = hash_password(payload.new_password)
    _persist_admin_password_hash(new_hash)
    log_event(
        logger,
        logging.INFO,
        "auth.password_changed",
        username=current_user.get("username"),
        token_version=config.auth.token_version,
    )

    return {"status": "ok", "message": "Password updated successfully"}
