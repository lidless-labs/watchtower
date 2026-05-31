"""Tests for structured log formatting."""

from __future__ import annotations

import logging

from app.logging_utils import log_event


def test_log_event_formats_parseable_key_value_line(caplog):
    logger = logging.getLogger("watchtower.test")

    with caplog.at_level(logging.INFO, logger="watchtower.test"):
        log_event(logger, logging.INFO, "auth.login_succeeded", ip="127.0.0.1", initial_setup=False)

    assert caplog.messages == ['event=auth.login_succeeded ip="127.0.0.1" initial_setup=false']
