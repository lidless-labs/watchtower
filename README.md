<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/InfluxDB-22ADF6?style=flat-square&logo=influxdb&logoColor=white" alt="InfluxDB" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
</p>

# 🗼 Solomon's Watchtower

**Real-time NOC dashboard for enterprise network monitoring.**

Watchtower monitors network devices, interfaces, uptime, alerts, and topology through a production-grade Network Operations Center dashboard. Runs in two modes: production (real LibreNMS/Proxmox/InfluxDB backends) and demo (simulated data). WebSocket-driven live updates keep metrics current without page refreshes.

![Watchtower](docs/screenshots/dashboard.png)

---

## Features

- **Real-Time Device Monitoring** - Status indicators with WebSocket-driven live updates
- **Interactive Network Topology** - React Flow-based topology map with link status
- **Alert Feed** - Severity levels, acknowledgment workflow, and configurable thresholds
- **Interface Utilization** - Bandwidth, errors, and discard graphs via Recharts
- **Uptime Tracking** - SLA percentage calculations per device
- **Historical Data** - Time-series storage with InfluxDB (7-day demo data, or production)
- **Topology Configuration** - YAML-based topology definitions
- **Notification System** - Configurable alert escalation
- **Dark Mode** - Optimized for NOC wall displays
- **Demo Mode** - Simulated data for Vercel deployment and demos
- **Update Script** - One-command production updates with `./scripts/update.sh`

---

## Quick Start

```bash
git clone https://github.com/solomonneas/watchtower.git
cd watchtower
docker compose up --build
```

Frontend: **http://localhost:5173**
Backend API: **http://localhost:8000**

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 | Dashboard UI |
| **Language** | TypeScript 5 | Type safety |
| **Styling** | Tailwind CSS 3 | Utility-first CSS |
| **State** | Zustand | Global state management |
| **Charts** | Recharts | Interface utilization graphs |
| **Topology** | React Flow (XY Flow) | Interactive network topology |
| **Diagrams** | Mermaid | Architecture diagrams |
| **Bundler** | Vite 5 | Dev server with API/WS proxy |
| **Backend** | FastAPI | REST API and WebSocket server |
| **Cache** | Redis | Polling cache and session state |
| **Time Series** | InfluxDB | Historical metrics (30d raw, 1y hourly, 5y daily) |
| **Scheduler** | APScheduler | Background polling tasks |
| **Auth** | JWT + bcrypt | API authentication |

---

## Modes

| Mode | Data Source | Use Case |
|------|-----------|----------|
| **Production** | LibreNMS API, Proxmox API, InfluxDB | Enterprise monitoring |
| **Demo** | Simulated data with realistic patterns | Demos, training, Vercel deployment |

---

## Historical Data (InfluxDB)

**Demo mode** works immediately with 7 days of seeded mock data.

**Production setup:**
```bash
./scripts/setup-influxdb.sh
```

This starts the InfluxDB container, creates retention buckets (30d raw, 1y hourly, 5y daily), and sets up downsampling tasks. Add the config to `config/config.yaml`:

```yaml
influxdb:
  url: "http://localhost:8086"
  token: "your-token"
  org: "watchtower"
  bucket: "watchtower"
  enabled: true
```

---

## Updating Production

```bash
./scripts/update.sh
```

Options: `--no-pull`, `--backend`, `--frontend`

Handles git pull, pip install, npm build, InfluxDB container check, and service restart (systemd, PM2, or bare uvicorn).

---

## Project Structure

```text
watchtower/
├── frontend/
│   ├── src/
│   │   ├── api/               # Backend API client
│   │   ├── components/        # UI components
│   │   ├── demo/              # Demo data generators
│   │   ├── hooks/             # Custom React hooks
│   │   ├── pages/             # Page views
│   │   ├── store/             # Zustand state
│   │   ├── styles/            # CSS modules
│   │   └── types/             # TypeScript interfaces
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI entry point
│   │   ├── websocket.py       # WebSocket handler
│   │   ├── routers/           # API routes
│   │   ├── services/          # LibreNMS, Proxmox integrations
│   │   ├── models/            # Pydantic models
│   │   ├── polling/           # Background polling tasks
│   │   ├── discovery/         # Device discovery
│   │   ├── history/           # InfluxDB time-series
│   │   ├── notifications/     # Alert notifications
│   │   ├── cache.py           # Redis cache layer
│   │   ├── auth.py            # JWT authentication
│   │   └── config.py          # Configuration loader
│   └── requirements.txt
├── config/
│   ├── config.example.yaml    # Main configuration
│   ├── topology.example.yaml  # Network topology definition
│   └── topology.demo.yaml     # Demo topology
├── scripts/
│   ├── update.sh              # Production update script
│   └── setup-influxdb.sh      # InfluxDB setup
├── install/
│   ├── install.sh             # Production install
│   ├── dev.sh                 # Dev environment setup
│   └── create-lxc.sh          # Proxmox LXC creation
├── docker-compose.yml
└── specs/                     # Feature specifications
```

---

## License

MIT
