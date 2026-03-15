#!/bin/bash
set -euo pipefail

INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="seajelly-gateway"
CONFIG_DIR="/etc/seajelly"
CONFIG_PATH="${CONFIG_DIR}/gateway.json"
ENV_PATH="${CONFIG_DIR}/gateway.env"
REPO="your-username/seajelly"
VERSION="latest"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)  ARCH_SUFFIX="amd64" ;;
  aarch64|arm64) ARCH_SUFFIX="arm64" ;;
  *)             error "Unsupported architecture: $ARCH" ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
if [ "$OS" != "linux" ]; then
  error "This installer is for Linux only. Detected: $OS"
fi

BINARY_NAME="seajelly-gateway-linux-${ARCH_SUFFIX}"

info "Detected: Linux ${ARCH_SUFFIX}"

if [ -n "${GATEWAY_DOWNLOAD_URL:-}" ]; then
  DOWNLOAD_URL="$GATEWAY_DOWNLOAD_URL"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/${VERSION}/download/${BINARY_NAME}"
fi

info "Downloading ${BINARY_NAME}..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "/tmp/${BINARY_NAME}" "$DOWNLOAD_URL" || error "Download failed. Check URL: $DOWNLOAD_URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "/tmp/${BINARY_NAME}" "$DOWNLOAD_URL" || error "Download failed. Check URL: $DOWNLOAD_URL"
else
  error "Neither curl nor wget found. Install one and retry."
fi

chmod +x "/tmp/${BINARY_NAME}"
info "Installing binary to ${INSTALL_DIR}/seajelly-gateway..."
if [ -w "$INSTALL_DIR" ]; then
  mv "/tmp/${BINARY_NAME}" "${INSTALL_DIR}/seajelly-gateway"
else
  sudo mv "/tmp/${BINARY_NAME}" "${INSTALL_DIR}/seajelly-gateway"
fi

echo ""
echo "============================================"
echo "  SEAJelly Edge Gateway - Quick Setup"
echo "============================================"
echo ""

read -r -p "Gateway Secret (leave empty to auto-generate): " SECRET_INPUT
if [ -z "$SECRET_INPUT" ]; then
  SECRET_INPUT=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')
  info "Auto-generated secret: ${SECRET_INPUT}"
fi

read -r -p "Listen port [9100]: " PORT_INPUT
PORT_INPUT=${PORT_INPUT:-9100}

read -r -p "Supabase URL (optional, only if gateway.json references it): " SUPA_URL
read -r -p "Supabase Service Role Key (optional): " SUPA_KEY

info "Ensuring ${CONFIG_DIR} exists..."
if [ -d "$CONFIG_DIR" ]; then
  :
elif [ -w "$(dirname "$CONFIG_DIR")" ]; then
  mkdir -p "$CONFIG_DIR"
else
  sudo mkdir -p "$CONFIG_DIR"
fi

if [ ! -f "$CONFIG_PATH" ]; then
  info "Writing default config to ${CONFIG_PATH}"
  cat > /tmp/seajelly-gateway.json <<'JSONEOF'
{
  "version": "v1",
  "sources": [
    {
      "id": "voice-settings",
      "kind": "supabase_rest_kv",
      "url_env": "SUPABASE_URL",
      "service_key_env": "SUPABASE_SERVICE_ROLE_KEY",
      "table": "voice_settings",
      "key_column": "key",
      "value_column": "value",
      "cache_ttl_ms": 30000
    }
  ],
  "routes": [
    {
      "id": "wecom-http",
      "capability": "platform.wecom.http",
      "kind": "http_forward",
      "path": "/routes/wecom/http",
      "allowed_hosts": ["qyapi.weixin.qq.com"]
    },
    {
      "id": "wecom-media-upload",
      "capability": "platform.wecom.media-upload",
      "kind": "multipart_upload",
      "path": "/routes/wecom/upload",
      "allowed_hosts": ["qyapi.weixin.qq.com"],
      "form_field_name": "media"
    },
    {
      "id": "doubao-asr-ws",
      "capability": "voice.doubao-asr.ws",
      "kind": "ws_relay",
      "path": "/routes/voice/doubao-asr",
      "upstream": {
        "url": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel",
        "headers": {
          "X-Api-App-Key": {
            "source": "voice-settings",
            "key": "doubao_app_key"
          },
          "X-Api-Access-Key": {
            "source": "voice-settings",
            "key": "doubao_access_key"
          },
          "X-Api-Resource-Id": {
            "value": "volc.bigasr.sauc.duration"
          },
          "X-Api-Connect-Id": {
            "generated": "uuid"
          }
        }
      }
    }
  ]
}
JSONEOF
  if [ -w "$CONFIG_DIR" ]; then
    mv /tmp/seajelly-gateway.json "$CONFIG_PATH"
  else
    sudo mv /tmp/seajelly-gateway.json "$CONFIG_PATH"
  fi
else
  warn "Config already exists at ${CONFIG_PATH}; leaving it unchanged."
fi

cat > /tmp/seajelly-gateway.env <<EOF
# Optional upstream source values for gateway.json
SUPABASE_URL=${SUPA_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPA_KEY}
EOF
if [ -w "$CONFIG_DIR" ]; then
  mv /tmp/seajelly-gateway.env "$ENV_PATH"
else
  sudo mv /tmp/seajelly-gateway.env "$ENV_PATH"
fi

if [ -d /etc/systemd/system ]; then
  info "Creating systemd service..."
  cat > /tmp/seajelly-gateway.service <<SERVICEEOF
[Unit]
Description=SEAJelly Edge Gateway
After=network.target

[Service]
Type=simple
EnvironmentFile=-${ENV_PATH}
ExecStart=${INSTALL_DIR}/seajelly-gateway --port ${PORT_INPUT} --secret "${SECRET_INPUT}" --config ${CONFIG_PATH}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

  if [ -w /etc/systemd/system ]; then
    mv /tmp/seajelly-gateway.service /etc/systemd/system/
  else
    sudo mv /tmp/seajelly-gateway.service /etc/systemd/system/
  fi

  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}"
  sudo systemctl restart "${SERVICE_NAME}"

  sleep 2
  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    info "Service started successfully."
  else
    warn "Service may have failed to start. Check: journalctl -u ${SERVICE_NAME} -f"
  fi
else
  warn "systemd not found. Run manually:"
  echo "  ${INSTALL_DIR}/seajelly-gateway --port ${PORT_INPUT} --secret \"${SECRET_INPUT}\" --config ${CONFIG_PATH}"
fi

echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "  Config:  ${CONFIG_PATH}"
echo "  Env:     ${ENV_PATH}"
echo "  Port:    ${PORT_INPUT}"
echo "  Secret:  ${SECRET_INPUT}"
echo ""
echo "  Test:    curl -H 'X-Gateway-Secret: ${SECRET_INPUT}' http://localhost:${PORT_INPUT}/manifest"
echo ""
echo "  Edit ${CONFIG_PATH} to add or change routes."
echo "  Restart after changes: sudo systemctl restart ${SERVICE_NAME}"
echo "  Logs: journalctl -u ${SERVICE_NAME} -f"
echo "============================================"
