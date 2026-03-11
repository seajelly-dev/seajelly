# SEAJelly Edge Gateway

A single-binary gateway service that solves two Serverless (Vercel) pain points:

1. **Static IP Proxy** — Forward HTTP API calls (e.g. WeCom) through a fixed-IP host to satisfy IP whitelist requirements. Vercel's official solution costs $100/month for 2 static IPs.
2. **WebSocket Relay** — Proxy real-time WebSocket connections (e.g. Doubao ASR) that Vercel cannot maintain. Credentials are fetched from Supabase at runtime — nothing is hardcoded on the gateway host.

---

## One-Line Install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/your-username/seajelly/main/tools/edge-gateway/install.sh | bash
```

The script will:
- Auto-detect your CPU architecture (amd64/arm64)
- Download the pre-built binary
- Walk you through secret/port configuration interactively
- Create and start a systemd service automatically

> **No Go, Node.js, or any runtime required.** The binary is statically compiled and self-contained (~7MB).

### Manual Install

```bash
# Download (choose your arch)
wget https://github.com/your-username/seajelly/releases/latest/download/seajelly-gateway-linux-amd64
chmod +x seajelly-gateway-linux-amd64
mv seajelly-gateway-linux-amd64 /usr/local/bin/seajelly-gateway

# Run
seajelly-gateway --port 9100 --secret "your-secret"
```

---

## Quick Start

```bash
# HTTP proxy only (WeCom)
seajelly-gateway --port 9100 --secret "your-secret"

# Full mode (HTTP proxy + Doubao ASR WebSocket relay)
seajelly-gateway \
  --port 9100 \
  --secret "your-secret" \
  --supabase-url "https://xxx.supabase.co" \
  --supabase-key "eyJ..."
```

Startup output:

```
SEAJelly Edge Gateway v1.0.0
Public IP:      1.2.3.4
Listen:         :9100
Gateway Secret: your-secret
HTTP Proxy:     http://1.2.3.4:9100/proxy
WS Proxy:       ws://1.2.3.4:9100/ws/doubao-asr
Health:         http://1.2.3.4:9100/health
Supabase:       connected
```

## Configuration

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--port` | — | `9100` | Listen port |
| `--secret` | `PROXY_SECRET` | (auto-generated) | Gateway secret for authentication |
| `--supabase-url` | `SUPABASE_URL` | — | Supabase project URL (enables WS proxy) |
| `--supabase-key` | `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase service_role key |
| `--allow-domains` | — | `qyapi.weixin.qq.com` | Comma-separated allowed domains for HTTP proxy |
| `--cert` | — | — | TLS certificate file |
| `--key` | — | — | TLS key file |

## API Endpoints

### `GET /health`
Health check. Requires `X-Gateway-Secret` header or `?secret=` query param.
```bash
curl -H "X-Gateway-Secret: your-secret" http://your-ip:9100/health
```

### `POST /proxy`
HTTP forward proxy for WeCom API calls etc. Requires `X-Gateway-Secret` header.
```bash
curl -X POST http://your-ip:9100/proxy \
  -H "X-Gateway-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx","method":"GET"}'
```

### `GET /ws/doubao-asr?secret=xxx`
WebSocket relay to Doubao ASR. Credentials are fetched from Supabase on each connection.

## Production Deployment

### systemd (auto-configured by install.sh)

```ini
[Unit]
Description=SEAJelly Edge Gateway
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/seajelly-gateway --port 9100 --secret "xxx"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable seajelly-gateway
sudo systemctl start seajelly-gateway
journalctl -u seajelly-gateway -f
```

### Nginx Reverse Proxy (SSL)

```nginx
server {
    listen 443 ssl http2;
    server_name gw.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/gw.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gw.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

## Build from Source

Requires Go 1.22+.

```bash
cd tools/edge-gateway

# Linux AMD64
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-amd64

# Linux ARM64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-arm64
```

## Security

- All endpoints require secret verification
- HTTP proxy enforces URL domain whitelist (prevents SSRF)
- WebSocket proxy credentials fetched from Supabase at runtime — nothing stored on disk
- Optional TLS via `--cert`/`--key` or use Nginx for SSL termination

---

# SEAJelly Edge Gateway（中文文档）

解决 Serverless (Vercel) 架构的两个核心痛点：

1. **静态 IP 代理** — 将 HTTP API 调用（如企微）通过固定 IP 主机转发，解决 IP 白名单限制。Vercel 官方方案 $100/月/2IP。
2. **WebSocket 中继** — 代理实时 WebSocket 连接（如豆包 ASR），凭据从 Supabase 动态拉取，网关主机无需配置任何 API 密钥。

## 一行命令安装（Linux）

```bash
curl -fsSL https://raw.githubusercontent.com/your-username/seajelly/main/tools/edge-gateway/install.sh | bash
```

安装脚本会自动：
- 检测 CPU 架构（amd64/arm64）
- 下载预编译的二进制文件
- 交互式引导你配置密钥和端口
- 自动创建并启动 systemd 服务

> **无需安装 Go、Node.js 或任何运行时。** 二进制文件完全静态编译，自包含，约 7MB。

### 手动安装

```bash
# 下载（选择你的架构）
wget https://github.com/your-username/seajelly/releases/latest/download/seajelly-gateway-linux-amd64
chmod +x seajelly-gateway-linux-amd64
mv seajelly-gateway-linux-amd64 /usr/local/bin/seajelly-gateway

# 运行
seajelly-gateway --port 9100 --secret "你的密钥"
```

## 快速开始

```bash
# 仅 HTTP 代理（企微）
seajelly-gateway --port 9100 --secret "你的密钥"

# 完整模式（HTTP 代理 + 豆包 ASR WebSocket 中继）
seajelly-gateway \
  --port 9100 \
  --secret "你的密钥" \
  --supabase-url "https://xxx.supabase.co" \
  --supabase-key "eyJ..."
```

启动后输出：

```
SEAJelly Edge Gateway v1.0.0
Public IP:      1.2.3.4
Listen:         :9100
Gateway Secret: your-secret
HTTP Proxy:     http://1.2.3.4:9100/proxy
WS Proxy:       ws://1.2.3.4:9100/ws/doubao-asr
Health:         http://1.2.3.4:9100/health
Supabase:       connected
```

## 配置参数

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--port` | — | `9100` | 监听端口 |
| `--secret` | `PROXY_SECRET` | （自动生成） | 网关认证密钥 |
| `--supabase-url` | `SUPABASE_URL` | — | Supabase 项目地址（启用 WS 代理） |
| `--supabase-key` | `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase service_role 密钥 |
| `--allow-domains` | — | `qyapi.weixin.qq.com` | 允许转发的域名（逗号分隔） |
| `--cert` | — | — | TLS 证书文件 |
| `--key` | — | — | TLS 密钥文件 |

## API 端点

### `GET /health`
健康检查。需要 `X-Gateway-Secret` 请求头或 `?secret=` 查询参数。
```bash
curl -H "X-Gateway-Secret: 你的密钥" http://你的IP:9100/health
# {"ok":true,"ip":"1.2.3.4","version":"1.0.0","ws_enabled":true}
```

### `POST /proxy`
HTTP 转发代理，用于企微 API 调用等。需要 `X-Gateway-Secret` 请求头。
```bash
curl -X POST http://你的IP:9100/proxy \
  -H "X-Gateway-Secret: 你的密钥" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx","method":"GET"}'
```

### `GET /ws/doubao-asr?secret=xxx`
WebSocket 中继到豆包 ASR。每次连接时从 Supabase `voice_settings` 表动态拉取 `doubao_app_key` 和 `doubao_access_key`。

## 生产部署

### systemd 服务（安装脚本自动配置）

```bash
# 查看状态
sudo systemctl status seajelly-gateway

# 查看日志
journalctl -u seajelly-gateway -f

# 重启
sudo systemctl restart seajelly-gateway

# 停止
sudo systemctl stop seajelly-gateway
```

### Nginx 反向代理（SSL）

```nginx
server {
    listen 443 ssl http2;
    server_name gw.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/gw.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gw.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}

server {
    listen 80;
    server_name gw.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

### 宝塔面板

1. 将二进制文件上传到 `/www/wwwroot/seajelly-gateway/`
2. 通过 SSH 执行上面的 systemd 配置即可
3. 在宝塔的「网站」中配置 Nginx 反向代理

## 企微 IP 白名单配置

1. 在固定 IP 主机上安装网关（一行命令）
2. 记下启动输出中的 **Public IP**
3. 企微管理后台 → 应用详情 → **IP 白名单** → 添加该 IP
4. SEAJelly Dashboard → **设置 → Edge Gateway** → 填入网关地址和密钥
5. 点击「测试连接」验证

## 豆包 ASR 配置

1. 安装网关时带上 `--supabase-url` 和 `--supabase-key` 参数
2. SEAJelly Dashboard → **语音模型 → ASR** → 填入豆包的 App Key 和 Access Key
3. 网关会在每次 WebSocket 连接时从 Supabase 动态拉取凭据
4. **网关主机上无需配置任何 API 密钥**

## 安全设计

- 所有端点都需要密钥验证
- HTTP 代理有域名白名单，防止被滥用为 SSRF 跳板
- WebSocket 代理的凭据从 Supabase 动态拉取，不存储在磁盘上，也不暴露给前端
- 可选 TLS（通过 `--cert`/`--key` 参数，或使用 Nginx 做 SSL 终止）

## 从源码编译

需要 Go 1.22+。

```bash
cd tools/edge-gateway

# Linux AMD64
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-amd64

# Linux ARM64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-arm64
```

## 常见问题

**Q: 安装后连接不上？**
- 检查防火墙是否开放了对应端口（如 9100）
- `sudo ufw allow 9100` 或 `sudo firewall-cmd --add-port=9100/tcp --permanent`

**Q: 企微还是报 IP 白名单错误？**
- 确认 `/health` 返回的 Public IP 与企微后台白名单中的 IP 一致
- 如果主机在 NAT 后面，需要确保出站 IP 也是该固定 IP

**Q: 豆包 ASR 连接失败？**
- 确认启动时带了 `--supabase-url` 和 `--supabase-key`
- 确认 Dashboard → 语音模型 → ASR 中的 App Key 和 Access Key 已保存
- 查看日志：`journalctl -u seajelly-gateway -f`
