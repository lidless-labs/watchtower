#!/usr/bin/env bash

# Watchtower NOC Dashboard Installer
# Run inside an LXC container or VM
# Usage: bash install.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR="/opt/watchtower"
APP_USER="watchtower"
BOOTSTRAP_ENV="/etc/watchtower/bootstrap.env"
REPO_URL="${WATCHTOWER_REPO_URL:-https://github.com/solomonneas/watchtower.git}"
REPO_REF="${WATCHTOWER_REPO_REF:-main}"
SOURCE_DIR="${WATCHTOWER_SOURCE_DIR:-}"

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════╗"
echo "║       Watchtower NOC Dashboard            ║"
echo "║           Installation Script             ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Detect OS
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS=$ID
else
    echo -e "${RED}Cannot detect OS${NC}"
    exit 1
fi

echo -e "${YELLOW}Detected OS: $OS $VERSION_ID${NC}"

# Install dependencies
echo -e "\n${GREEN}=== Installing Dependencies ===${NC}"

if [[ "$OS" == "debian" ]] || [[ "$OS" == "ubuntu" ]]; then
    apt-get update
    apt-get install -y \
        python3 \
        python3-venv \
        python3-pip \
        redis-server \
        nginx \
        curl \
        git \
        sudo \
        ca-certificates \
        openssh-server

    echo -e "${GREEN}Ensuring SSH service is installed...${NC}"
    if [[ "${WATCHTOWER_ENABLE_SSH_PASSWORD_LOGIN:-false}" == "true" ]]; then
        echo -e "${YELLOW}WATCHTOWER_ENABLE_SSH_PASSWORD_LOGIN=true, enabling SSH password auth and root login...${NC}"
        sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
        sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
        # Ubuntu 24.04 uses a drop-in that overrides - disable it
        if [[ -f /etc/ssh/sshd_config.d/60-cloudimg-settings.conf ]]; then
            sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config.d/60-cloudimg-settings.conf
        fi
    else
        echo -e "${YELLOW}Leaving SSH authentication defaults unchanged. Set WATCHTOWER_ENABLE_SSH_PASSWORD_LOGIN=true to opt in.${NC}"
    fi
    systemctl enable ssh
    systemctl restart ssh

    # Install Node.js 20
    if ! command -v node &> /dev/null; then
        echo -e "${GREEN}Installing Node.js 20...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
else
    echo -e "${RED}Unsupported OS: $OS${NC}"
    exit 1
fi

# Create app user
echo -e "\n${GREEN}=== Creating Application User ===${NC}"
id -u $APP_USER &>/dev/null || useradd -r -s /bin/bash -d $APP_DIR -m $APP_USER

# Clone or update repository
echo -e "\n${GREEN}=== Downloading Watchtower ===${NC}"
if [[ -n "$SOURCE_DIR" ]]; then
    if [[ ! -d "$SOURCE_DIR" ]]; then
        echo -e "${RED}WATCHTOWER_SOURCE_DIR does not exist: $SOURCE_DIR${NC}"
        exit 1
    fi

    echo "Installing from local source directory: $SOURCE_DIR"
    rm -rf "$APP_DIR"
    mkdir -p "$APP_DIR"
    tar \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='frontend/dist' \
        --exclude='backend/venv' \
        --exclude='backend/.venv' \
        --exclude='.venv' \
        -C "$SOURCE_DIR" -cf - . | tar -C "$APP_DIR" -xf -
elif [[ -d "$APP_DIR/.git" ]]; then
    echo "Updating existing installation..."
    cd "$APP_DIR"
    git remote set-url origin "$REPO_URL"
    git fetch --depth=1 origin "$REPO_REF"
    git reset --hard FETCH_HEAD
else
    rm -rf "$APP_DIR"
    mkdir -p "$APP_DIR"
    git -C "$APP_DIR" init
    git -C "$APP_DIR" remote add origin "$REPO_URL"
    git -C "$APP_DIR" fetch --depth=1 origin "$REPO_REF"
    git -C "$APP_DIR" checkout --force FETCH_HEAD
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Setup Python environment
echo -e "\n${GREEN}=== Setting Up Python Environment ===${NC}"
cd $APP_DIR/backend
sudo -u $APP_USER python3 -m venv venv
sudo -u $APP_USER $APP_DIR/backend/venv/bin/pip install --upgrade pip
sudo -u $APP_USER $APP_DIR/backend/venv/bin/pip install -r requirements.txt

# Setup Node environment
echo -e "\n${GREEN}=== Setting Up Frontend ===${NC}"
cd $APP_DIR/frontend
sudo -u $APP_USER npm install

# Build frontend for production
echo -e "\n${GREEN}=== Building Frontend ===${NC}"
sudo -u $APP_USER npm run build

# Create config if not exists
if [[ ! -f "$APP_DIR/config/config.yaml" ]]; then
    echo -e "\n${GREEN}=== Creating Configuration ===${NC}"
    cp $APP_DIR/config/config.example.yaml $APP_DIR/config/config.yaml
    chown $APP_USER:$APP_USER $APP_DIR/config/config.yaml
    chmod 600 $APP_DIR/config/config.yaml
fi

# Create runtime data directories used by configured CSV logging.
install -d -o $APP_USER -g $APP_USER -m 750 /opt/watchtower/data /var/lib/watchtower

# Production first-login bootstrap requires an out-of-band token. The token is
# only honored while the admin password hash is empty.
echo -e "\n${GREEN}=== Creating Bootstrap Token ===${NC}"
install -d -o root -g root -m 700 /etc/watchtower
if [[ ! -f "$BOOTSTRAP_ENV" ]]; then
    BOOTSTRAP_TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
    printf 'WATCHTOWER_BOOTSTRAP_TOKEN=%s\n' "$BOOTSTRAP_TOKEN" > "$BOOTSTRAP_ENV"
    chmod 600 "$BOOTSTRAP_ENV"
else
    BOOTSTRAP_TOKEN=$(sed -n 's/^WATCHTOWER_BOOTSTRAP_TOKEN=//p' "$BOOTSTRAP_ENV" | head -n1)
fi

# Create systemd service for backend
echo -e "\n${GREEN}=== Creating Systemd Services ===${NC}"
cat > /etc/systemd/system/watchtower.service << EOF
[Unit]
Description=Watchtower NOC Dashboard Backend
After=network.target redis-server.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
Environment=PATH=$APP_DIR/backend/venv/bin:/usr/bin
Environment=CONFIG_PATH=$APP_DIR/config/config.yaml
Environment=TOPOLOGY_PATH=$APP_DIR/config/topology.yaml
EnvironmentFile=-$BOOTSTRAP_ENV
# --proxy-headers trusts X-Forwarded-For/-Proto from the local nginx (default
# trusted IP is 127.0.0.1) so the app sees real client IPs and the original
# scheme, which gates the Secure flag on the session cookie under HTTPS.
ExecStart=$APP_DIR/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/config $APP_DIR/data /var/lib/watchtower
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx
echo -e "\n${GREEN}=== Configuring Nginx ===${NC}"
cat > /etc/nginx/sites-available/watchtower << 'EOF'
server {
    listen 80;
    server_name _;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' ws: wss: https://vitals.vercel-insights.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; script-src 'self' https://cdn.jsdelivr.net" always;

    # Frontend (production build)
    location / {
        root /opt/watchtower/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:8000;
    }

    # Readiness check
    location /ready {
        proxy_pass http://127.0.0.1:8000;
    }
}
EOF

ln -sf /etc/nginx/sites-available/watchtower /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx config
nginx -t

# Enable and start services
echo -e "\n${GREEN}=== Starting Services ===${NC}"
systemctl daemon-reload
systemctl enable redis-server
systemctl enable watchtower
systemctl enable nginx

systemctl start redis-server
systemctl restart watchtower
systemctl restart nginx

# Get IP address
IP_ADDR=$(hostname -I | awk '{print $1}')

# Test health
echo -e "\n${GREEN}=== Testing Installation ===${NC}"
healthy=false
for _ in $(seq 1 30); do
    if curl -s http://127.0.0.1:8000/health | grep -q "healthy"; then
        healthy=true
        break
    fi
    sleep 1
done

if [[ "$healthy" == "true" ]]; then
    echo -e "${GREEN}Backend is running!${NC}"
else
    echo -e "${YELLOW}Backend did not become healthy within 30 seconds. Check: journalctl -u watchtower -n 100 --no-pager${NC}"
fi

echo -e "\n${CYAN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       Installation Complete!              ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "Access Watchtower at: ${GREEN}http://$IP_ADDR${NC}"
echo -e "First login URL: ${GREEN}http://$IP_ADDR/?bootstrap_token=$BOOTSTRAP_TOKEN${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC} $APP_DIR/config/config.yaml"
echo -e "${YELLOW}Bootstrap token file:${NC} $BOOTSTRAP_ENV"
echo -e "${YELLOW}Logs:${NC} journalctl -u watchtower -f"
echo ""
echo -e "${YELLOW}Commands:${NC}"
echo "  systemctl status watchtower   # Check status"
echo "  systemctl restart watchtower  # Restart backend"
echo "  cd $APP_DIR && git pull       # Update code"
echo ""
