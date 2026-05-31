"""Regression tests for safe API path segment construction."""

from __future__ import annotations

from app.polling.librenms import _path_segment as librenms_segment
from app.polling.netdisco import _path_segment as netdisco_segment
from app.polling.proxmox import _path_segment as proxmox_segment


def test_polling_clients_encode_path_segments():
    assert librenms_segment("host/name?x=1") == "host%2Fname%3Fx%3D1"
    assert netdisco_segment("10.0.0.1/ports") == "10.0.0.1%2Fports"
    assert proxmox_segment("node/a") == "node%2Fa"
