"""Tests for app.websocket role-based broadcast filtering.

The runtime invariant we lock in:
- viewer-role JWTs must only receive `device_status_change`.
- admin/operator JWTs receive the full broadcast stream.
- a new (undocumented) message type defaults to admin/operator only, so
  forgetting to extend the allowlist when adding a broadcast type cannot
  silently leak data to viewers.
- unknown roles get nothing (fail closed).
"""

from __future__ import annotations

from app.websocket import (
    ROLE_ALLOWED_MESSAGE_TYPES,
    _is_allowed,
)


def test_viewer_only_sees_device_status_change():
    assert _is_allowed("viewer", "device_status_change") is True
    assert _is_allowed("viewer", "new_alerts") is False
    assert _is_allowed("viewer", "alerts_resolved") is False
    assert _is_allowed("viewer", "speedtest_result") is False


def test_admin_sees_all_broadcast_types():
    for msg_type in ROLE_ALLOWED_MESSAGE_TYPES["admin"]:
        assert _is_allowed("admin", msg_type) is True


def test_operator_sees_all_broadcast_types():
    for msg_type in ROLE_ALLOWED_MESSAGE_TYPES["operator"]:
        assert _is_allowed("operator", msg_type) is True


def test_unknown_role_receives_nothing():
    """Fail closed: a JWT with a fabricated role gets no broadcasts."""
    assert _is_allowed("superuser", "device_status_change") is False
    assert _is_allowed("", "device_status_change") is False


def test_unknown_message_type_admin_receives_viewer_does_not():
    """A new broadcast type added without extending the allowlist must NOT
    leak to viewers; admin/operator continue to receive it.

    This exists so that a future contributor calling ws_manager.broadcast(...)
    with a brand-new "type" doesn't accidentally widen the viewer-role
    surface.
    """
    assert _is_allowed("admin", "future_unspecified_event") is True
    assert _is_allowed("operator", "future_unspecified_event") is True
    assert _is_allowed("viewer", "future_unspecified_event") is False


def test_message_with_no_type_field_is_dropped():
    """Type-less broadcasts cannot be classified; nobody receives them."""
    assert _is_allowed("admin", None) is False
    assert _is_allowed("viewer", None) is False
