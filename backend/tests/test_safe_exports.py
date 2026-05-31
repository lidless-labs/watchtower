"""Tests for safe export file validation."""

from __future__ import annotations

import os

import pytest
from fastapi import HTTPException

from app.safe_exports import validate_csv_export_path


def test_validate_csv_export_path_accepts_regular_csv(tmp_path):
    csv_path = tmp_path / "history.csv"
    csv_path.write_text("timestamp,value\n")

    assert validate_csv_export_path(str(csv_path)) == csv_path


def test_validate_csv_export_path_rejects_non_csv(tmp_path):
    text_path = tmp_path / "history.txt"
    text_path.write_text("not csv\n")

    with pytest.raises(HTTPException) as exc:
        validate_csv_export_path(str(text_path))

    assert exc.value.status_code == 404


def test_validate_csv_export_path_rejects_symlink(tmp_path):
    target = tmp_path / "target.csv"
    target.write_text("timestamp,value\n")
    link = tmp_path / "link.csv"

    try:
        os.symlink(target, link)
    except OSError:
        pytest.skip("symlinks are not available on this filesystem")

    with pytest.raises(HTTPException) as exc:
        validate_csv_export_path(str(link))

    assert exc.value.status_code == 404
