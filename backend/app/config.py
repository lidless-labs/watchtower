"""Configuration loader for Watchtower."""

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings


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


class NotificationChannels(BaseModel):
    discord: DiscordConfig = DiscordConfig()
    pushover: PushoverConfig = PushoverConfig()


class NotificationsConfig(BaseModel):
    notify_on: list[str] = ["critical"]
    notify_on_recovery: bool = True
    cooldown_minutes: int = 5
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
    path: str = "/mnt/samba/Shared/Instructors files/Solomon Neas/Watchtower/Speedtest/speedtest.csv"


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
    dev_mode: bool = True
    demo_mode: bool = False  # Run with fake data, no real APIs needed
    config_path: str = "../config/config.yaml"
    topology_path: str = "../config/topology.yaml"

    influxdb_url: str = "http://localhost:8086"
    influxdb_token: str = ""
    influxdb_org: str = "watchtower"
    influxdb_bucket: str = "watchtower"
    influxdb_enabled: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


def load_yaml_config(path: str) -> dict[str, Any]:
    """Load a YAML configuration file."""
    config_path = Path(path)
    if not config_path.is_absolute():
        config_path = Path(__file__).parent.parent / path

    if not config_path.exists():
        return {}

    with open(config_path) as f:
        return yaml.safe_load(f) or {}


def get_config() -> AppConfig:
    """Load and return the application configuration."""
    settings = Settings()
    yaml_config = load_yaml_config(settings.config_path)
    return AppConfig(**yaml_config)


def get_topology_config() -> dict[str, Any]:
    """Load and return the topology configuration."""
    settings = Settings()
    return load_yaml_config(settings.topology_path)


# Singleton instances
settings = Settings()
config = get_config()


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
