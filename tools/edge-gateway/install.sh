#!/bin/bash
set -e

INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="opencrab-gateway"
REPO="your-username/opencrab"
VERSION="latest"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)  ARCH_SUFFIX="amd64" ;;
  aarch64|arm64)  ARCH_SUFFIX="arm64" ;;
  *)              error "Unsupported architecture: $ARCH" ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
if [ "$OS" != "linux" ]; then
  error "This installer is for Linux only. Detected: $OS"
fi

BINARY_NAME="opencrab-gateway-linux-${ARCH_SUFFIX}"

info "Detected: Linux ${ARCH_SUFFIX}"

# Download binary
if [ -n "$GATEWAY_DOWNLOAD_URL" ]; then
  DOWNLOAD_URL="$GATEWAY_DOWNLOAD_URL"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/${VERSION}/download/${BINARY_NAME}"
fi

info "Downloading ${BINARY_NAME}..."
if command -v curl &>/dev/null; then
  curl -fsSL -o /tmp/${BINARY_NAME} "$DOWNLOAD_URL" || error "Download failed. Check URL: $DOWNLOAD_URL"
elif command -v wget &>/dev/null; then
  wget -q -O /tmp/${BINARY_NAME} "$DOWNLOAD_URL" || error "Download failed. Check URL: $DOWNLOAD_URL"
else
  error "Neither curl nor wget found. Install one and retry."
fi

# Install binary
info "Installing to ${INSTALL_DIR}/opencrab-gateway..."
chmod +x /tmp/${BINARY_NAME}
if [ -w "$INSTALL_DIR" ]; then
  mv /tmp/${BINARY_NAME} ${INSTALL_DIR}/opencrab-gateway
else
  sudo mv /tmp/${BINARY_NAME} ${INSTALL_DIR}/opencrab-gateway
fi

# Verify installation
if opencrab-gateway --help &>/dev/null 2>&1 || ${INSTALL_DIR}/opencrab-gateway --help &>/dev/null 2>&1; then
  info "Binary installed successfully."
else
  warn "Binary installed but could not verify. Check: ${INSTALL_DIR}/opencrab-gateway"
fi

# Interactive setup
echo ""
echo "============================================"
echo "  OpenCrab Edge Gateway - Quick Setup"
echo "============================================"
echo ""

read -p "Gateway Secret (leave empty to auto-generate): " SECRET_INPUT
if [ -z "$SECRET_INPUT" ]; then
  SECRET_INPUT=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')
  info "Auto-generated secret: ${SECRET_INPUT}"
fi

read -p "Listen port [9100]: " PORT_INPUT
PORT_INPUT=${PORT_INPUT:-9100}

read -p "Supabase URL (optional, for Doubao ASR proxy): " SUPA_URL
read -p "Supabase Service Role Key (optional): " SUPA_KEY

# Create systemd service
if [ -d /etc/systemd/system ]; then
  info "Creating systemd service..."

  EXEC_CMD="${INSTALL_DIR}/opencrab-gateway --port ${PORT_INPUT} --secret \"${SECRET_INPUT}\""
  if [ -n "$SUPA_URL" ] && [ -n "$SUPA_KEY" ]; then
    EXEC_CMD="${EXEC_CMD} --supabase-url \"${SUPA_URL}\" --supabase-key \"${SUPA_KEY}\""
  fi

  cat > /tmp/opencrab-gateway.service <<SERVICEEOF
[Unit]
Description=OpenCrab Edge Gateway
After=network.target

[Service]
Type=simple
ExecStart=${EXEC_CMD}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

  if [ -w /etc/systemd/system ]; then
    mv /tmp/opencrab-gateway.service /etc/systemd/system/
  else
    sudo mv /tmp/opencrab-gateway.service /etc/systemd/system/
  fi

  sudo systemctl daemon-reload
  sudo systemctl enable opencrab-gateway
  sudo systemctl start opencrab-gateway

  sleep 2
  if systemctl is-active --quiet opencrab-gateway; then
    info "Service started successfully!"
  else
    warn "Service may have failed to start. Check: journalctl -u opencrab-gateway -f"
  fi
else
  warn "systemd not found. Run manually:"
  echo "  opencrab-gateway --port ${PORT_INPUT} --secret \"${SECRET_INPUT}\""
fi

echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "  Port:    ${PORT_INPUT}"
echo "  Secret:  ${SECRET_INPUT}"
echo ""
echo "  Test:    curl -H 'X-Gateway-Secret: ${SECRET_INPUT}' http://localhost:${PORT_INPUT}/health"
echo ""
echo "  Copy the Secret and your server's public IP to"
echo "  OpenCrab Dashboard → Settings → Edge Gateway"
echo ""
echo "  Logs:    journalctl -u opencrab-gateway -f"
echo "  Restart: sudo systemctl restart opencrab-gateway"
echo "  Stop:    sudo systemctl stop opencrab-gateway"
echo "============================================"
