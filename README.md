<p align="center">
  <img src="docs/assets/watchtower-banner.jpg" alt="Watchtower banner">
</p>

<h1 align="center">Watchtower</h1>

<p align="center">
  <strong>Real-time NOC dashboard for network monitoring.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/FastAPI-Python_3.12%2B-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI on Python 3.12+" />
  <img src="https://img.shields.io/badge/WebSockets-live_updates-7C3AED?style=for-the-badge" alt="WebSockets live updates" />
  <img src="https://img.shields.io/badge/Proxmox-LibreNMS-1F2937?style=for-the-badge" alt="Proxmox and LibreNMS" />
  <img src="https://img.shields.io/badge/license-MIT-2EA043?style=for-the-badge" alt="MIT license" />
</p>

A modern Network Operations Center dashboard that monitors network devices, interfaces, VMs, and alerts through LibreNMS, Proxmox, and other integrations. WebSocket-driven live updates keep metrics current without page refreshes.

---

## Features

### Monitoring
- **Device Status** — Real-time up/down/degraded status with WebSocket updates
- **Network Topology** — Interactive React Flow map with link status and port details
- **Interface Utilization** — Bandwidth, errors, and traffic graphs
- **Port Groups** — Aggregate traffic monitoring for groups of ports by description
- **Speedtest** — Scheduled WAN speed tests with historical tracking

### Alerts & Notifications
- **Alert Feed** — Critical/warning/info severity levels with acknowledgment workflow
- **Multi-Channel Notifications** — Discord, Pushover, and Email alerts
- **Configurable Thresholds** — Per-device CPU, memory, and interface limits

### Infrastructure
- **Proxmox Integration** — VM/LXC status, resource usage, and node details
- **Historical Data** — InfluxDB time-series with configurable retention
- **CDP/LLDP Discovery** — Automatic topology discovery from LibreNMS

### Administration
- **Settings UI** — Web-based configuration for integrations and thresholds
- **JWT Authentication** — Secure API access with role-based permissions
- **User Management** — Admin controls for access

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS |
| State | Zustand |
| Visualization | React Flow, Recharts, Mermaid |
| Backend | FastAPI, Python 3.12 |
| Cache | Redis |
| Time Series | InfluxDB |
| Scheduler | APScheduler |
| Auth | JWT + bcrypt |

---

## Integrations

| Service | Purpose |
|---------|---------|
| **LibreNMS** | Device polling, SNMP data, alerts, CDP/LLDP topology |
| **Proxmox** | VM/LXC monitoring, node health, storage |
| **InfluxDB** | Historical metrics and graphs |
| **Netdisco** | Network inventory (optional) |

---

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 20+
- Docker + Docker Compose (provides Redis and InfluxDB; `docker compose up -d` from the repo root)
- LibreNMS instance with API access

### Installation

```bash
git clone https://github.com/solomonneas/watchtower.git
cd watchtower

# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
npm run build
```

### Configuration

Copy and edit the config files:

```bash
cp config/config.example.yaml config/config.yaml
cp config/topology.example.yaml config/topology.yaml
```

Edit `config/config.yaml` with your credentials:

```yaml
auth:
  admin_user: admin
  admin_password_hash: ""  # Set on first login
  jwt_secret: "change-this-to-random-string"

data_sources:
  librenms:
    url: "http://your-librenms-server"
    api_key: "your-api-key"

  proxmox:
    url: "https://your-proxmox-server:8006"
    token_id: "user@pve!tokenname"
    token_secret: "your-token-secret"
    verify_ssl: false
```

### Running

```bash
# Development
cd backend && uvicorn app.main:app --reload
cd frontend && npm run dev

# Production (systemd)
sudo systemctl start watchtower
```

---

## Project Structure

```
watchtower/
├── frontend/
│   └── src/
│       ├── api/           # API client
│       ├── components/    # React components
│       ├── pages/         # Page views
│       ├── store/         # Zustand state
│       └── types/         # TypeScript types
├── backend/
│   └── app/
│       ├── routers/       # API endpoints
│       ├── polling/       # Background jobs
│       ├── history/       # InfluxDB integration
│       ├── services/      # Notification service
│       └── models/        # Pydantic models
├── config/
│   ├── config.yaml        # Main configuration
│   └── topology.yaml      # Network topology
└── scripts/
    └── update.sh          # Production updates
```

---

## Updating

```bash
./scripts/update.sh
```

Pulls latest code, installs dependencies, rebuilds frontend, and restarts the service.

---

## License

MIT
