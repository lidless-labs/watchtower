<div align="center">

# 🗼 MockWatchtower

**A real-time Network Operations Center (NOC) dashboard for monitoring network infrastructure**

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![ReactFlow](https://img.shields.io/badge/ReactFlow-12-FF0072?logo=react&logoColor=white)](https://reactflow.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![WebSocket](https://img.shields.io/badge/WebSocket-Real--time-4353FF?logo=socketdotio&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![MockWatchtower](docs/screenshots/dashboard.png)

</div>

---

## ✨ Features

- **Interactive Topology Canvas** — Drag-and-drop network nodes with automatic position persistence using ReactFlow
- **L2/L3 View Modes** — Toggle between physical topology and logical VLAN groupings
- **Real-time Monitoring** — WebSocket-based live updates for device status, alerts, and traffic metrics
- **Cisco Port Grid** — Physical switch port visualization matching real hardware layout (24-port rows, SFP+ uplinks)
- **Port Group Monitoring** — Aggregate bandwidth tracking for groups of switch ports with CSV logging
- **Speedtest Widget** — Scheduled internet speed testing with CSV logging and link health coloring
- **Alert System** — Real-time alerts with severity levels, toast notifications, and critical overlays
- **Mermaid Diagrams** — Export topology as Mermaid diagrams with pan/zoom viewer
- **LibreNMS Integration** — Device status, health metrics, interface statistics, CDP/LLDP discovery
- **Proxmox Integration** — VM/LXC monitoring with Homarr-style panel per node
- **Netdisco Integration** — Layer 2 network discovery and device tracking
- **Auto-Discovery** — Automatic topology building from CDP/LLDP neighbor data
- **Demo Mode** — Full offline demo with simulated data for showcasing

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐ │
│  │ ReactFlow│  │ Sidebar  │  │ Alerts  │  │ Zustand │ │
│  │ Topology │  │ Panels   │  │ Overlay │  │ Stores  │ │
│  └────┬─────┘  └────┬─────┘  └────┬────┘  └────┬────┘ │
│       └──────────────┴─────────────┴─────────────┘      │
│                         │ WebSocket + REST                │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                  Backend (FastAPI)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ REST API │  │WebSocket │  │ Demo     │              │
│  │ Routers  │  │ Handler  │  │ Simulator│              │
│  └────┬─────┘  └────┬─────┘  └──────────┘              │
│       └──────────────┘                                   │
│              │                                           │
│  ┌───────────┼──────────────────────────┐               │
│  │     Polling Engines (APScheduler)     │               │
│  │  ┌─────────┐ ┌─────────┐ ┌────────┐ │               │
│  │  │LibreNMS │ │Netdisco │ │Proxmox │ │               │
│  │  │ Poller  │ │ Poller  │ │ Poller │ │               │
│  │  └─────────┘ └─────────┘ └────────┘ │               │
│  │  ┌─────────┐ ┌─────────┐            │               │
│  │  │Speedtest│ │CDP/LLDP │            │               │
│  │  │ Runner  │ │Discovery│            │               │
│  │  └─────────┘ └─────────┘            │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/solomonneas/watchtower.git
cd watchtower
docker compose up -d
```

Open [http://localhost:5173](http://localhost:5173)

### Option 2: Manual Setup

```bash
# Clone the repo
git clone https://github.com/solomonneas/watchtower.git
cd watchtower

# Backend (Terminal 1)
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (Terminal 2)
cd frontend
npm install
npm run dev -- --host
```

Open [http://localhost:5173](http://localhost:5173)

### Option 3: Proxmox LXC (Production)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/solomonneas/watchtower/main/install/create-lxc.sh)
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend Framework** | React 18, TypeScript 5, Vite |
| **Topology Engine** | ReactFlow (@xyflow/react) |
| **Styling** | Tailwind CSS, custom dark theme |
| **State Management** | Zustand |
| **Charts** | Recharts |
| **Backend Framework** | FastAPI, Python 3.11+ |
| **Real-time** | WebSocket (native) |
| **Task Scheduling** | APScheduler |
| **HTTP Client** | httpx (async) |
| **Configuration** | YAML (topology + config) |
| **Infrastructure** | Docker, Proxmox LXC, Nginx, systemd |

---

## 📁 Project Structure

```
mockwatchtower/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── config.py            # YAML config loader
│   │   ├── websocket.py         # WebSocket handler
│   │   ├── demo_data.py         # Static demo data
│   │   ├── demo_simulator.py    # Live demo simulator
│   │   ├── models/              # Pydantic models
│   │   ├── routers/             # API route handlers
│   │   ├── polling/             # LibreNMS, Netdisco, Proxmox pollers
│   │   ├── discovery/           # CDP/LLDP auto-discovery
│   │   └── notifications/       # Alert notification system
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Root app component
│   │   ├── main.tsx             # Entry point
│   │   ├── api/                 # REST & WebSocket clients
│   │   ├── components/
│   │   │   ├── Layout/          # Header, Sidebar, Layout
│   │   │   ├── Canvas/          # TopologyCanvas, nodes, edges
│   │   │   ├── Sidebar/         # DeviceCard, PortGrid, SpeedtestWidget
│   │   │   ├── Alerts/          # Toast, CriticalOverlay
│   │   │   └── common/          # StatusDot, Sparkline, UtilizationBar
│   │   ├── store/               # Zustand stores (noc, alert, settings)
│   │   ├── hooks/               # useWebSocket, useAlerts
│   │   ├── types/               # TypeScript interfaces
│   │   ├── demo/                # Mock data for demo mode
│   │   └── styles/              # Global CSS + Tailwind config
│   ├── index.html
│   ├── tailwind.config.js
│   └── vite.config.ts
├── config/
│   ├── config.example.yaml      # Service credentials template
│   ├── topology.example.yaml    # Network topology template
│   └── topology.demo.yaml       # Demo topology data
├── install/
│   ├── create-lxc.sh            # Proxmox LXC deployment
│   ├── install.sh               # Manual installation
│   └── dev.sh                   # Development setup
└── docs/
    └── topology-setup.md        # Topology configuration guide
```

---

## 🗺️ Topology Configuration

Watchtower uses YAML-based topology configuration to define your network layout. Connections between devices are auto-discovered from CDP/LLDP data, but you can also define manual connections.

```yaml
# config/topology.yaml

# Cluster Definitions — Groups of related devices
clusters:
  - id: firewalls
    name: Edge Firewalls
    type: firewall
    icon: shield
    position: { x: 400, y: 50 }
    devices:
      - fw-1
      - fw-2

  - id: core-switches
    name: Core Switches
    type: switch
    icon: switch
    position: { x: 400, y: 250 }
    devices:
      - sw-core-1
      - sw-core-2

# Device Metadata
devices:
  fw-1:
    display_name: Firewall Primary
    model: Palo Alto PA-450
    ip: 10.0.1.1
    location: Main Data Center
    role: primary

  sw-core-1:
    display_name: Core Switch 1
    model: Cisco Catalyst 9300-48P
    ip: 10.0.1.10
    location: Main Data Center

# Manual Connections (optional — CDP/LLDP handles most)
connections:
  - from: fw-1
    to: sw-core-1
    from_port: ethernet1/1
    to_port: GigabitEthernet1/0/1
```

See [`docs/topology-setup.md`](docs/topology-setup.md) for the full configuration reference.

---

## 🔌 Integrations

### LibreNMS
Polls device status, health metrics (CPU/memory/temperature), interface statistics, and CDP/LLDP neighbor data. Configure via `config/config.yaml`:

```yaml
librenms:
  url: https://librenms.example.com
  api_key: YOUR_API_KEY
```

### Netdisco
Layer 2 network discovery for supplementary device and connection data:

```yaml
netdisco:
  url: https://netdisco.example.com
  username: admin
  password: YOUR_PASSWORD
```

### Proxmox
Virtual machine and container monitoring with per-node dashboards:

```yaml
proxmox:
  url: https://proxmox.example.com:8006
  token_id: user@pam!token
  token_secret: YOUR_TOKEN_SECRET
```

### Speedtest
Scheduled internet speed testing with CSV logging and link health visualization:

```yaml
speedtest:
  enabled: true
  interval_minutes: 5
  server_id: auto
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/topology` | Full topology with live data (L2) |
| `GET` | `/api/topology/l3` | L3 topology grouped by VLAN |
| `GET` | `/api/devices` | All devices with status |
| `GET` | `/api/device/{id}` | Single device details |
| `GET` | `/api/alerts` | Active alerts |
| `GET` | `/api/vms` | Proxmox VMs with metrics |
| `GET` | `/api/vms/summary` | VM summary stats |
| `GET` | `/api/vms/node/{name}` | Proxmox node detail |
| `GET` | `/api/speedtest` | Latest speedtest result |
| `POST` | `/api/speedtest/trigger` | Run manual speedtest |
| `GET` | `/api/speedtest/export` | Download speedtest CSV |
| `GET` | `/api/port-groups` | Aggregate port group traffic |
| `GET` | `/api/port-groups/export/{name}` | Download port group CSV |
| `GET` | `/api/discovery/preview` | Preview auto-discovered devices |
| `POST` | `/api/discovery/sync` | Sync discovered devices to topology |
| `GET` | `/api/diagnostics/scheduler` | View polling job status |
| `POST` | `/api/diagnostics/poll/now` | Trigger immediate poll |
| `WS` | `/ws/updates` | Real-time event stream |

### WebSocket Events

```json
{"type": "device_status_change", "changes": [...]}
{"type": "new_alerts", "alerts": [...]}
{"type": "alerts_resolved", "alert_ids": [...]}
{"type": "speedtest_result", "result": {...}}
```

---

## ⏱️ Polling Schedule

| Data | Interval | Description |
|------|----------|-------------|
| Device Status | 30s | Up/down state, uptime |
| Interfaces | 60s | Port statistics, utilization |
| Health | 60s | CPU/memory metrics |
| Proxmox | 60s | Node and VM stats |
| Alerts | 30s | Active alert status |
| CDP/LLDP Links | 5min | Neighbor discovery |
| VLANs | 5min | VLAN membership for L3 view |
| Port Groups | 60s | Aggregate traffic with CSV logging |
| Speedtest | 5min | Internet speed (if enabled) |

---

## 🎯 Roadmap

- [x] Interactive topology canvas with L2/L3 views
- [x] LibreNMS integration (devices, health, interfaces, alerts)
- [x] Proxmox integration with per-node dashboards
- [x] Real-time WebSocket updates
- [x] CDP/LLDP auto-discovery
- [x] Cisco port grid visualization
- [x] Port group traffic monitoring with CSV export
- [x] Speedtest widget with link health coloring
- [x] Mermaid diagram export
- [x] Demo mode with simulated data
- [x] In-app guided tour & documentation
- [ ] JWT authentication & protected routes
- [ ] Settings modal UI
- [ ] SNMP trap receiver
- [ ] Multi-site support

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <sub>Built with ❤️ for network engineers who deserve better monitoring tools.</sub>
</div>
