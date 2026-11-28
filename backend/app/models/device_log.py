"""LibreNMS device log entry model."""

from pydantic import BaseModel


class DeviceLogEntry(BaseModel):
    """A display-ready log entry returned by LibreNMS."""

    timestamp: str
    type: str | None = None
    severity: str | None = None
    message: str
