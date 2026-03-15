# SEAJelly Edge Gateway

中文说明: [README.zh-CN.md](./README.zh-CN.md)

Config-driven single-binary gateway for serverless deployments that need:

1. Static-IP outbound forwarding for allowlisted APIs such as WeCom
2. Long-lived WebSocket relays for browser-only or backend-only upstream services such as Doubao ASR

The gateway is driven by `gateway.json`. Adding a new forwarding target means updating JSON and restarting the binary, not recompiling Go code.

## What Changed

- HTTP forwarding, multipart upload forwarding, and WebSocket relay are generic route kinds
- Routes are discovered through `GET /manifest`
- Sensitive upstream values come from external sources, not from hardcoded Go logic
- Legacy fixed routes like `/proxy`, `/upload`, and `/ws/doubao-asr` are removed

## Quick Start

```bash
./seajelly-gateway \
  --port 9100 \
  --secret "your-secret" \
  --config /etc/seajelly/gateway.json
```

If you only need static-IP HTTP forwarding, the command above is enough.

If you want browser clients to connect through `wss://` or `https://`, the gateway entrypoint itself must actually speak TLS. In practice that means one of these must be true:

- Start the gateway with `--cert` and `--key`
- Or terminate TLS in front of the gateway with another proxy/load balancer

Example:

```bash
./seajelly-gateway \
  --port 9100 \
  --secret "your-secret" \
  --config /etc/seajelly/gateway.json \
  --cert /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

If you keep the gateway on plain HTTP, server-side use cases such as WeCom static-IP forwarding still work, but HTTPS pages in the browser will not be allowed to open `ws://` connections for ASR.

Startup output includes:

```text
SEAJelly Edge Gateway v2.0.0
Public IP:      1.2.3.4
Listen:         :9100
Gateway Secret: your-secret
Config:         /etc/seajelly/gateway.json
Health:         http://1.2.3.4:9100/health
Manifest:       http://1.2.3.4:9100/manifest
Routes:
  - platform.wecom.http          http_forward     /routes/wecom/http
  - platform.wecom.media-upload  multipart_upload /routes/wecom/upload
  - voice.doubao-asr.ws          ws_relay         /routes/voice/doubao-asr
```

## Configuration File

Use [`config.example.json`](./config.example.json) as the baseline.

```json
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
          "X-Api-App-Key": { "source": "voice-settings", "key": "doubao_app_key" },
          "X-Api-Access-Key": { "source": "voice-settings", "key": "doubao_access_key" },
          "X-Api-Resource-Id": { "value": "volc.bigasr.sauc.duration" },
          "X-Api-Connect-Id": { "generated": "uuid" }
        }
      }
    }
  ]
}
```

### Supported Source Kinds

- `supabase_rest_kv`
  - Reads a key/value table through PostgREST
  - Supabase project URL and service role key are injected via env vars referenced by `url_env` and `service_key_env`
- `env`
  - Reads values from process env vars
  - Supports direct lookups, `prefix`, or explicit `key_to_env` mappings

### Supported Route Kinds

- `http_forward`
  - Expects a JSON body containing `url`, `method`, `headers`, `body`
  - Target hostname must match `allowed_hosts`
- `multipart_upload`
  - Expects `url`, `file_name`, `file_data` (base64), `mime_type`
  - Upload form field name comes from `form_field_name`
- `ws_relay`
  - Bridges browser WebSocket frames to a fixed upstream URL
  - Header values can be resolved from:
    - `value`
    - `source` + `key`
    - `env`
    - `generated: "uuid"`

## Public Endpoints

All endpoints require `X-Gateway-Secret` or `?secret=`:

- `GET /health`
  - Returns basic status, version, config version, and route count
- `GET /manifest`
  - Returns public route metadata only: version, config version, public IP, routes, capabilities
- Route paths declared in `gateway.json`
  - Example: `/routes/wecom/http`, `/routes/wecom/upload`, `/routes/voice/doubao-asr`

## Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/your-username/seajelly/main/tools/edge-gateway/install.sh | bash
```

The installer will:

- Download the correct statically linked binary
- Write `/etc/seajelly/gateway.json` if it does not exist
- Write `/etc/seajelly/gateway.env` for optional source env vars
- Install a `systemd` service that runs `--config /etc/seajelly/gateway.json`

After changing `gateway.json`, restart the service:

```bash
sudo systemctl restart seajelly-gateway
```

If you need direct HTTPS/WSS on the gateway port, add `--cert` and `--key` to the final service command or place the gateway behind an existing TLS-enabled entrypoint.

## Build From Source

Requires Go 1.22+.

```bash
cd tools/edge-gateway

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-amd64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-arm64
```

## Security Notes

- Every endpoint is secret-protected
- `http_forward` and `multipart_upload` are restricted by `allowed_hosts`
- Manifest output never includes source definitions or resolved secret values
- WebSocket credentials can be sourced from Supabase or env vars without storing them in `gateway.json`
