# Phase 11: Historical Data & Trends

## Overview

Add time-series data collection and visualization to Watchtower. Currently the dashboard is point-in-time only. Phase 11 adds InfluxDB-backed historical storage so operators can see trends, correlate incidents, and track network health over time.

**Production:** InfluxDB 2.x via Docker, real polling data written every cycle.
**Demo mode (Vercel):** In-memory mock time-series data, same API shape, zero InfluxDB dependency.

---

## Backend

### 1. InfluxDB Integration (`backend/app/history/`)

#### New Files

| File | Purpose |
|------|---------|
| `backend/app/history/__init__.py` | Module init, exports `influx_client`, `history_writer`, `history_reader` |
| `backend/app/history/client.py` | InfluxDB 2.x async client wrapper (connect/disconnect/health) |
| `backend/app/history/writer.py` | Writes metric points after each poll cycle |
| `backend/app/history/reader.py` | Query functions for API endpoints (Flux queries) |
| `backend/app/history/demo_seeder.py` | Generates 7 days of realistic mock time-series for demo mode |
| `backend/app/history/demo_store.py` | In-memory time-series store for demo mode (no InfluxDB needed) |
| `backend/app/routers/history.py` | FastAPI router with history API endpoints |

#### InfluxDB Configuration

Add to `config.yaml` schema and `Settings`:

```yaml
influxdb:
  url: "http://localhost:8086"
  token: ""
  org: "watchtower"
  bucket: "watchtower"
  enabled: true
```

Add to `Settings` class in `config.py`:
```python
influxdb_url: str = "http://localhost:8086"
influxdb_token: str = ""
influxdb_org: str = "watchtower"
influxdb_bucket: str = "watchtower"
influxdb_enabled: bool = False
```

#### Measurements

**`device_metrics`** (written every poll_health cycle, ~60s)
- Tags: `device_id`, `device_type`, `location`
- Fields: `cpu` (float), `memory` (float), `temperature` (float, nullable), `uptime` (int)

**`interface_metrics`** (written every poll_interfaces cycle, ~60s)
- Tags: `device_id`, `interface_name`, `interface_status`
- Fields: `in_bps` (int), `out_bps` (int), `utilization` (float), `errors_in` (int), `errors_out` (int), `speed_mbps` (int)

**`alert_events`** (written on alert state changes)
- Tags: `device_id`, `severity`, `hostname`
- Fields: `title` (string), `state` (string: "active"/"resolved"), `alert_id` (int)

**`speedtest_results`** (written every speedtest poll cycle)
- Tags: `server_id`, `status`
- Fields: `download_mbps` (float), `upload_mbps` (float), `ping_ms` (float), `jitter_ms` (float)

**`network_summary`** (written every device_status poll, ~30s)
- Tags: (none)
- Fields: `devices_up` (int), `devices_down` (int), `total_devices` (int), `active_alerts` (int)

#### Retention Policies

Set up via InfluxDB bucket configuration (or tasks for downsampling):

| Bucket | Retention | Granularity | Purpose |
|--------|-----------|-------------|---------|
| `watchtower` | 30 days | Raw (poll interval) | Current operational data |
| `watchtower_hourly` | 1 year | 1-hour aggregates | Medium-term trends |
| `watchtower_daily` | 5 years | Daily aggregates | Long-term capacity planning |

InfluxDB tasks handle downsampling automatically:
- Every hour: aggregate `watchtower` → `watchtower_hourly` (mean, max, min)
- Every day: aggregate `watchtower_hourly` → `watchtower_daily` (mean, max, min)

#### Writer Integration

Hook into existing polling scheduler. After each poll function caches data to Redis, also write to InfluxDB:

```python
# In scheduler.py poll_health():
if influx_client.is_connected():
    await history_writer.write_device_metrics(health_data, device_configs)

# In scheduler.py poll_interfaces():
if influx_client.is_connected():
    await history_writer.write_interface_metrics(device_id, port_data)

# In scheduler.py broadcast_new_alerts() / broadcast_resolved_alerts():
if influx_client.is_connected():
    await history_writer.write_alert_events(alerts, state="active")

# In scheduler.py poll_speedtest():
if influx_client.is_connected():
    await history_writer.write_speedtest(result)
```

Use batch writes (InfluxDB write API batching) to minimize network overhead. Writer should be fire-and-forget (don't block polling on InfluxDB writes). Log errors but don't crash.

#### Reader (Query Functions)

```python
class HistoryReader:
    async def get_device_metrics(
        self, device_id: str, metric: str,
        start: str = "-24h", stop: str = "now()",
        aggregate_window: str = "5m"
    ) -> list[dict]:
        """Get time-series for a single device metric."""

    async def get_interface_metrics(
        self, device_id: str, interface_name: str,
        start: str = "-24h", stop: str = "now()",
        aggregate_window: str = "5m"
    ) -> list[dict]:
        """Get throughput/utilization for a specific interface."""

    async def get_network_summary(
        self, start: str = "-24h", stop: str = "now()",
        aggregate_window: str = "15m"
    ) -> list[dict]:
        """Get network-wide up/down/alert counts over time."""

    async def get_alert_timeline(
        self, start: str = "-7d", stop: str = "now()",
        device_id: str | None = None
    ) -> list[dict]:
        """Get alert events timeline."""

    async def get_speedtest_history(
        self, start: str = "-7d", stop: str = "now()"
    ) -> list[dict]:
        """Get speedtest results over time."""

    async def get_top_talkers(
        self, start: str = "-1h", limit: int = 10
    ) -> list[dict]:
        """Get interfaces with highest throughput."""
```

### 2. API Endpoints (`backend/app/routers/history.py`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/history/device/{device_id}/metrics` | Device CPU/memory/temp over time |
| GET | `/api/history/device/{device_id}/interfaces` | All interface throughput for a device |
| GET | `/api/history/device/{device_id}/interface/{interface_name}` | Single interface detail |
| GET | `/api/history/network/summary` | Network-wide health over time |
| GET | `/api/history/network/top-talkers` | Highest throughput interfaces |
| GET | `/api/history/alerts/timeline` | Alert events timeline |
| GET | `/api/history/speedtest` | Speedtest results over time |

**Common query params:**
- `range`: Time range preset ("1h", "6h", "24h", "7d", "30d") - default "24h"
- `start` / `stop`: ISO timestamps (override range if provided)
- `aggregate`: Window size ("1m", "5m", "15m", "1h", "1d") - auto-calculated from range if omitted

**Response format:**
```json
{
  "device_id": "core-sw-1",
  "metric": "cpu",
  "range": "24h",
  "aggregate_window": "5m",
  "points": [
    {"time": "2026-02-17T10:00:00Z", "value": 42.3},
    {"time": "2026-02-17T10:05:00Z", "value": 45.1}
  ]
}
```

### 3. Demo Mode (`backend/app/history/demo_seeder.py` + `demo_store.py`)

**demo_store.py:** In-memory dict-based time-series store. Same query interface as `HistoryReader` but reads from pre-generated arrays. No InfluxDB dependency.

**demo_seeder.py:** Generates 7 days of realistic data for all demo devices:
- **CPU/memory:** Sinusoidal base (business hours peak) + random noise + occasional spikes
- **Interface throughput:** Correlated with business hours, random burst events
- **Alerts:** Scatter 15-25 alert events across the week (realistic distribution)
- **Speedtest:** Stable baseline with occasional degradation events
- **Network summary:** Derived from device metrics

Data generation runs once at startup in demo mode. Uses seeded PRNG for deterministic output (same data every demo load).

### 4. Startup Integration (`backend/app/main.py`)

```python
# In lifespan():
if settings.demo_mode:
    # ... existing demo init ...
    from .history.demo_seeder import seed_demo_history
    from .history.demo_store import demo_history_store
    seed_demo_history(demo_history_store)
else:
    # ... existing production init ...
    if settings.influxdb_enabled:
        from .history.client import influx_client
        await influx_client.connect()
```

### 5. Docker Setup

**`docker-compose.yml`** (new file or add to existing):
```yaml
services:
  influxdb:
    image: influxdb:2.7
    container_name: watchtower-influxdb
    restart: unless-stopped
    ports:
      - "8086:8086"
    volumes:
      - influxdb-data:/var/lib/influxdb2
      - influxdb-config:/etc/influxdb2
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=admin
      - DOCKER_INFLUXDB_INIT_PASSWORD=watchtower-admin
      - DOCKER_INFLUXDB_INIT_ORG=watchtower
      - DOCKER_INFLUXDB_INIT_BUCKET=watchtower
      - DOCKER_INFLUXDB_INIT_RETENTION=30d
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=watchtower-dev-token

volumes:
  influxdb-data:
  influxdb-config:
```

Add `influxdb-client[async]` to `requirements.txt`.

---

## Frontend

### 1. New Page: History Dashboard (`frontend/src/pages/HistoryPage.tsx`)

Full-page history view accessible via hash route `#history`. Shows network-wide trends.

**Layout:**
- Time range selector bar (1h | 6h | 24h | 7d | 30d) - sticky top
- Network Health Overview (area chart: devices up/down over time)
- Alert Timeline (event scatter/bar chart)
- Top Talkers table (sortable: interface, device, throughput in/out)
- Speedtest Trend (line chart: download/upload/ping)

### 2. Device History Panel (integrated into DeviceCard)

When a device is selected, add a "History" tab/section to `DeviceCard.tsx`:

- **CPU & Memory chart:** Dual-axis area chart (CPU left, Memory right)
- **Interface Throughput chart:** Stacked area showing top 5 interfaces by traffic
- **Time range selector:** Same presets (1h, 6h, 24h, 7d, 30d)
- Lazy-loaded (only fetches when user expands the history section)

### 3. New Components

| Component | Purpose |
|-----------|---------|
| `frontend/src/components/History/TimeRangeSelector.tsx` | Pill-button time range picker |
| `frontend/src/components/History/MetricChart.tsx` | Recharts line/area chart wrapper for time-series |
| `frontend/src/components/History/AlertTimeline.tsx` | Alert event timeline (bar chart with severity colors) |
| `frontend/src/components/History/TopTalkers.tsx` | Sortable table of highest-throughput interfaces |
| `frontend/src/components/History/NetworkHealthChart.tsx` | Network-wide up/down/degraded area chart |
| `frontend/src/components/History/SpeedtestChart.tsx` | Download/upload/ping trend lines |
| `frontend/src/components/History/DeviceHistoryPanel.tsx` | History section for device detail sidebar |

### 4. Store Changes (`frontend/src/store/historyStore.ts`)

```typescript
interface HistoryState {
  timeRange: '1h' | '6h' | '24h' | '7d' | '30d'
  networkSummary: TimeSeriesPoint[] | null
  alertTimeline: AlertEvent[] | null
  topTalkers: TopTalker[] | null
  speedtestHistory: TimeSeriesPoint[] | null
  deviceMetrics: Record<string, DeviceMetricData> // keyed by device_id
  isLoading: boolean

  setTimeRange: (range: string) => void
  fetchNetworkSummary: () => Promise<void>
  fetchAlertTimeline: () => Promise<void>
  fetchTopTalkers: () => Promise<void>
  fetchSpeedtestHistory: () => Promise<void>
  fetchDeviceMetrics: (deviceId: string) => Promise<void>
}
```

### 5. API Client (`frontend/src/api/endpoints.ts`)

Add new fetch functions:
```typescript
export async function fetchDeviceHistory(deviceId: string, range: string): Promise<...>
export async function fetchNetworkSummary(range: string): Promise<...>
export async function fetchAlertTimeline(range: string): Promise<...>
export async function fetchTopTalkers(range: string): Promise<...>
export async function fetchSpeedtestHistory(range: string): Promise<...>
```

### 6. Navigation

Add `#history` route to `App.tsx` (same pattern as `#docs`):
```typescript
if (route === '/history' || route === 'history') {
  return <HistoryPage />
}
```

Add "History" link to the header nav (in `Header.tsx`), icon: clock/chart.

### 7. Demo Mode Frontend

When `demoMode` is true, API calls hit the same endpoints (backend serves from `demo_store`). No frontend branching needed. The demo seeder guarantees 7 days of interesting data.

---

## Design Notes

### Chart Styling
- Match existing dark theme (bg-bg-primary, text-text-primary, etc.)
- Accent colors: `#39d5ff` (cyan) for primary metric, `#a855f7` (purple) for secondary
- Grid lines: `border-border-default` opacity
- Tooltip: dark bg with noc-style values
- Responsive: charts resize with container, minimum useful width ~300px

### Performance
- Backend: Flux queries with `aggregateWindow()` to limit point count (max ~500 points per chart)
- Frontend: Recharts with `isAnimationActive={false}` for large datasets
- Lazy load history data (don't fetch until page/panel is visible)
- Device history: fetch on expand, cache in store

### Error Handling
- If InfluxDB is down/unreachable: log warning, history endpoints return empty arrays, dashboard still works (current data from Redis unaffected)
- Demo mode: always works, no external dependencies
- Frontend: show "No historical data available" placeholder if endpoints return empty

---

## File Inventory (New/Modified)

### New Files
```
backend/app/history/__init__.py
backend/app/history/client.py
backend/app/history/writer.py
backend/app/history/reader.py
backend/app/history/demo_seeder.py
backend/app/history/demo_store.py
backend/app/routers/history.py
frontend/src/pages/HistoryPage.tsx
frontend/src/components/History/TimeRangeSelector.tsx
frontend/src/components/History/MetricChart.tsx
frontend/src/components/History/AlertTimeline.tsx
frontend/src/components/History/TopTalkers.tsx
frontend/src/components/History/NetworkHealthChart.tsx
frontend/src/components/History/SpeedtestChart.tsx
frontend/src/components/History/DeviceHistoryPanel.tsx
frontend/src/store/historyStore.ts
docker-compose.yml (or docker-compose.influxdb.yml)
specs/phase-11-historical-data.md (this file)
```

### Modified Files
```
backend/requirements.txt              — add influxdb-client[async]
backend/app/config.py                 — add InfluxDB settings
backend/app/main.py                   — add InfluxDB lifecycle + history router
backend/app/polling/scheduler.py      — add history writes after each poll
frontend/src/App.tsx                   — add #history route
frontend/src/api/endpoints.ts          — add history fetch functions
frontend/src/components/Layout/Header.tsx — add History nav link
frontend/src/components/Sidebar/DeviceCard.tsx — add history section/tab
```

---

## Implementation Order

1. **Backend core:** InfluxDB client, writer, reader, config changes
2. **Backend API:** History router + endpoints
3. **Backend demo:** Demo seeder + in-memory store
4. **Backend integration:** Hook writer into polling scheduler + lifespan
5. **Frontend API:** Endpoint functions + history store
6. **Frontend page:** HistoryPage + all chart components
7. **Frontend device:** DeviceHistoryPanel integrated into DeviceCard
8. **Docker:** docker-compose for InfluxDB
9. **Test:** Verify demo mode on Vercel, verify production mode with local InfluxDB
