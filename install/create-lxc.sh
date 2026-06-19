#!/usr/bin/env bash

# Watchtower LXC Container Creator
# Run this on your Proxmox host
# Usage: bash create-lxc.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

HOSTNAME="watchtower"
MEMORY=2048
CORES=2
DISK=32

# Ref the installer is fetched from and that the installer itself checks out.
# Pin this to a release tag (e.g. v1.2.3) or commit SHA for reproducible,
# tamper-evident installs; see docs/release.md.
REPO_REF="${WATCHTOWER_REPO_REF:-main}"
INSTALL_URL="https://raw.githubusercontent.com/solomonneas/watchtower/${REPO_REF}/install/install.sh"

# Expected sha256 of install/install.sh. When set, the downloaded installer is
# verified before it runs and the install aborts on any mismatch (defends
# against a compromised account, MITM, or CDN cache poisoning serving a tampered
# script to a root context). Publish this alongside each release tag.
EXPECTED_SHA256="${WATCHTOWER_INSTALL_SHA256:-}"

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════╗"
echo "║    Watchtower LXC Container Creator       ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Find next available CTID
echo -e "${GREEN}Finding next available container ID...${NC}"
CTID=$(pvesh get /cluster/nextid)
echo -e "Next available CTID: ${YELLOW}$CTID${NC}"
echo ""

# Get available bridges/bonds
echo -e "${GREEN}Available network bridges:${NC}"
BRIDGES=$(ip -br link show type bridge | awk '{print $1}')
i=1
declare -A BRIDGE_MAP
for br in $BRIDGES; do
    echo "  $i) $br"
    BRIDGE_MAP[$i]=$br
    ((i++))
done
echo ""

read -p "Select bridge [1]: " BRIDGE_CHOICE
BRIDGE_CHOICE=${BRIDGE_CHOICE:-1}
BRIDGE=${BRIDGE_MAP[$BRIDGE_CHOICE]:-vmbr0}
echo -e "Selected: ${YELLOW}$BRIDGE${NC}"
echo ""

# VLAN tag
read -p "VLAN tag (leave empty for none): " VLAN_TAG
if [[ -n "$VLAN_TAG" ]]; then
    echo -e "VLAN: ${YELLOW}$VLAN_TAG${NC}"
fi
echo ""

# IP configuration
echo -e "${GREEN}IP Configuration:${NC}"
echo "  1) DHCP (automatic)"
echo "  2) Static IP"
echo ""
read -p "Select IP mode [1]: " IP_MODE
IP_MODE=${IP_MODE:-1}

if [[ "$IP_MODE" == "2" ]]; then
    read -p "IP address (e.g., 192.168.1.100/24): " STATIC_IP
    read -p "Gateway (e.g., 192.168.1.1): " GATEWAY

    # Validate IP address format (CIDR notation)
    if [[ ! "$STATIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$ ]]; then
        echo -e "${RED}Invalid IP format. Expected: x.x.x.x/xx. Falling back to DHCP.${NC}"
        IP_CONFIG="dhcp"
    elif [[ ! "$GATEWAY" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "${RED}Invalid gateway format. Expected: x.x.x.x. Falling back to DHCP.${NC}"
        IP_CONFIG="dhcp"
    else
        IP_CONFIG="$STATIC_IP,gw=$GATEWAY"
        echo -e "Static IP: ${YELLOW}$STATIC_IP${NC}"
        echo -e "Gateway: ${YELLOW}$GATEWAY${NC}"
    fi
else
    IP_CONFIG="dhcp"
    echo -e "IP Mode: ${YELLOW}DHCP${NC}"
fi
echo ""

# Firewall
read -p "Enable firewall? (y/N): " FIREWALL_CHOICE
if [[ "$FIREWALL_CHOICE" =~ ^[Yy]$ ]]; then
    FIREWALL=1
    echo -e "Firewall: ${YELLOW}Enabled${NC}"
else
    FIREWALL=0
    echo -e "Firewall: ${YELLOW}Disabled${NC}"
fi
echo ""

# Root password
echo -e "${GREEN}Container root password:${NC}"
while true; do
    read -s -p "Enter password: " ROOT_PASSWORD
    echo ""
    read -s -p "Confirm password: " ROOT_PASSWORD_CONFIRM
    echo ""
    if [[ "$ROOT_PASSWORD" == "$ROOT_PASSWORD_CONFIRM" ]]; then
        if [[ -z "$ROOT_PASSWORD" ]]; then
            echo -e "${RED}Password cannot be empty.${NC}"
        else
            echo -e "Password: ${YELLOW}(set)${NC}"
            break
        fi
    else
        echo -e "${RED}Passwords do not match. Try again.${NC}"
    fi
done
echo ""

# Storage selection
echo -e "${GREEN}Available storage:${NC}"
STORAGES=$(pvesm status -content rootdir | awk 'NR>1 {print $1}')
i=1
declare -A STORAGE_MAP
for st in $STORAGES; do
    echo "  $i) $st"
    STORAGE_MAP[$i]=$st
    ((i++))
done
echo ""

read -p "Select storage [1]: " STORAGE_CHOICE
STORAGE_CHOICE=${STORAGE_CHOICE:-1}
STORAGE=${STORAGE_MAP[$STORAGE_CHOICE]:-local-lvm}
echo -e "Selected: ${YELLOW}$STORAGE${NC}"
echo ""

# Summary
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}           Configuration Summary           ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "  Container ID: ${YELLOW}$CTID${NC}"
echo -e "  Hostname:     ${YELLOW}$HOSTNAME${NC}"
echo -e "  Memory:       ${YELLOW}${MEMORY}MB${NC}"
echo -e "  Cores:        ${YELLOW}$CORES${NC}"
echo -e "  Disk:         ${YELLOW}${DISK}GB${NC}"
echo -e "  Storage:      ${YELLOW}$STORAGE${NC}"
echo -e "  Bridge:       ${YELLOW}$BRIDGE${NC}"
if [[ -n "$VLAN_TAG" ]]; then
echo -e "  VLAN:         ${YELLOW}$VLAN_TAG${NC}"
fi
if [[ "$IP_CONFIG" == "dhcp" ]]; then
echo -e "  IP:           ${YELLOW}DHCP${NC}"
else
echo -e "  IP:           ${YELLOW}$STATIC_IP${NC}"
echo -e "  Gateway:      ${YELLOW}$GATEWAY${NC}"
fi
echo -e "  Firewall:     ${YELLOW}$([ $FIREWALL -eq 1 ] && echo 'Yes' || echo 'No')${NC}"
echo -e "  Root Password: ${YELLOW}(set)${NC}"
echo ""

read -p "Proceed with creation? (Y/n): " CONFIRM
if [[ "$CONFIRM" =~ ^[Nn]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Find template
TEMPLATE=$(pveam list local 2>/dev/null | grep -E "ubuntu-24" | head -1 | awk '{print $1}')

if [[ -z "$TEMPLATE" ]]; then
    echo -e "${YELLOW}No suitable template found. Downloading Ubuntu 24.04...${NC}"
    pveam update
    pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst
    TEMPLATE="local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst"
fi

echo -e "${GREEN}Using template: $TEMPLATE${NC}"

# Build network config
NET_CONFIG="name=eth0,bridge=$BRIDGE,ip=$IP_CONFIG,firewall=$FIREWALL"
if [[ -n "$VLAN_TAG" ]]; then
    NET_CONFIG="${NET_CONFIG},tag=$VLAN_TAG"
fi

# Create container
echo -e "\n${GREEN}Creating LXC container...${NC}"
pct create "$CTID" "$TEMPLATE" \
    --hostname "$HOSTNAME" \
    --memory "$MEMORY" \
    --cores "$CORES" \
    --rootfs "$STORAGE:$DISK" \
    --net0 "$NET_CONFIG" \
    --unprivileged 1 \
    --features nesting=1 \
    --onboot 1 \
    --password "$ROOT_PASSWORD"

# Start container
echo -e "${GREEN}Starting container...${NC}"
pct start "$CTID"

# Wait for network (IP)
echo -e "${GREEN}Waiting for network...${NC}"
for i in {1..30}; do
    IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
    if [[ -n "$IP" ]]; then
        break
    fi
    sleep 1
done

if [[ -z "$IP" ]]; then
    echo -e "${YELLOW}Could not detect IP. Container may still be starting.${NC}"
    IP="<container-ip>"
fi

echo -e "${GREEN}Container IP: $IP${NC}"

# Wait for DNS to be ready
echo -e "${GREEN}Waiting for DNS...${NC}"
for i in {1..30}; do
    if pct exec "$CTID" -- ping -c1 github.com &>/dev/null; then
        echo -e "${GREEN}DNS is ready${NC}"
        break
    fi
    sleep 2
done

# Update package lists first
echo -e "\n${GREEN}Updating package lists...${NC}"
pct exec "$CTID" -- apt-get update

# Install curl if not present
echo -e "${GREEN}Ensuring curl is installed...${NC}"
pct exec "$CTID" -- apt-get install -y curl

# Run installer. Download to a file first (instead of curl | bash) so a
# truncated transfer can never execute a half-fetched script, verify its
# checksum when one is pinned, and pass the same ref through so the installer
# checks out exactly what we fetched.
echo -e "\n${GREEN}Running Watchtower installer (ref: $REPO_REF)...${NC}"
if [ -z "$EXPECTED_SHA256" ]; then
    echo -e "${YELLOW}WARNING: WATCHTOWER_INSTALL_SHA256 is not set, so the downloaded installer"
    echo -e "         cannot be integrity-verified. For tamper-evident installs, pin"
    echo -e "         WATCHTOWER_REPO_REF to a release tag and set WATCHTOWER_INSTALL_SHA256"
    echo -e "         to the published sha256 of install/install.sh.${NC}"
fi
# Build the remote command with the values interpolated by the outer shell, then
# verify and run entirely inside the container.
REMOTE_INSTALL_CMD="set -euo pipefail
curl -fsSL '$INSTALL_URL' -o /tmp/watchtower-install.sh
expected='$EXPECTED_SHA256'
actual=\$(sha256sum /tmp/watchtower-install.sh | awk '{print \$1}')
if [ -n \"\$expected\" ] && [ \"\$expected\" != \"\$actual\" ]; then
  echo \"Installer checksum mismatch: expected \$expected got \$actual\" >&2
  rm -f /tmp/watchtower-install.sh
  exit 1
fi
WATCHTOWER_REPO_REF='$REPO_REF' bash /tmp/watchtower-install.sh"
if ! pct exec "$CTID" -- bash -c "$REMOTE_INSTALL_CMD"; then
    echo -e "${RED}Installer failed! Enter container to debug:${NC}"
    echo "  pct enter $CTID"
    exit 1
fi

echo -e "\n${CYAN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              Setup Complete!              ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "Watchtower is running at: ${GREEN}http://$IP${NC}"
echo ""
echo -e "${YELLOW}Container management:${NC}"
echo "  pct enter $CTID              # Enter container shell"
echo "  pct stop $CTID               # Stop container"
echo "  pct start "$CTID"              # Start container"
echo "  pct destroy $CTID            # Delete container"
echo ""
echo -e "${YELLOW}Logs:${NC}"
echo "  pct exec "$CTID" -- journalctl -u watchtower -f"
echo ""
