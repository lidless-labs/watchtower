import { useState } from 'react'

type DocSection =
  | 'overview'
  | 'topology'
  | 'devices'
  | 'portgrid'
  | 'alerts'
  | 'integrations'
  | 'websocket'
  | 'faq'

interface NavItem {
  id: DocSection
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: '📖' },
  { id: 'topology', label: 'Topology Config', icon: '🗺️' },
  { id: 'devices', label: 'Device Monitoring', icon: '🖥️' },
  { id: 'portgrid', label: 'Port Grid', icon: '🔌' },
  { id: 'alerts', label: 'Alerts', icon: '🔔' },
  { id: 'integrations', label: 'Integrations', icon: '🔗' },
  { id: 'websocket', label: 'WebSocket API', icon: '⚡' },
  { id: 'faq', label: 'FAQ', icon: '❓' },
]

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="my-4 rounded-lg overflow-hidden border border-border-default">
      {title && (
        <div className="px-4 py-2 bg-bg-tertiary border-b border-border-default text-xs text-text-muted font-mono">
          {title}
        </div>
      )}
      <pre className="p-4 bg-bg-primary text-sm text-text-secondary overflow-x-auto font-mono leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold text-text-primary mt-8 mb-4 flex items-center gap-2">{children}</h2>
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">{children}</h3>
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p className="text-text-secondary leading-relaxed mb-4">{children}</p>
}

function ListItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-text-secondary mb-2">
      <span className="text-accent-cyan mt-1">•</span>
      <span>{children}</span>
    </li>
  )
}

function OverviewSection() {
  return (
    <div>
      <SectionHeading>📖 Overview</SectionHeading>
      <Paragraph>
        MockWatchtower is a Network Operations Center (NOC) dashboard designed for real-time
        monitoring and visualization of network infrastructure. It provides an interactive topology
        canvas, device monitoring, port-level visibility, and integration with popular network
        management tools.
      </Paragraph>

      <SubHeading>Key Capabilities</SubHeading>
      <ul className="mb-4">
        <ListItem>Interactive drag-and-drop topology canvas with L2/L3 views</ListItem>
        <ListItem>Real-time device status monitoring via WebSocket</ListItem>
        <ListItem>Physical switch port grid visualization</ListItem>
        <ListItem>Alert system with severity levels and toast notifications</ListItem>
        <ListItem>Integration with LibreNMS, Netdisco, and Proxmox</ListItem>
        <ListItem>Internet speed testing with historical tracking</ListItem>
        <ListItem>YAML-based topology configuration</ListItem>
        <ListItem>Full offline demo mode with simulated data</ListItem>
      </ul>

      <SubHeading>Architecture</SubHeading>
      <Paragraph>
        The frontend is built with React, TypeScript, and ReactFlow for the topology canvas.
        Zustand manages global state. The backend uses FastAPI with APScheduler for periodic polling
        of network services. Real-time updates flow through WebSocket connections.
      </Paragraph>
      <CodeBlock title="Data Flow">{`React + ReactFlow (UI)
    │
    ├── REST API ──→ FastAPI ──→ Polling Engines ──→ LibreNMS / Netdisco / Proxmox
    │
    └── WebSocket ──→ FastAPI ──→ Real-time Events (status changes, alerts, speedtest)`}</CodeBlock>
    </div>
  )
}

function TopologySection() {
  return (
    <div>
      <SectionHeading>🗺️ Topology Configuration</SectionHeading>
      <Paragraph>
        Network topology is defined in YAML files under the <code className="text-accent-cyan bg-bg-tertiary px-1.5 py-0.5 rounded text-sm">config/</code> directory.
        You define clusters (groups of devices), individual device metadata, and optional manual connections.
      </Paragraph>

      <SubHeading>Clusters</SubHeading>
      <Paragraph>
        Clusters group related devices and define their position on the canvas. Each cluster has an
        ID, display name, type, icon, position, and list of device IDs.
      </Paragraph>
      <CodeBlock title="config/topology.yaml">{`clusters:
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
      - sw-core-2`}</CodeBlock>

      <SubHeading>Device Metadata</SubHeading>
      <Paragraph>
        Each device can have a display name, model, IP address, location, and role. If using
        LibreNMS, you can add a <code className="text-accent-cyan bg-bg-tertiary px-1.5 py-0.5 rounded text-sm">librenms_hostname</code> for explicit matching.
      </Paragraph>
      <CodeBlock title="config/topology.yaml">{`devices:
  fw-1:
    display_name: Firewall Primary
    model: Palo Alto PA-450
    ip: 10.0.1.1
    location: Main Data Center
    role: primary
    # librenms_hostname: fw-1.example.com

  sw-core-1:
    display_name: Core Switch 1
    model: Cisco Catalyst 9300-48P
    ip: 10.0.1.10`}</CodeBlock>

      <SubHeading>Connections</SubHeading>
      <Paragraph>
        Most connections are auto-discovered via CDP/LLDP, but you can define manual connections
        for devices that don't participate in neighbor discovery.
      </Paragraph>
      <CodeBlock title="config/topology.yaml">{`connections:
  - from: fw-1
    to: sw-core-1
    from_port: ethernet1/1
    to_port: GigabitEthernet1/0/1`}</CodeBlock>
    </div>
  )
}

function DeviceMonitoringSection() {
  return (
    <div>
      <SectionHeading>🖥️ Device Monitoring</SectionHeading>
      <Paragraph>
        Click any device node on the topology canvas to open its detail panel in the sidebar.
        The device card shows:
      </Paragraph>
      <ul className="mb-4">
        <ListItem><strong>Status</strong> — Up, Down, Degraded, or Unknown with color-coded indicator</ListItem>
        <ListItem><strong>Model &amp; IP</strong> — Hardware model and management IP address</ListItem>
        <ListItem><strong>Health Metrics</strong> — CPU utilization, memory usage, temperature</ListItem>
        <ListItem><strong>Uptime</strong> — Time since last reboot</ListItem>
        <ListItem><strong>Interface List</strong> — All ports with speed, utilization, and error counts</ListItem>
        <ListItem><strong>Proxmox Panel</strong> — For server nodes, shows VMs, LXCs, and storage</ListItem>
      </ul>

      <SubHeading>Device Status Colors</SubHeading>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="flex items-center gap-2 p-3 bg-bg-tertiary rounded-lg">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-text-secondary text-sm"><strong>Green</strong> — Device is up and healthy</span>
        </div>
        <div className="flex items-center gap-2 p-3 bg-bg-tertiary rounded-lg">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-text-secondary text-sm"><strong>Red</strong> — Device is down or unreachable</span>
        </div>
        <div className="flex items-center gap-2 p-3 bg-bg-tertiary rounded-lg">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-text-secondary text-sm"><strong>Amber</strong> — Device is degraded</span>
        </div>
        <div className="flex items-center gap-2 p-3 bg-bg-tertiary rounded-lg">
          <div className="w-3 h-3 rounded-full bg-gray-500" />
          <span className="text-text-secondary text-sm"><strong>Gray</strong> — Status unknown</span>
        </div>
      </div>
    </div>
  )
}

function PortGridSection() {
  return (
    <div>
      <SectionHeading>🔌 Port Grid</SectionHeading>
      <Paragraph>
        The Port Grid is a visual representation of a physical switch chassis. It mirrors the
        actual hardware layout of Cisco Catalyst switches with rows of 24 ports (12 odd on top,
        12 even on bottom) plus dedicated SFP+ uplink ports.
      </Paragraph>

      <SubHeading>Port Color Coding</SubHeading>
      <ul className="mb-4">
        <ListItem><strong>Green</strong> — Port is up and active with traffic</ListItem>
        <ListItem><strong>Dark green</strong> — Port is up but idle (low utilization)</ListItem>
        <ListItem><strong>Red</strong> — Port has errors or is in error-disabled state</ListItem>
        <ListItem><strong>Gray</strong> — Port is administratively down</ListItem>
        <ListItem><strong>Dark/empty</strong> — Port is not connected</ListItem>
      </ul>

      <SubHeading>Port Details</SubHeading>
      <Paragraph>
        Click any port square to see detailed information: port name, alias/description, speed,
        admin/operational status, traffic statistics (in/out bps), utilization percentage, error
        counts, PoE status, and trunk/VLAN info.
      </Paragraph>

      <SubHeading>Port Search</SubHeading>
      <Paragraph>
        Use the Port Search widget in the sidebar to find ports by name, alias, VLAN, or MAC
        address across all devices.
      </Paragraph>
    </div>
  )
}

function AlertsSection() {
  return (
    <div>
      <SectionHeading>🔔 Alerts</SectionHeading>
      <Paragraph>
        Watchtower monitors your network for issues and generates alerts with three severity levels:
      </Paragraph>

      <div className="space-y-3 mb-4">
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="font-semibold text-red-400 mb-1">🔴 Critical</div>
          <div className="text-text-secondary text-sm">
            Device down, high packet loss, or service outage. Triggers a full-screen overlay
            and persistent toast notification.
          </div>
        </div>
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="font-semibold text-amber-400 mb-1">🟡 Warning</div>
          <div className="text-text-secondary text-sm">
            High CPU/memory, degraded performance, or approaching thresholds. Shows as a toast
            notification that auto-dismisses after 10 seconds.
          </div>
        </div>
        <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="font-semibold text-blue-400 mb-1">🔵 Info</div>
          <div className="text-text-secondary text-sm">
            Configuration changes, device reboots, or informational events. Brief toast notification.
          </div>
        </div>
      </div>

      <Paragraph>
        The bell icon in the header shows the count of active alerts. Click it to review all
        current alerts. Alerts are synced in real-time via WebSocket.
      </Paragraph>
    </div>
  )
}

function IntegrationsSection() {
  return (
    <div>
      <SectionHeading>🔗 Integrations</SectionHeading>

      <SubHeading>LibreNMS</SubHeading>
      <Paragraph>
        Primary integration for network device monitoring. Watchtower polls LibreNMS for:
      </Paragraph>
      <ul className="mb-4">
        <ListItem>Device status (up/down/disabled) — polled every 30 seconds</ListItem>
        <ListItem>Health metrics (CPU, memory, temperature) — polled every 60 seconds</ListItem>
        <ListItem>Interface statistics (speed, utilization, errors) — polled every 60 seconds</ListItem>
        <ListItem>CDP/LLDP neighbor data — polled every 5 minutes</ListItem>
        <ListItem>Active alerts — polled every 30 seconds</ListItem>
        <ListItem>VLAN membership — polled every 5 minutes</ListItem>
      </ul>
      <CodeBlock title="config/config.yaml">{`librenms:
  url: https://librenms.example.com
  api_key: YOUR_LIBRENMS_API_KEY`}</CodeBlock>

      <SubHeading>Netdisco</SubHeading>
      <Paragraph>
        Supplements LibreNMS with Layer 2 discovery data. Useful for networks where CDP/LLDP
        coverage is incomplete.
      </Paragraph>
      <CodeBlock title="config/config.yaml">{`netdisco:
  url: https://netdisco.example.com
  username: admin
  password: YOUR_PASSWORD`}</CodeBlock>

      <SubHeading>Proxmox</SubHeading>
      <Paragraph>
        Monitors Proxmox Virtual Environment nodes. Each server node in the topology that runs
        Proxmox gets a dedicated panel showing:
      </Paragraph>
      <ul className="mb-4">
        <ListItem>Running and stopped VMs with resource usage</ListItem>
        <ListItem>LXC containers with status</ListItem>
        <ListItem>Storage pool utilization (including Ceph)</ListItem>
        <ListItem>Node-level CPU and memory stats</ListItem>
      </ul>
      <CodeBlock title="config/config.yaml">{`proxmox:
  url: https://proxmox.example.com:8006
  token_id: user@pam!token
  token_secret: YOUR_TOKEN_SECRET`}</CodeBlock>

      <SubHeading>Speedtest</SubHeading>
      <Paragraph>
        Runs periodic internet speed tests using the Ookla speedtest CLI. Results are logged to
        CSV for historical tracking and used to color external links on the topology canvas.
      </Paragraph>
      <CodeBlock title="config/config.yaml">{`speedtest:
  enabled: true
  interval_minutes: 5
  server_id: auto  # or specific server ID`}</CodeBlock>
    </div>
  )
}

function WebSocketSection() {
  return (
    <div>
      <SectionHeading>⚡ WebSocket API</SectionHeading>
      <Paragraph>
        Connect to the WebSocket endpoint at <code className="text-accent-cyan bg-bg-tertiary px-1.5 py-0.5 rounded text-sm">ws://&lt;host&gt;:8000/ws/updates</code> to
        receive real-time events. The connection auto-reconnects on disconnection with exponential backoff.
      </Paragraph>

      <SubHeading>Event Types</SubHeading>

      <div className="space-y-4 mb-4">
        <div>
          <div className="text-sm font-semibold text-accent-cyan mb-2">device_status_change</div>
          <Paragraph>Fired when one or more devices change status (up → down, etc).</Paragraph>
          <CodeBlock>{`{
  "type": "device_status_change",
  "changes": [
    {
      "device_id": "sw-core-1",
      "old_status": "up",
      "new_status": "down",
      "timestamp": "2025-02-07T12:34:56Z"
    }
  ]
}`}</CodeBlock>
        </div>

        <div>
          <div className="text-sm font-semibold text-accent-cyan mb-2">new_alerts</div>
          <Paragraph>Fired when new alerts are generated.</Paragraph>
          <CodeBlock>{`{
  "type": "new_alerts",
  "alerts": [
    {
      "id": "alert-001",
      "severity": "critical",
      "device_id": "sw-core-1",
      "message": "Device unreachable",
      "timestamp": "2025-02-07T12:34:56Z"
    }
  ]
}`}</CodeBlock>
        </div>

        <div>
          <div className="text-sm font-semibold text-accent-cyan mb-2">alerts_resolved</div>
          <Paragraph>Fired when alerts are resolved/cleared.</Paragraph>
          <CodeBlock>{`{
  "type": "alerts_resolved",
  "alert_ids": ["alert-001", "alert-002"]
}`}</CodeBlock>
        </div>

        <div>
          <div className="text-sm font-semibold text-accent-cyan mb-2">speedtest_result</div>
          <Paragraph>Fired when a new speed test completes.</Paragraph>
          <CodeBlock>{`{
  "type": "speedtest_result",
  "result": {
    "download_mbps": 940.5,
    "upload_mbps": 450.2,
    "ping_ms": 3.1,
    "jitter_ms": 0.8,
    "timestamp": "2025-02-07T12:34:56Z"
  }
}`}</CodeBlock>
        </div>
      </div>
    </div>
  )
}

function FAQSection() {
  return (
    <div>
      <SectionHeading>❓ FAQ</SectionHeading>

      <div className="space-y-6">
        <div>
          <SubHeading>How do I add a new device?</SubHeading>
          <Paragraph>
            Add the device to a cluster in <code className="text-accent-cyan bg-bg-tertiary px-1.5 py-0.5 rounded text-sm">config/topology.yaml</code> and
            define its metadata in the <code className="text-accent-cyan bg-bg-tertiary px-1.5 py-0.5 rounded text-sm">devices</code> section.
            If the device is in LibreNMS, Watchtower will automatically pull its status and metrics.
            Connections are auto-discovered from CDP/LLDP.
          </Paragraph>
        </div>

        <div>
          <SubHeading>Can I use Watchtower without LibreNMS?</SubHeading>
          <Paragraph>
            Yes! Watchtower includes a full demo mode with simulated data. For production without
            LibreNMS, you would need to implement custom polling or use SNMP directly (planned for
            a future release).
          </Paragraph>
        </div>

        <div>
          <SubHeading>How does auto-discovery work?</SubHeading>
          <Paragraph>
            Watchtower polls CDP/LLDP neighbor data from LibreNMS every 5 minutes. New neighbors
            are presented in the discovery preview endpoint. You can review and sync them to your
            topology configuration.
          </Paragraph>
        </div>

        <div>
          <SubHeading>What browsers are supported?</SubHeading>
          <Paragraph>
            Watchtower works in all modern browsers: Chrome, Firefox, Safari, and Edge. The topology
            canvas requires WebGL support (available in all modern browsers). Mobile is supported
            with a responsive sidebar overlay.
          </Paragraph>
        </div>

        <div>
          <SubHeading>How do I export my topology as a diagram?</SubHeading>
          <Paragraph>
            Click the Mermaid button in the topology canvas controls to generate a Mermaid diagram
            of your current view. The diagram opens in a pan/zoom viewer and can be copied to
            clipboard or used in documentation.
          </Paragraph>
        </div>

        <div>
          <SubHeading>Is there authentication?</SubHeading>
          <Paragraph>
            Authentication is planned for Phase 7 (JWT login with protected routes). Currently,
            Watchtower should be deployed behind a VPN or reverse proxy with authentication.
          </Paragraph>
        </div>

        <div>
          <SubHeading>Can I monitor multiple sites?</SubHeading>
          <Paragraph>
            Multi-site support is on the roadmap. Currently, each Watchtower instance monitors a
            single site. You can run multiple instances with different topology configurations.
          </Paragraph>
        </div>
      </div>
    </div>
  )
}

const SECTION_COMPONENTS: Record<DocSection, () => JSX.Element> = {
  overview: OverviewSection,
  topology: TopologySection,
  devices: DeviceMonitoringSection,
  portgrid: PortGridSection,
  alerts: AlertsSection,
  integrations: IntegrationsSection,
  websocket: WebSocketSection,
  faq: FAQSection,
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<DocSection>('overview')
  const SectionContent = SECTION_COMPONENTS[activeSection]

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-3">
          <a href="/" className="text-accent-cyan text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
            <span className="text-text-primary">WATCH</span>TOWER
          </a>
          <span className="text-[10px] text-text-tertiary font-medium tracking-widest uppercase border border-border-default rounded px-1.5 py-0.5">
            S³
          </span>
          <span className="text-text-muted">|</span>
          <span className="text-text-secondary text-sm font-medium">Documentation</span>
        </div>
        <a
          href="/"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary bg-bg-tertiary hover:bg-bg-tertiary/80 rounded-md transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Dashboard
        </a>
      </header>

      <div className="flex">
        {/* Sidebar Navigation */}
        <nav className="w-56 flex-shrink-0 border-r border-border-default bg-bg-secondary min-h-[calc(100vh-3.5rem)] p-4">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
            Sections
          </div>
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                    activeSection === item.id
                      ? 'bg-accent-cyan/10 text-accent-cyan font-medium'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <main className="flex-1 p-8 max-w-4xl">
          <SectionContent />
        </main>
      </div>
    </div>
  )
}
