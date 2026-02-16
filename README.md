<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
</p>

# 🗼 Solomon's Watchtower · S³ Stack

> **S³** — *Solomon, Cubed.* AI-augmented engineering, exponentially.

**Real-time NOC dashboard for enterprise network monitoring.**

Monitor network devices, interfaces, uptime, alerts, and topology in a production-grade Network Operations Center dashboard. Part of the [S³ Stack](https://solomonneas.dev) — built for multi-campus enterprise networks, demos, and training.

## Quick Start

```bash
git clone https://github.com/solomonneas/watchtower.git
cd watchtower
docker compose up --build
```

Frontend at [http://localhost:5173](http://localhost:5173), API at [http://localhost:8000](http://localhost:8000).

## Features

- 📡 Real-time device monitoring with status indicators
- 🗺️ Interactive network topology map with link status
- 🚨 Alert feed with severity levels and acknowledgment workflow
- 📊 Interface utilization graphs (bandwidth, errors, discards)
- ⏱️ Uptime tracking with SLA percentage calculations
- 🔔 Configurable alert thresholds and escalation rules
- 🌙 Dark mode optimized for NOC wall displays
- 📋 Device inventory with SNMP-style data simulation
- 🔄 WebSocket-driven live updates

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18, TypeScript 5 | Dashboard UI |
| Build | Vite | Fast dev server and bundling |
| Backend | FastAPI, Python | Device simulation and API |
| Real-time | WebSockets | Live metric streaming |
| Styling | CSS Modules | Scoped component styles |

## Updating Production

Pull the latest and update everything in one command:

```bash
./scripts/update.sh
```

Options:
- `--no-pull` - Skip git pull (if you already pulled manually)
- `--backend` - Backend only (skip frontend rebuild)
- `--frontend` - Frontend only (skip backend restart)

The script handles: git pull, pip install, npm build, InfluxDB container check, and service restart (supports systemd, PM2, or bare uvicorn).

## Historical Data (InfluxDB)

Phase 11 adds time-series storage for device metrics, interface throughput, alerts, and speedtest results.

**Demo mode:** Works immediately with 7 days of seeded mock data. No setup needed.

**Production setup:**
```bash
./scripts/setup-influxdb.sh
```

This starts the InfluxDB container, creates retention buckets (30d raw, 1y hourly, 5y daily), and sets up downsampling tasks. Then add the config to `config/config.yaml`:

```yaml
influxdb:
  url: "http://localhost:8086"
  token: "your-token"
  org: "watchtower"
  bucket: "watchtower"
  enabled: true
```

Access the History page via the clock icon in the header nav.

## Why This Exists

Real NOC dashboards require production networks. MockWatchTower provides the same experience with simulated data, making it perfect for training new NOC analysts, demoing monitoring concepts, or showcasing network engineering skills.

## License

MIT
