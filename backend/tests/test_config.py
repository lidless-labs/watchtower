"""Tests for app.config singleton handling.

Covers:
- _apply_config copies all fields onto the singleton in place, so callers that
  already imported `from .config import config` see the new values without
  rebinding their own reference.
- persist_config round-trips updates through YAML and re-validates them.
- cooldown_minutes is clamped at 30 days (matches ratelimit retention ceiling).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app import config as config_module
from app.config import (
    AppConfig,
    NotificationsConfig,
    _apply_config,
    is_placeholder_jwt_secret,
    is_strong_jwt_secret,
    persist_config,
    validate_jwt_secret_for_runtime,
)


def test_apply_config_mutates_singleton_in_place():
    """The whole point of _apply_config: existing `from .config import config`
    references must reflect the updated values without being rebound."""
    original_singleton_id = id(config_module.config)

    new = AppConfig()
    new.auth.jwt_secret = "rotated-via-apply"
    new.auth.session_hours = 99

    _apply_config(new)

    assert id(config_module.config) == original_singleton_id, (
        "_apply_config must mutate the singleton in place, not rebind it"
    )
    assert config_module.config.auth.jwt_secret == "rotated-via-apply"
    assert config_module.config.auth.session_hours == 99


def test_apply_config_propagates_to_already_captured_reference():
    """Reproduces the JWT regression: a stale reference captured before
    _apply_config must observe the new value."""
    captured = config_module.config  # what auth.py and similar modules do

    new = AppConfig()
    new.auth.jwt_secret = "updated-after-capture"
    _apply_config(new)

    assert captured.auth.jwt_secret == "updated-after-capture"


def test_persist_config_round_trips_through_yaml(tmp_path, monkeypatch):
    """persist_config writes YAML, validates it, and applies it to the singleton."""
    cfg_path = tmp_path / "config.yaml"
    monkeypatch.setattr(config_module.settings, "config_path", str(cfg_path))

    persist_config({"auth": {"jwt_secret": "from-disk"}})

    on_disk = yaml.safe_load(Path(cfg_path).read_text())
    assert on_disk["auth"]["jwt_secret"] == "from-disk"
    assert config_module.config.auth.jwt_secret == "from-disk"
    assert (cfg_path.stat().st_mode & 0o777) == 0o600


def test_known_jwt_placeholders_are_unsafe():
    assert is_placeholder_jwt_secret("")
    assert is_placeholder_jwt_secret("change-me-in-production")
    assert is_placeholder_jwt_secret("change-this-to-a-random-secret-in-production")
    assert is_placeholder_jwt_secret("change-this-to-random-string")
    assert not is_placeholder_jwt_secret("actual-random-secret")


def test_production_jwt_secret_must_be_strong():
    assert not is_strong_jwt_secret("short-secret")
    assert is_strong_jwt_secret("strong-test-secret-at-least-32-bytes")

    with pytest.raises(RuntimeError):
        validate_jwt_secret_for_runtime("short-secret", dev_mode=False)

    validate_jwt_secret_for_runtime("short-secret", dev_mode=True)
    validate_jwt_secret_for_runtime("change-me-in-production", dev_mode=False)


def test_persist_config_invalid_payload_does_not_write(tmp_path, monkeypatch):
    """Validation runs BEFORE writing, so a bad update must leave the file alone."""
    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text("auth:\n  jwt_secret: original\n")
    monkeypatch.setattr(config_module.settings, "config_path", str(cfg_path))
    config_module.config.auth.jwt_secret = "original"

    with pytest.raises(Exception):
        # session_hours must be int; passing a list should fail validation
        persist_config({"auth": {"session_hours": ["not", "an", "int"]}})

    on_disk = yaml.safe_load(Path(cfg_path).read_text())
    assert on_disk["auth"]["jwt_secret"] == "original"
    assert config_module.config.auth.jwt_secret == "original"


def test_cooldown_minutes_clamped_at_30_days():
    """Ratelimit retention ceiling is 30 days; cooldown_minutes is bounded to match."""
    # 30 days expressed in minutes is the upper bound.
    NotificationsConfig(cooldown_minutes=30 * 24 * 60)

    with pytest.raises(Exception):
        NotificationsConfig(cooldown_minutes=30 * 24 * 60 + 1)


def test_cooldown_minutes_zero_is_valid():
    """cooldown_minutes=0 is the documented "no cooldown" knob; must validate."""
    cfg = NotificationsConfig(cooldown_minutes=0)
    assert cfg.cooldown_minutes == 0


def test_cooldown_minutes_negative_rejected():
    with pytest.raises(Exception):
        NotificationsConfig(cooldown_minutes=-1)
