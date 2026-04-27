"""Configuration loader for Watchtower."""

import copy
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AuthConfig(BaseModel):
    admin_user: str = "admin"
    admin_password_hash: str = ""
    jwt_secret: str = "change-me-in-production"
    session_hours: int = 24


class LibreNMSConfig(BaseModel):
    url: str = ""
    api_key: str = ""
    webhook_token: str = ""


class NetdiscoConfig(BaseModel):
    url: str = ""
    api_key: str = ""
    username: str = ""
    password: str = ""


class ProxmoxInstanceConfig(BaseModel):
    """Configuration for a single Proxmox instance."""
    name: str = "primary"
    url: str = ""
    token_id: str = ""
    token_secret: str = ""
    verify_ssl: bool = False


class ProxmoxConfig(BaseModel):
    """Proxmox configuration with support for multiple instances."""
    url: str = ""
    token_id: str = ""
    token_secret: str = ""
    verify_ssl: bool = False
    additional: list[ProxmoxInstanceConfig] = []


class PaloAltoFirewallConfig(BaseModel):
    """Configuration for a single Palo Alto firewall."""
    name: str = ""
    host: str = ""
    api_key: str = ""
    verify_ssl: bool = False
    model: str = ""  # e.g., "PA-3410"


class PaloAltoConfig(BaseModel):
    """Palo Alto firewall configuration."""
    enabled: bool = False
    firewalls: list[PaloAltoFirewallConfig] = []


class DataSourcesConfig(BaseModel):
    librenms: LibreNMSConfig = LibreNMSConfig()
    netdisco: NetdiscoConfig = NetdiscoConfig()
    proxmox: ProxmoxConfig = ProxmoxConfig()


class PollingConfig(BaseModel):
    device_status: int = 30
    device_stats: int = 60
    topology: int = 300
    interfaces: int = 60
    proxmox: int = 60


class DiscordConfig(BaseModel):
    enabled: bool = False
    webhook_url: str = ""
    mention_role: str = "@here"


class PushoverConfig(BaseModel):
    enabled: bool = False
    user_key: str = ""
    app_token: str = ""
    priority: int = 2
    retry: int = 30
    expire: int = 300


class EmailConfig(BaseModel):
    enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    use_tls: bool = True
    from_address: str = ""
    recipients: list[str] = []
    subject_prefix: str = "[Watchtower]"


class NotificationChannels(BaseModel):
    discord: DiscordConfig = DiscordConfig()
    email: EmailConfig = EmailConfig()
    pushover: PushoverConfig = PushoverConfig()


class NotificationsConfig(BaseModel):
    notify_on: list[str] = ["critical"]
    notify_on_recovery: bool = True
    # Capped at 30 days to match the cooldown-key retention window in app/ratelimit.py.
    cooldown_minutes: int = Field(default=5, ge=0, le=30 * 24 * 60)
    channels: NotificationChannels = NotificationChannels()


class AlertThresholds(BaseModel):
    cpu_warning: int = 80
    cpu_critical: int = 95
    memory_warning: int = 85
    memory_critical: int = 95
    interface_utilization_warning: int = 70
    interface_utilization_critical: int = 90


class AlertThresholdsConfig(BaseModel):
    defaults: AlertThresholds = AlertThresholds()
    overrides: dict[str, AlertThresholds] = {}


class DiscoveryConfig(BaseModel):
    """Configuration for LibreNMS device discovery."""

    vm_subnets: list[str] = ["10.2.50.0/24"]
    include_types: list[str] = ["firewall", "network", "server", "wireless"]
    auto_sync: bool = False
    sync_interval: int = 3600  # seconds


class SpeedtestThresholds(BaseModel):
    """Thresholds for speedtest status indicators."""

    degraded_download_mbps: int = 200  # Yellow if below this
    degraded_ping_ms: int = 50  # Yellow if above this
    down_download_mbps: int = 10  # Red if below this


class SpeedtestLogging(BaseModel):
    """CSV logging configuration for speedtest results."""

    enabled: bool = True
    path: str = "/var/lib/watchtower/speedtest.csv"


class SpeedtestConfig(BaseModel):
    """Speedtest polling configuration."""

    enabled: bool = False
    interval_minutes: int = 5
    server_id: int | None = None  # None = automatic/closest
    interface: str | None = None  # None = default interface
    thresholds: SpeedtestThresholds = SpeedtestThresholds()
    logging: SpeedtestLogging = SpeedtestLogging()


class PortGroupThresholds(BaseModel):
    """Thresholds for port group traffic indicators."""

    warning_mbps: int = 500  # Yellow if above this
    critical_mbps: int = 800  # Red if above this


class PortGroupLogging(BaseModel):
    """CSV logging configuration for port group traffic."""

    enabled: bool = True
    path: str = "/opt/watchtower/data/port_groups.csv"


class PortGroupConfig(BaseModel):
    """Configuration for a port group to monitor aggregate traffic."""

    name: str
    description: str = ""
    match_alias: str  # Pattern to match in ifAlias (case-insensitive)
    thresholds: PortGroupThresholds = PortGroupThresholds()
    logging: PortGroupLogging = PortGroupLogging()


class InfluxDBConfig(BaseModel):
    """InfluxDB history storage configuration."""

    url: str = "http://localhost:8086"
    token: str = ""
    org: str = "watchtower"
    bucket: str = "watchtower"
    enabled: bool = False


class AppConfig(BaseModel):
    auth: AuthConfig = AuthConfig()
    data_sources: DataSourcesConfig = DataSourcesConfig()
    polling: PollingConfig = PollingConfig()
    notifications: NotificationsConfig = NotificationsConfig()
    alert_thresholds: AlertThresholdsConfig = AlertThresholdsConfig()
    discovery: DiscoveryConfig = DiscoveryConfig()
    speedtest: SpeedtestConfig = SpeedtestConfig()
    palo_alto: PaloAltoConfig = PaloAltoConfig()
    port_groups: list[PortGroupConfig] = []
    influxdb: InfluxDBConfig = InfluxDBConfig()


class Settings(BaseSettings):
    """Environment-based settings."""

    redis_url: str = "redis://localhost:6379"
    dev_mode: bool = False
    demo_mode: bool = False  # Run with fake data, no real APIs needed
    config_path: str = "../config/config.yaml"
    topology_path: str = "../config/topology.yaml"

    influxdb_url: str = "http://localhost:8086"
    influxdb_token: str = ""
    influxdb_org: str = "watchtower"
    influxdb_bucket: str = "watchtower"
    influxdb_enabled: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


def load_yaml_config(path: str) -> dict[str, Any]:
    """Load a YAML configuration file."""
    config_path = Path(path)
    if not config_path.is_absolute():
        config_path = Path(__file__).parent.parent / path

    if not config_path.exists():
        return {}

    with open(config_path) as f:
        return yaml.safe_load(f) or {}


def normalize_legacy_smtp_keys(config_dict: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy SMTP key names in notification email config."""
    email_cfg = config_dict.get("notifications", {}).get("channels", {}).get("email")
    if isinstance(email_cfg, dict) and "smtp_pass" in email_cfg and "smtp_password" not in email_cfg:
        email_cfg["smtp_password"] = email_cfg.pop("smtp_pass")
    return config_dict



def get_config() -> AppConfig:
    """Load and return the application configuration."""
    runtime_settings = Settings()
    yaml_config = normalize_legacy_smtp_keys(load_yaml_config(runtime_settings.config_path))
    return AppConfig(**yaml_config)


def get_topology_config() -> dict[str, Any]:
    """Load and return the topology configuration."""
    settings = Settings()
    return load_yaml_config(settings.topology_path)


# Singleton instances
settings = Settings()
config = get_config()


def _apply_config(new: AppConfig) -> None:
    """Copy fields from a new AppConfig onto the singleton.

    Why: callers do `from .config import config` at import time, capturing a
    reference to the singleton. Rebinding `config = ...` only updates the local
    module name, leaving stale references in every other module. Mutating the
    existing instance keeps every caller in sync.
    """
    for field_name in AppConfig.model_fields:
        setattr(config, field_name, getattr(new, field_name))


def reload_config() -> AppConfig:
    """Re-read config.yaml and apply it to the singleton in place."""
    _apply_config(get_config())
    return config


class IntegrationSettings:
    """Convenience class for integration clients to access config."""

    def __init__(self):
        self._config = get_config()

    @property
    def librenms_url(self) -> str:
        return self._config.data_sources.librenms.url

    @property
    def librenms_api_key(self) -> str:
        return self._config.data_sources.librenms.api_key

    @property
    def netdisco_url(self) -> str:
        return self._config.data_sources.netdisco.url

    @property
    def netdisco_api_key(self) -> str:
        return self._config.data_sources.netdisco.api_key

    @property
    def netdisco_username(self) -> str:
        return self._config.data_sources.netdisco.username

    @property
    def netdisco_password(self) -> str:
        return self._config.data_sources.netdisco.password

    @property
    def proxmox_url(self) -> str:
        return self._config.data_sources.proxmox.url

    @property
    def proxmox_token_id(self) -> str:
        return self._config.data_sources.proxmox.token_id

    @property
    def proxmox_token_secret(self) -> str:
        return self._config.data_sources.proxmox.token_secret

    @property
    def proxmox_verify_ssl(self) -> bool:
        return self._config.data_sources.proxmox.verify_ssl

    def get_all_proxmox_configs(self) -> list[tuple[str, ProxmoxInstanceConfig]]:
        """
        Get all Proxmox instance configurations.

        Returns a list of (name, config) tuples. The primary instance
        is named "primary"; additional instances use their configured name.
        """
        configs: list[tuple[str, ProxmoxInstanceConfig]] = []
        proxmox = self._config.data_sources.proxmox

        # Primary instance (only if configured)
        if proxmox.url:
            configs.append((
                "primary",
                ProxmoxInstanceConfig(
                    name="primary",
                    url=proxmox.url,
                    token_id=proxmox.token_id,
                    token_secret=proxmox.token_secret,
                    verify_ssl=proxmox.verify_ssl,
                )
            ))

        # Additional instances
        for instance in proxmox.additional:
            if instance.url:
                configs.append((instance.name, instance))

        return configs

    def get_palo_alto_configs(self) -> list[PaloAltoFirewallConfig]:
        """
        Get all Palo Alto firewall configurations.

        Returns a list of firewall configs if enabled.
        """
        palo_alto = self._config.palo_alto
        if not palo_alto.enabled:
            return []
        return [fw for fw in palo_alto.firewalls if fw.host and fw.api_key]


def get_settings() -> IntegrationSettings:
    """Get integration settings for API clients."""
    return IntegrationSettings()


def _config_file_path() -> Path:
    """Resolve config file path using same pattern as auth router."""
    config_path = Path(settings.config_path)
    if not config_path.is_absolute():
        config_path = Path(__file__).parent.parent / settings.config_path
    return config_path


def get_config_dict() -> dict:
    """Return current config as raw dict from YAML file."""
    config_path = _config_file_path()
    if not config_path.exists():
        return {}
    return normalize_legacy_smtp_keys(load_yaml_config(str(config_path)))


def mask_secrets(config_dict: dict) -> dict:
    """Deep-copy config and mask sensitive fields."""
    sensitive_markers = ("password", "secret", "token", "api_key", "smtp_pass")

    def _mask_value(key: str, value: Any) -> Any:
        if not isinstance(value, str) or value == "":
            return value

        key_lower = key.lower()
        if key_lower == "admin_password_hash":
            return "***"

        if any(marker in key_lower for marker in sensitive_markers):
            return f"***{value[-4:]}" if len(value) > 4 else "***"

        return value

    def _walk(node: Any) -> Any:
        if isinstance(node, dict):
            masked: dict[str, Any] = {}
            for key, value in node.items():
                if key == "auth":
                    continue
                if isinstance(value, (dict, list)):
                    masked[key] = _walk(value)
                else:
                    masked[key] = _mask_value(key, value)
            return masked

        if isinstance(node, list):
            return [_walk(item) for item in node]

        return node

    return _walk(copy.deepcopy(config_dict))


def merge_config(existing: dict, updates: dict) -> dict:
    """Deep merge updates into existing config."""
    if not isinstance(existing, dict):
        existing = {}

    merged = copy.deepcopy(existing)

    for key, update_value in updates.items():
        existing_value = merged.get(key)

        if isinstance(update_value, dict) and isinstance(existing_value, dict):
            merged[key] = merge_config(existing_value, update_value)
            continue

        if isinstance(update_value, list):
            merged[key] = copy.deepcopy(update_value)
            continue

        if isinstance(update_value, str) and update_value.startswith("***"):
            if key in merged:
                continue

        merged[key] = update_value

    return merged


def persist_config(updates: dict) -> None:
    """Merge updates with existing config.yaml and write back, then reload config singleton."""
    config_path = _config_file_path()
    existing = normalize_legacy_smtp_keys(load_yaml_config(str(config_path))) if config_path.exists() else {}
    merged = normalize_legacy_smtp_keys(merge_config(existing, updates))

    # Validate BEFORE writing to disk
    validated = AppConfig(**merged)

    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(merged, f, sort_keys=False)

    _apply_config(validated)
