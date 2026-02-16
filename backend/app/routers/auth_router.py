"""Authentication API routes."""

from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import UserRole, create_token, get_current_user, hash_password, verify_password
from ..config import config, load_yaml_config, settings

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


def _config_file_path() -> Path:
    config_path = Path(settings.config_path)
    if not config_path.is_absolute():
        config_path = Path(__file__).parent.parent.parent / settings.config_path
    return config_path


def _persist_admin_password_hash(password_hash: str) -> None:
    config_path = _config_file_path()
    data = load_yaml_config(str(config_path)) if config_path.exists() else {}

    auth_section = data.get("auth", {})
    auth_section["admin_user"] = config.auth.admin_user
    auth_section["admin_password_hash"] = password_hash
    auth_section["jwt_secret"] = config.auth.jwt_secret
    auth_section["session_hours"] = config.auth.session_hours
    data["auth"] = auth_section

    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)

    config.auth.admin_password_hash = password_hash


@router.post("/login")
async def login(payload: LoginRequest):
    """Authenticate an admin user and return JWT token."""
    if payload.username != config.auth.admin_user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    initial_setup = False

    if not config.auth.admin_password_hash:
        # Initial setup flow: accept any password once and persist hash.
        password_hash = hash_password(payload.password)
        _persist_admin_password_hash(password_hash)
        initial_setup = True
    elif not verify_password(payload.password, config.auth.admin_password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = {
        "username": config.auth.admin_user,
        "role": UserRole.ADMIN.value,
    }
    token = create_token(user)

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
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    new_hash = hash_password(payload.new_password)
    _persist_admin_password_hash(new_hash)

    return {"status": "ok", "message": "Password updated successfully"}
