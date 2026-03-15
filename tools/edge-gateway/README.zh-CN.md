# SEAJelly Edge Gateway

English: [README.md](./README.md)

这是一个配置驱动的单二进制网关，解决 Serverless 架构下两类常见限制：

1. 需要固定 IP 才能访问的上游 API，例如企微白名单
2. 前端无法直连、或平台只允许后端访问的 WebSocket 服务，例如豆包 ASR

现在网关完全由 `gateway.json` 驱动。以后新增一种转发服务，只需要改 JSON 并重启，不需要再改 Go 代码重新编译。

## 这次重构带来了什么

- HTTP 转发、multipart 上传转发、WebSocket 中继都变成了通用 route kind
- 所有能力都通过 `GET /manifest` 暴露给上层应用发现
- 上游敏感值来自外部 source，而不是写死在 Go 代码里
- 旧的固定路径 `/proxy`、`/upload`、`/ws/doubao-asr` 已移除

## 快速启动

```bash
./seajelly-gateway \
  --port 9100 \
  --secret "你的密钥" \
  --config /etc/seajelly/gateway.json
```

启动输出类似：

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

## 配置文件

推荐从 [`config.example.json`](./config.example.json) 开始。

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

### 支持的 Source 类型

- `supabase_rest_kv`
  - 通过 PostgREST 读取键值表
  - Supabase URL 和 service role key 通过 `url_env`、`service_key_env` 指向的环境变量注入
- `env`
  - 直接从进程环境变量中取值
  - 支持直接按 key 取值，也支持 `prefix` 或 `key_to_env` 映射

### 支持的 Route 类型

- `http_forward`
  - 请求体为 JSON，字段包括 `url`、`method`、`headers`、`body`
  - 目标域名必须命中 `allowed_hosts`
- `multipart_upload`
  - 请求体包括 `url`、`file_name`、`file_data`（base64）、`mime_type`
  - 上传字段名由 `form_field_name` 决定
- `ws_relay`
  - 将浏览器 WebSocket 帧原样桥接到固定上游
  - Header 值支持以下模板来源：
    - `value`
    - `source + key`
    - `env`
    - `generated: "uuid"`

## 对外接口

所有接口都要求 `X-Gateway-Secret` 或 `?secret=`：

- `GET /health`
  - 返回基础状态、版本、配置版本、路由数量
- `GET /manifest`
  - 只返回公开元数据：版本、配置版本、公网 IP、routes、capabilities
- `gateway.json` 中声明的 route path
  - 例如 `/routes/wecom/http`、`/routes/wecom/upload`、`/routes/voice/doubao-asr`

## 安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/your-username/seajelly/main/tools/edge-gateway/install.sh | bash
```

安装脚本会：

- 下载对应架构的静态编译二进制
- 如果不存在，则写入 `/etc/seajelly/gateway.json`
- 写入 `/etc/seajelly/gateway.env` 以承载可选 source 环境变量
- 创建一个使用 `--config /etc/seajelly/gateway.json` 的 `systemd` 服务

修改 `gateway.json` 之后，只需要重启服务：

```bash
sudo systemctl restart seajelly-gateway
```

## 从源码构建

需要 Go 1.22+。

```bash
cd tools/edge-gateway

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-amd64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/seajelly-gateway-linux-arm64
```

## 安全说明

- 所有接口都受 gateway secret 保护
- `http_forward` 和 `multipart_upload` 都受 `allowed_hosts` 限制
- Manifest 不会泄露 source 定义或已解析的密钥值
- WebSocket 上游凭据可以来自 Supabase 或环境变量，不需要直接写进 `gateway.json`
