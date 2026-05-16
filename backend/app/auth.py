"""Authentication utilities for JWT-based access control."""

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Callable

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from .config import config


class UserRole(str, Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


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
    expires_at = datetime.now(timezone.utc) + timedelta(hours=config.auth.session_hours)
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "exp": expires_at,
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
        return {"username": username, "role": role}
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc


def get_current_user(request: Request) -> dict:
    """FastAPI dependency to extract and validate bearer token."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

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

    Demo mode bypasses the check entirely so the public sandbox can keep
    accepting unauthenticated POSTs to ack/resolve/trigger/test-channel.
    Production (settings.demo_mode=False) is unaffected.
    """

    def _enforce(request: Request) -> dict:
        # Lazy import: auth.py is imported at module load before settings is
        # fully initialized in some startup paths.
        from .config import settings

        if settings.demo_mode:
            return {"username": "demo", "role": UserRole.ADMIN.value}

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
