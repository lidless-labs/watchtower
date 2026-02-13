<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
</p>

# 🗼 Solomon's MockWatchTower

**Real-time NOC dashboard with realistic network monitoring simulation.**

Monitor network devices, interfaces, uptime, alerts, and topology in a fully simulated Network Operations Center experience. Built for demos, training, and portfolio showcasing.

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

## Why This Exists

Real NOC dashboards require production networks. MockWatchTower provides the same experience with simulated data, making it perfect for training new NOC analysts, demoing monitoring concepts, or showcasing network engineering skills.

## License

MIT
