"""Authentication utilities for JWT-based access control."""

from datetime import datetime, timedelta, timezone
from enum import Enum

import bcrypt
import jwt
from fastapi import HTTPException, Request

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
