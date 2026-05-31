"""Helpers for serving operator-configured export files."""

from pathlib import Path

from fastapi import HTTPException


def validate_csv_export_path(configured_path: str) -> Path:
    """Return a safe CSV export path or raise an HTTP error.

    Export paths are admin-configured, but the download endpoints are available
    to authenticated viewers. Keep those endpoints constrained to real CSV
    files and avoid following symlinks into arbitrary local files.
    """
    csv_path = Path(configured_path)

    if csv_path.suffix.lower() != ".csv":
        raise HTTPException(status_code=404, detail="CSV export path is invalid")

    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="No history available yet")

    if csv_path.is_symlink() or not csv_path.is_file():
        raise HTTPException(status_code=404, detail="CSV export path is invalid")

    return csv_path
