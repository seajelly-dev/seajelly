package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestValidateForwardTargetRejectsDisallowedHosts(t *testing.T) {
	t.Parallel()

	if _, err := validateForwardTarget("https://qyapi.weixin.qq.com/cgi-bin/gettoken", []string{"qyapi.weixin.qq.com"}); err != nil {
		t.Fatalf("expected allowed host to pass, got %v", err)
	}

	if _, err := validateForwardTarget("https://evil.example/steal", []string{"qyapi.weixin.qq.com"}); err == nil {
		t.Fatal("expected disallowed host to fail")
	}
}

func TestResolveHeaderTemplatesInjectsUUIDAndSourceValues(t *testing.T) {
	registry, err := NewSourceRegistry([]SourceConfig{
		{
			ID:       "voice-settings",
			Kind:     sourceKindEnv,
			KeyToEnv: map[string]string{"doubao_app_key": "HEADER_SOURCE_VALUE"},
		},
	})
	if err != nil {
		t.Fatalf("NewSourceRegistry() error = %v", err)
	}
	t.Setenv("HEADER_SOURCE_VALUE", "app-key")

	gateway := &Gateway{sources: registry}
	headers, err := gateway.resolveHeaderTemplates(context.Background(), map[string]TemplateValue{
		"X-Api-App-Key":    {Source: "voice-settings", Key: "doubao_app_key"},
		"X-Api-Connect-Id": {Generated: "uuid"},
	})
	if err != nil {
		t.Fatalf("resolveHeaderTemplates() error = %v", err)
	}

	if got := headers.Get("X-Api-App-Key"); got != "app-key" {
		t.Fatalf("X-Api-App-Key = %q, want %q", got, "app-key")
	}

	pattern := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	if !pattern.MatchString(headers.Get("X-Api-Connect-Id")) {
		t.Fatalf("expected UUID, got %q", headers.Get("X-Api-Connect-Id"))
	}
}

func TestManifestDoesNotLeakSources(t *testing.T) {
	t.Parallel()

	config := &Config{
		Version: configVersionV1,
		Sources: []SourceConfig{
			{
				ID:            "voice-settings",
				Kind:          sourceKindSupabaseKV,
				URLEnv:        "SUPABASE_URL",
				ServiceKeyEnv: "SUPABASE_SERVICE_ROLE_KEY",
				Table:         "voice_settings",
				KeyColumn:     "key",
				ValueColumn:   "value",
			},
		},
		Routes: []RouteConfig{
			{
				ID:         "doubao-asr-ws",
				Capability: "voice.doubao-asr.ws",
				Kind:       routeKindWSRelay,
				Path:       "/routes/voice/doubao-asr",
				Upstream: &WSRelayUpstreamConfig{
					URL: "wss://example.com",
					Headers: map[string]TemplateValue{
						"X-Api-App-Key": {Source: "voice-settings", Key: "doubao_app_key"},
					},
				},
			},
		},
	}

	gateway, err := NewGateway(version, "/etc/seajelly/gateway.json", "secret", "1.2.3.4", config)
	if err != nil {
		t.Fatalf("NewGateway() error = %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("GET", "/manifest?secret=secret", nil)
	gateway.handleManifest(recorder, request)

	if recorder.Code != 200 {
		t.Fatalf("manifest status = %d, want 200", recorder.Code)
	}

	body := recorder.Body.String()
	if strings.Contains(body, "voice-settings") || strings.Contains(body, "doubao_app_key") {
		t.Fatalf("manifest leaked source internals: %s", body)
	}

	var manifest GatewayManifest
	if err := json.Unmarshal(recorder.Body.Bytes(), &manifest); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if len(manifest.Routes) != 1 || manifest.Routes[0].Capability != "voice.doubao-asr.ws" {
		t.Fatalf("unexpected manifest routes: %+v", manifest.Routes)
	}
}
