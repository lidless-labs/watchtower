<!-- content-guard: allow infrastructure/private-hostname file -->
# Topology Configuration Guide

This guide explains how to configure `config/topology.yaml` for your network environment.

## Overview

The topology file defines:
- **Clusters** - Logical groupings of devices (firewalls, switches, servers)
- **Devices** - Individual network devices with metadata
- **Connections** - Physical and virtual links between devices
- **External Links** - WAN/upstream connections

> **Note:** `topology.yaml` is gitignored because it contains environment-specific IPs. Each deployment needs its own configuration.

## File Structure

```yaml
clusters:
  - id: cluster-id
    name: Display Name
    type: firewall|switch|server|access_point
    icon: shield|switch|server|wifi
    position: { x: 100, y: 200 }
    devices:
      - device-id-1
      - device-id-2

devices:
  device-id-1:
    display_name: Human Readable Name
    librenms_hostname: hostname-in-librenms
    model: Device Model
    ip: 10.x.x.x
    location: Physical Location

connections:
  - id: unique-connection-id
    source: { device: device-id, port: eth0 }
    target: { device: other-device, port: Gi1/0/1 }
    connection_type: trunk|access|uplink|stack|management
    speed: 1000
    description: "Connection description"

external_links:
  - id: wan-link-id
    source: { device: edge-device, port: Gi1/1 }
    target:
      label: ISP Name
      type: campus|ix|cloud
      icon: building|globe|cloud
    provider: Provider Name
    speed: 10000
```

## Adding a New Device

### Step 1: Add to LibreNMS (if monitored via SNMP)

For Linux/LXC containers, install and configure SNMP first:

```bash
apt install -y snmpd snmp

# Edit /etc/snmp/snmpd.conf
agentaddress udp:161
rocommunity YOUR_COMMUNITY default
view systemonly included .1.3.6.1.2.1.1
view systemonly included .1.3.6.1.2.1.2
view systemonly included .1.3.6.1.2.1.25
view systemonly included .1.3.6.1.4.1.2021

systemctl restart snmpd && systemctl enable snmpd
```

Then add to LibreNMS via the web UI or CLI.

### Step 2: Add device to a cluster

Find the appropriate cluster in `topology.yaml` and add the device ID:

```yaml
clusters:
  - id: management
    name: Management Servers
    devices:
      - existing-device
      - new-device-id    # Add here
```

### Step 3: Add device metadata

```yaml
devices:
  new-device-id:
    display_name: My New Server
    librenms_hostname: myserver.domain.local  # Must match LibreNMS
    model: Ubuntu 24.04 LTS
    ip: 10.x.x.x
    location: Rack A - Room 101
```

### Step 4: Add connections

See "Connection Types" below for the appropriate type.

### Step 5: Restart the backend

```bash
sudo systemctl restart watchtower
```

## Connection Types

| Type | Use Case | Visual Style |
|------|----------|--------------|
| `trunk` | Switch-to-switch, tagged VLANs | Solid line |
| `access` | End devices, single VLAN | Solid line |
| `uplink` | WAN/upstream connections | Solid line |
| `stack` | HA pairs, stacking cables | Solid line |
| `management` | VM-to-hypervisor relationships | Dashed line |
| `peer` | BGP/routing peers | Solid line |

## Adding VM-to-Hypervisor Connections

VMs and containers should show their relationship to the host. Use `connection_type: management`:

```yaml
connections:
  - id: myvm-to-host
    source: { device: my-vm }
    target: { device: proxmox1 }
    connection_type: management
    speed: 10000
    description: "My VM on Proxmox1"
```

These render as dashed lines on the topology canvas.

## Physical vs Discovered Connections

### Auto-discovered (CDP/LLDP)

- Switch-to-switch links are discovered automatically via LibreNMS
- These don't need manual entries in `topology.yaml`
- The aggregator merges discovered links with static definitions

### Manual definition required

These device types don't support CDP/LLDP and need manual connection entries:
- Firewalls
- Servers (physical)
- Hypervisors
- VMs and containers
- Access points
- Any device without CDP/LLDP enabled

## External Links

For WAN connections to external networks:

```yaml
external_links:
  - id: wan-to-isp
    source: { device: edge-router, port: Gi0/0 }
    target:
      label: ISP Name
      type: cloud      # campus, ix, or cloud
      icon: cloud      # building, globe, or cloud
    provider: Provider Name
    speed: 1000
    description: "Primary WAN"
```

External link types affect the visual styling:
- `campus` - Amber glow (other campus locations)
- `ix` - Purple glow (internet exchanges)
- `cloud` - Cyan glow (internet/cloud providers)

## Creating a New Cluster

```yaml
clusters:
  - id: my-new-cluster        # Unique ID (kebab-case)
    name: My New Cluster      # Display name
    type: server              # firewall, switch, server, access_point
    icon: server              # shield, switch, server, wifi
    position: { x: 300, y: 400 }  # Initial position on canvas
    devices:
      - device-1
      - device-2
```

## Verification

After making changes, verify the topology loads correctly:

```bash
# Restart backend
sudo systemctl restart watchtower

# Check device count
curl -s http://localhost:8000/api/topology | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(f\"Devices: {len(d['devices'])} | Connections: {len(d['connections'])}\")
"

# Check for unlinked devices
curl -s http://localhost:8000/api/topology | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
device_ids = set(d['devices'].keys())
connected = set()
for c in d['connections']:
    src = c.get('source', {}).get('device')
    tgt = c.get('target', {}).get('device')
    if src: connected.add(src)
    if tgt: connected.add(tgt)
unlinked = device_ids - connected
if unlinked:
    print('Unlinked:', ', '.join(sorted(unlinked)))
else:
    print('All devices connected')
"
```

## Example: Adding a Proxmox LXC

1. Configure SNMP on the LXC (see Step 1 above)
2. Add to LibreNMS via web UI
3. Add to `topology.yaml`:

```yaml
clusters:
  - id: management
    devices:
      - my-new-lxc    # Add to cluster

devices:
  my-new-lxc:
    display_name: My Service
    librenms_hostname: my-new-lxc
    model: Debian Linux (LXC)
    ip: 10.x.x.x
    location: proxmox1 - Server Room

connections:
  - id: my-new-lxc-vm
    source: { device: my-new-lxc }
    target: { device: proxmox1 }
    connection_type: management
    speed: 10000
    description: "My Service LXC on Proxmox1"
```

4. Restart and verify:

```bash
sudo systemctl restart watchtower
```
