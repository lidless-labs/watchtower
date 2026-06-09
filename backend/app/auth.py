"""Authentication utilities for JWT-based access control."""

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Callable

import bcrypt
import jwt
from fastapi import HTTPException, Request

from .config import config


class UserRole(str, Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


# HttpOnly session cookie set on login. Browsers authenticate with this so the
# JWT never has to live in JavaScript-accessible storage; API clients keep
# using the Authorization header, which always takes precedence.
SESSION_COOKIE_NAME = "watchtower_session"


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against its bcrypt hash."""
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_token(user: dict) -> str:
    """Create a signed JWT for a user."""
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(hours=config.auth.session_hours)
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "iat": issued_at,
        "exp": expires_at,
        "ver": config.auth.token_version,
    }
    return jwt.encode(payload, config.auth.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, config.auth.jwt_secret, algorithms=["HS256"])
        username = payload.get("sub")
        role = payload.get("role")
        if not username or not role:
            raise HTTPException(status_code=401, detail="Invalid token payload")

        token_version = payload.get("ver")
        if token_version != config.auth.token_version:
            raise HTTPException(status_code=401, detail="Token has been invalidated")

        return {"username": username, "role": role}
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc


def get_current_user(request: Request) -> dict:
    """FastAPI dependency to extract and validate a bearer token or session cookie."""
    token = ""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()

    if not token:
        token = (request.cookies.get(SESSION_COOKIE_NAME) or "").strip()

    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    return decode_token(token)


_ROLE_RANK = {
    UserRole.VIEWER: 0,
    UserRole.OPERATOR: 1,
    UserRole.ADMIN: 2,
}


def require_role(min_role: UserRole) -> Callable[..., dict]:
    """Build a FastAPI dep admitting only callers with role >= min_role.

    Hierarchy is admin > operator > viewer. Authenticated callers whose role
    decodes but is not in the enum (e.g. a forged "superuser") are rejected
    with 403, not silently treated as admin. Missing/invalid JWTs still 401
    via the underlying get_current_user dep.
    """

    def _enforce(request: Request) -> dict:
        current_user = get_current_user(request)
        raw = current_user.get("role")
        try:
            actual = UserRole(raw)
        except ValueError:
            raise HTTPException(status_code=403, detail="Unknown role")
        if _ROLE_RANK[actual] < _ROLE_RANK[min_role]:
            raise HTTPException(
                status_code=403,
                detail=f"Requires {min_role.value} role or higher",
            )
        return current_user

    return _enforce


require_admin = require_role(UserRole.ADMIN)
require_operator = require_role(UserRole.OPERATOR)
require_viewer = require_role(UserRole.VIEWER)
