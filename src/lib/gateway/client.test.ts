import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetGatewayClientCacheForTests,
  buildGatewayRouteUrl,
  findGatewayCapability,
  loadGatewayManifest,
  type GatewayConfig,
} from "@/lib/gateway/client";

const gatewayConfig: GatewayConfig = {
  url: "https://gw.example.com",
  secret: "test-secret",
};

const manifestPayload = {
  version: "2.0.0",
  config_version: "v1",
  public_ip: "1.2.3.4",
  capabilities: ["platform.wecom.http", "voice.doubao-asr.ws"],
  routes: [
    {
      id: "wecom-http",
      capability: "platform.wecom.http",
      kind: "http_forward",
      path: "/routes/wecom/http",
    },
    {
      id: "doubao-asr",
      capability: "voice.doubao-asr.ws",
      kind: "ws_relay",
      path: "/routes/voice/doubao-asr",
    },
  ],
};

test("loadGatewayManifest caches repeated manifest requests", async () => {
  __resetGatewayClientCacheForTests();

  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(manifestPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const first = await loadGatewayManifest(gatewayConfig, { fetchFn });
  const second = await loadGatewayManifest(gatewayConfig, { fetchFn });

  assert.equal(calls, 1);
  assert.equal(first.version, "2.0.0");
  assert.equal(second.routes.length, 2);
});

test("findGatewayCapability returns the expected route", () => {
  const route = findGatewayCapability(
    {
      version: "2.0.0",
      configVersion: "v1",
      publicIp: "1.2.3.4",
      capabilities: ["voice.doubao-asr.ws"],
      routes: [
        {
          id: "doubao-asr",
          capability: "voice.doubao-asr.ws",
          kind: "ws_relay",
          path: "/routes/voice/doubao-asr",
        },
      ],
    },
    "voice.doubao-asr.ws",
  );

  assert.ok(route);
  assert.equal(route.path, "/routes/voice/doubao-asr");
});

test("buildGatewayRouteUrl builds websocket URLs with secret query", () => {
  const url = buildGatewayRouteUrl("https://gw.example.com", "/routes/voice/doubao-asr", {
    transport: "ws",
    includeSecretQuery: true,
    secret: "abc123",
  });

  assert.equal(url, "wss://gw.example.com/routes/voice/doubao-asr?secret=abc123");
});
