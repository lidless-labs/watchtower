"""Tests for app.services.notification_service.

Covers the claim-first invariant the security branch introduced:
- Cooldown is claimed atomically BEFORE the global rate-limit gate.
- If the rate-limit gate denies the dispatch, the cooldown is released so
  the next legitimate alert isn't suppressed by a claim that never sent.
- Recoveries skip the cooldown gate so a fresh-alert claim can't suppress
  the matching recovery.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


@pytest.fixture
def discord_config():
    return {
        "notifications": {
            "notify_on": ["critical"],
            "cooldown_minutes": 5,
            "channels": {
                "discord": {
                    "enabled": True,
                    "webhook_url": "https://example.invalid/webhook",
                    "mention_role": "@here",
                }
            },
        }
    }


@pytest.fixture
def fresh_service():
    """Return a NotificationService with empty history/stats per test."""
    from app.services.notification_service import NotificationService
    return NotificationService()


async def _patch_send_to_succeed(monkeypatch, service):
    async def _ok(*_a, **_kw):
        return None
    monkeypatch.setattr(service, "_send_discord", _ok)
    monkeypatch.setattr(service, "_send_pushover", _ok)
    monkeypatch.setattr(service, "_send_email", _ok)


async def test_email_html_escapes_alert_content(monkeypatch, fresh_service):
    """A malicious device/message must not inject raw HTML into the email body."""
    import aiosmtplib

    captured = {}

    async def _capture(msg, **_kw):
        # Pull the text/html part out of the MIMEMultipart.
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                captured["html"] = part.get_payload(decode=True).decode("utf-8")
        return None

    monkeypatch.setattr(aiosmtplib, "send", _capture)

    cfg = {
        "smtp_host": "smtp.example.invalid",
        "recipients": ["noc@example.invalid"],
        "from_address": "watchtower@example.invalid",
    }
    await fresh_service._send_email(
        cfg,
        severity="critical",
        device="<script>alert(1)</script>",
        message="<img src=x onerror=alert(2)>",
        details="<b>boom</b>",
        is_recovery=False,
    )

    body = captured["html"]
    assert "<script>alert(1)</script>" not in body
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body
    assert "<img src=x onerror=alert(2)>" not in body
    assert "&lt;img src=x onerror=alert(2)&gt;" in body


async def test_duplicate_alert_within_cooldown_is_suppressed(
    wired_redis_cache, discord_config, fresh_service, monkeypatch
):
    """The second dispatch for the same alert/channel must be suppressed."""
    await _patch_send_to_succeed(monkeypatch, fresh_service)

    first = await fresh_service.dispatch(
        alert_id="alert-1",
        alert_type="cpu",
        severity="critical",
        device="dev-a",
        message="m",
        config=discord_config,
    )
    assert first[0].status == "success"

    second = await fresh_service.dispatch(
        alert_id="alert-1",
        alert_type="cpu",
        severity="critical",
        device="dev-a",
        message="m",
        config=discord_config,
    )
    assert second[0].status == "cooldown"


async def test_rate_limit_denial_releases_cooldown(
    wired_redis_cache, discord_config, fresh_service, monkeypatch
):
    """If the global rate-limit gate denies dispatch, the cooldown lock must
    be released so a follow-up alert isn't suppressed by a phantom claim."""
    from app import services
    from app.services import notification_service as ns_module

    await _patch_send_to_succeed(monkeypatch, fresh_service)

    # Force the rate-limit gate to deny.
    async def _deny(*_a, **_kw):
        return False, 999
    monkeypatch.setattr(ns_module, "sliding_window_check", _deny)

    # Track release_cooldown calls to confirm the CAS-safe release fires.
    release_calls: list[tuple] = []
    real_release = ns_module.release_cooldown

    async def _track_release(key, token):
        release_calls.append((key, token))
        await real_release(key, token)
    monkeypatch.setattr(ns_module, "release_cooldown", _track_release)

    result = await fresh_service.dispatch(
        alert_id="alert-rl",
        alert_type="cpu",
        severity="critical",
        device="dev-a",
        message="m",
        config=discord_config,
    )
    assert result[0].status == "failed"
    assert "Rate limited" in (result[0].error or "")
    assert release_calls, (
        "rate-limit denial must release the cooldown so the next legitimate "
        "alert isn't suppressed by a phantom claim"
    )

    # Now confirm the next legitimate alert (no rate-limit denial) gets through.
    monkeypatch.setattr(ns_module, "sliding_window_check", services.notification_service.sliding_window_check)

    async def _allow(*_a, **_kw):
        return True, 1
    monkeypatch.setattr(ns_module, "sliding_window_check", _allow)

    follow_up = await fresh_service.dispatch(
        alert_id="alert-rl",
        alert_type="cpu",
        severity="critical",
        device="dev-a",
        message="m",
        config=discord_config,
    )
    assert follow_up[0].status == "success", (
        "after release_cooldown, the next dispatch for the same alert must succeed"
    )


async def test_recovery_skips_cooldown_gate(
    wired_redis_cache, discord_config, fresh_service, monkeypatch
):
    """Recoveries must always go through, even if a fresh-alert claim is active."""
    from app.services import notification_service as ns_module

    await _patch_send_to_succeed(monkeypatch, fresh_service)

    # Stub out claim_cooldown so we can assert it isn't called for recoveries.
    claim_calls: list[tuple] = []
    real_claim = ns_module.claim_cooldown

    async def _track(key, seconds):
        claim_calls.append((key, seconds))
        return await real_claim(key, seconds)
    monkeypatch.setattr(ns_module, "claim_cooldown", _track)

    # Fresh alert dispatch first to populate a cooldown for that alert_id.
    await fresh_service.dispatch(
        alert_id="alert-rec",
        alert_type="cpu",
        severity="critical",
        device="dev-a",
        message="firing",
        config=discord_config,
    )
    assert claim_calls, "fresh alert must claim cooldown"

    pre_recovery_calls = len(claim_calls)
    result = await fresh_service.dispatch(
        alert_id="alert-rec",
        alert_type="cpu",
        severity="critical",
        device="dev-a",
        message="recovered",
        config=discord_config,
        is_recovery=True,
    )
    assert result[0].status == "success"
    assert len(claim_calls) == pre_recovery_calls, (
        "recovery dispatch must NOT call claim_cooldown"
    )


async def test_dispatch_with_no_config_returns_empty(fresh_service):
    """dispatch() without config is a no-op (early return), not an exception."""
    out = await fresh_service.dispatch(
        alert_id="x", alert_type="x", severity="critical",
        device="d", message="m", config=None,
    )
    assert out == []


async def test_severity_below_threshold_skipped(wired_redis_cache, discord_config, fresh_service):
    """notify_on=['critical'] must skip non-critical alerts."""
    out = await fresh_service.dispatch(
        alert_id="alert-low",
        alert_type="cpu",
        severity="info",
        device="dev-a",
        message="m",
        config=discord_config,
    )
    assert out == []
