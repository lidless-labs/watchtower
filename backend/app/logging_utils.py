"""Small helpers for consistent structured application logs."""

from __future__ import annotations

import json
import logging
from typing import Any


def _format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)


def log_event(logger: logging.Logger, level: int, event: str, **fields: Any) -> None:
    """Emit one parseable key=value log line without leaking nested payloads."""
    suffix = " ".join(f"{key}={_format_value(value)}" for key, value in fields.items())
    message = f"event={event}"
    if suffix:
        message = f"{message} {suffix}"
    logger.log(level, message)
