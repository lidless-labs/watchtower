"""The InfluxDB bucket name is interpolated into Flux queries, so a bucket
containing Flux-breaking characters must be rejected before any query runs."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import config as config_module
from app.history import reader as reader_module
from app.history.reader import HistoryReader


@pytest.fixture
def captured_query(monkeypatch):
    calls: list[str] = []

    async def fake_query(flux: str):
        calls.append(flux)
        return []

    monkeypatch.setattr(reader_module.influx_client, "query", fake_query)
    return calls


async def test_malicious_bucket_rejected_before_query(monkeypatch, captured_query):
    monkeypatch.setattr(config_module.settings, "influxdb_bucket", 'wt" |> yield(name: "x")')

    with pytest.raises(HTTPException) as exc:
        await HistoryReader().get_device_metrics("dev1", "cpu")

    assert exc.value.status_code == 500
    assert captured_query == []  # never reached the query API


async def test_valid_bucket_is_used(monkeypatch, captured_query):
    monkeypatch.setattr(config_module.settings, "influxdb_bucket", "watchtower")

    await HistoryReader().get_device_metrics("dev1", "cpu")

    assert len(captured_query) == 1
    assert 'from(bucket: "watchtower")' in captured_query[0]
