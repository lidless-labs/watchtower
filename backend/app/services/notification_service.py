"""
Notification delivery engine.
Dispatches alerts to Discord, Pushover, and Email based on config.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import httpx

logger = logging.getLogger("watchtower.notifications")

SEVERITY_COLORS = {
    "critical": 0xFF0000,
    "high": 0xFF6600,
    "medium": 0xFFAA00,
    "low": 0x00AAFF,
    "info": 0x888888,
}

PUSHOVER_PRIORITY = {
    "critical": 2,
    "high": 1,
    "medium": 0,
    "low": -1,
    "info": -2,
}

PUSHOVER_SOUNDS = {
    "critical": "siren",
    "high": "mechanical",
    "medium": "pushover",
    "low": "none",
}


@dataclass
class DeliveryRecord:
    id: str
    channel: str  # discord | pushover | email
    alert_id: str
    alert_type: str
    severity: str
    device: str
    status: str  # success | failed | cooldown | demo
    timestamp: float = 0.0
    error: Optional[str] = None
    response_code: Optional[int] = None

    def to_dict(self) -> dict:
        return asdict(self)


class NotificationService:
    def __init__(self):
        self.history: deque[DeliveryRecord] = deque(maxlen=200)
        self._cooldown_map: dict[str, float] = {}  # alert_key -> last_sent_ts
        self._counter = 0
        self._rate_window: deque[float] = deque(maxlen=100)
        self._stats = {"sent": 0, "failed": 0, "cooldown": 0, "demo": 0}

    def _next_id(self) -> str:
        self._counter += 1
        return f"ntf-{self._counter:05d}"

    def _cooldown_key(self, alert_id: str, channel: str) -> str:
        return f"{channel}:{alert_id}"

    def _is_cooled_down(self, key: str, cooldown_minutes: int) -> bool:
        last = self._cooldown_map.get(key)
        if last is None:
            return False
        return (time.time() - last) < (cooldown_minutes * 60)

    def _is_rate_limited(self) -> bool:
        now = time.time()
        # Clean old entries (older than 60s)
        while self._rate_window and self._rate_window[0] < now - 60:
            self._rate_window.popleft()
        return len(self._rate_window) >= 30

    async def dispatch(
        self,
        alert_id: str,
        alert_type: str,
        severity: str,
        device: str,
        message: str,
        details: str = "",
        config: dict | None = None,
        demo: bool = False,
        is_recovery: bool = False,
    ) -> list[DeliveryRecord]:
        """Dispatch notification to all enabled channels."""
        if config is None:
            return []

        notifications_cfg = config.get("notifications", {})
        channels_cfg = notifications_cfg.get("channels", {})
        notify_on = notifications_cfg.get("notify_on", ["critical"])
        cooldown_min = notifications_cfg.get("cooldown_minutes", 5)
        notify_recovery = notifications_cfg.get("notify_on_recovery", True)

        # Check if severity qualifies
        if not is_recovery and severity not in notify_on:
            return []
        if is_recovery and not notify_recovery:
            return []

        records: list[DeliveryRecord] = []

        # Discord
        discord_cfg = channels_cfg.get("discord", {})
        if discord_cfg.get("enabled") and discord_cfg.get("webhook_url"):
            record = await self._dispatch_channel(
                "discord", alert_id, alert_type, severity, device, message, details,
                discord_cfg, cooldown_min, demo, is_recovery,
            )
            records.append(record)

        # Pushover
        pushover_cfg = channels_cfg.get("pushover", {})
        if pushover_cfg.get("enabled") and pushover_cfg.get("user_key") and pushover_cfg.get("app_token"):
            record = await self._dispatch_channel(
                "pushover", alert_id, alert_type, severity, device, message, details,
                pushover_cfg, cooldown_min, demo, is_recovery,
            )
            records.append(record)

        # Email
        email_cfg = channels_cfg.get("email", {})
        if email_cfg.get("enabled") and email_cfg.get("smtp_host") and email_cfg.get("recipients"):
            record = await self._dispatch_channel(
                "email", alert_id, alert_type, severity, device, message, details,
                email_cfg, cooldown_min, demo, is_recovery,
            )
            records.append(record)

        return records

    async def _dispatch_channel(
        self, channel: str, alert_id: str, alert_type: str, severity: str,
        device: str, message: str, details: str, channel_cfg: dict,
        cooldown_min: int, demo: bool, is_recovery: bool,
    ) -> DeliveryRecord:
        record = DeliveryRecord(
            id=self._next_id(), channel=channel, alert_id=alert_id,
            alert_type=alert_type, severity=severity, device=device,
            status="pending", timestamp=time.time(),
        )

        # Cooldown check
        ck = self._cooldown_key(alert_id, channel)
        if not is_recovery and self._is_cooled_down(ck, cooldown_min):
            record.status = "cooldown"
            self._stats["cooldown"] += 1
            self.history.append(record)
            return record

        # Rate limit
        if self._is_rate_limited():
            record.status = "failed"
            record.error = "Rate limited (30/min)"
            self._stats["failed"] += 1
            self.history.append(record)
            return record

        # Demo mode
        if demo:
            record.status = "demo"
            record.response_code = 200
            self._stats["demo"] += 1
            self._cooldown_map[ck] = time.time()
            self._rate_window.append(time.time())
            self.history.append(record)
            logger.info(f"[DEMO] Notification to {channel}: {message}")
            return record

        # Real dispatch
        try:
            if channel == "discord":
                await self._send_discord(channel_cfg, severity, device, message, details, is_recovery)
            elif channel == "pushover":
                await self._send_pushover(channel_cfg, severity, device, message, details, is_recovery)
            elif channel == "email":
                await self._send_email(channel_cfg, severity, device, message, details, is_recovery)

            record.status = "success"
            record.response_code = 200
            self._stats["sent"] += 1
            self._cooldown_map[ck] = time.time()
        except Exception as exc:
            record.status = "failed"
            record.error = str(exc)[:200]
            self._stats["failed"] += 1
            logger.error(f"Notification to {channel} failed: {exc}")

        self._rate_window.append(time.time())
        self.history.append(record)
        return record

    async def _send_discord(
        self, cfg: dict, severity: str, device: str,
        message: str, details: str, is_recovery: bool,
    ) -> None:
        color = 0x00FF00 if is_recovery else SEVERITY_COLORS.get(severity, 0x888888)
        title = f"✅ Recovered: {device}" if is_recovery else f"🚨 {severity.upper()}: {device}"
        mention = cfg.get("mention_role", "@here")

        embed = {
            "title": title,
            "description": message,
            "color": color,
            "fields": [],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "footer": {"text": "Watchtower NOC"},
        }
        if details:
            embed["fields"].append({"name": "Details", "value": details[:1024], "inline": False})
        embed["fields"].append({"name": "Severity", "value": severity.upper(), "inline": True})
        embed["fields"].append({"name": "Device", "value": device, "inline": True})

        payload = {"content": mention if not is_recovery else "", "embeds": [embed]}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(cfg["webhook_url"], json=payload)
            resp.raise_for_status()

    async def _send_pushover(
        self, cfg: dict, severity: str, device: str,
        message: str, details: str, is_recovery: bool,
    ) -> None:
        priority = 0 if is_recovery else PUSHOVER_PRIORITY.get(severity, 0)
        sound = "gamelan" if is_recovery else PUSHOVER_SOUNDS.get(severity, "pushover")
        title = f"✅ Recovered: {device}" if is_recovery else f"🚨 {severity.upper()}: {device}"

        data: dict = {
            "token": cfg["app_token"],
            "user": cfg["user_key"],
            "title": title,
            "message": f"{message}\n{details}" if details else message,
            "priority": priority,
            "sound": sound,
        }

        if priority == 2:
            data["retry"] = cfg.get("retry", 60)
            data["expire"] = cfg.get("expire", 3600)

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post("https://api.pushover.net/1/messages.json", data=data)
            resp.raise_for_status()

    async def _send_email(
        self, cfg: dict, severity: str, device: str,
        message: str, details: str, is_recovery: bool,
    ) -> None:
        import aiosmtplib

        prefix = cfg.get("subject_prefix", "[Watchtower]")
        status = "RECOVERED" if is_recovery else severity.upper()
        subject = f"{prefix} {status}: {device}"

        html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: {'#00aa44' if is_recovery else '#cc0000'}; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0; font-size: 18px;">{'✅' if is_recovery else '🚨'} {status}: {device}</h2>
            </div>
            <div style="background: #1a1a2e; color: #e0e0e0; padding: 20px; border-radius: 0 0 8px 8px;">
                <p style="margin: 0 0 12px;">{message}</p>
                {'<p style="margin: 0; color: #aaa; font-size: 13px;">' + details + '</p>' if details else ''}
                <hr style="border: 0; border-top: 1px solid #333; margin: 16px 0;" />
                <p style="margin: 0; color: #666; font-size: 11px;">Watchtower NOC &middot; {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</p>
            </div>
        </div>
        """

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = cfg.get("from_address", cfg.get("smtp_user", "watchtower@localhost"))
        msg["To"] = ", ".join(cfg.get("recipients", []))
        msg.attach(MIMEText(message, "plain"))
        msg.attach(MIMEText(html, "html"))

        await aiosmtplib.send(
            msg,
            hostname=cfg["smtp_host"],
            port=cfg.get("smtp_port", 587),
            username=cfg.get("smtp_user") or None,
            password=cfg.get("smtp_password") or None,
            start_tls=cfg.get("use_tls", True),
        )

    async def test_channel(self, channel: str, config: dict) -> DeliveryRecord:
        """Send a test notification to a specific channel."""
        channels_cfg = config.get("notifications", {}).get("channels", {})
        channel_cfg = channels_cfg.get(channel, {})

        if not channel_cfg.get("enabled"):
            record = DeliveryRecord(
                id=self._next_id(), channel=channel, alert_id="test",
                alert_type="test", severity="info", device="Test Device",
                status="failed", timestamp=time.time(), error="Channel not enabled",
            )
            self.history.append(record)
            return record

        return await self._dispatch_channel(
            channel=channel, alert_id="test", alert_type="test_notification",
            severity="info", device="Watchtower Test", message="This is a test notification from Watchtower.",
            details="If you're seeing this, your notification channel is configured correctly.",
            channel_cfg=channel_cfg, cooldown_min=0, demo=False, is_recovery=False,
        )

    def get_history(self, limit: int = 50) -> list[dict]:
        return [r.to_dict() for r in reversed(list(self.history))][:limit]

    def get_stats(self) -> dict:
        return {**self._stats, "total": sum(self._stats.values()), "history_size": len(self.history)}


notification_service = NotificationService()
