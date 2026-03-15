package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSupabaseKVSourceCachesValues(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprint(w, `[{"key":"doubao_app_key","value":"app-key"}]`)
	}))
	t.Cleanup(server.Close)

	t.Setenv("TEST_SUPABASE_URL", server.URL)
	t.Setenv("TEST_SUPABASE_KEY", "service-role")

	source := &supabaseKVSource{
		config: SourceConfig{
			ID:            "voice-settings",
			Kind:          sourceKindSupabaseKV,
			URLEnv:        "TEST_SUPABASE_URL",
			ServiceKeyEnv: "TEST_SUPABASE_KEY",
			Table:         "voice_settings",
			KeyColumn:     "key",
			ValueColumn:   "value",
			CacheTTLMS:    60_000,
		},
		cache:  make(map[string]cachedSourceValue),
		client: server.Client(),
	}

	ctx := context.Background()
	value, err := source.Resolve(ctx, "doubao_app_key")
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if value != "app-key" {
		t.Fatalf("Resolve() = %q, want %q", value, "app-key")
	}

	value, err = source.Resolve(ctx, "doubao_app_key")
	if err != nil {
		t.Fatalf("Resolve() second call error = %v", err)
	}
	if value != "app-key" {
		t.Fatalf("Resolve() second call = %q, want %q", value, "app-key")
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 upstream request, got %d", calls.Load())
	}
}

func TestEnvSourceUsesMappingsAndPrefix(t *testing.T) {
	t.Setenv("GW_DOU_BAO", "mapped")
	t.Setenv("PREFIX_resource_id", "prefixed")
	t.Setenv("PLAIN_KEY", "plain")

	source := &envSource{
		config: SourceConfig{
			ID:       "env-source",
			Kind:     sourceKindEnv,
			Prefix:   "PREFIX_",
			KeyToEnv: map[string]string{"api_key": "GW_DOU_BAO"},
		},
	}

	if value, err := source.Resolve(context.Background(), "api_key"); err != nil || value != "mapped" {
		t.Fatalf("mapped env Resolve() = %q, %v", value, err)
	}
	if value, err := source.Resolve(context.Background(), "resource_id"); err != nil || value != "prefixed" {
		t.Fatalf("prefixed env Resolve() = %q, %v", value, err)
	}

	source.config.Prefix = ""
	source.config.KeyToEnv = nil
	if value, err := source.Resolve(context.Background(), "PLAIN_KEY"); err != nil || value != "plain" {
		t.Fatalf("plain env Resolve() = %q, %v", value, err)
	}
}

func TestSupabaseKVSourceFailsWhenEnvMissing(t *testing.T) {
	source := &supabaseKVSource{
		config: SourceConfig{
			ID:            "voice-settings",
			Kind:          sourceKindSupabaseKV,
			URLEnv:        "MISSING_SUPABASE_URL",
			ServiceKeyEnv: "MISSING_SUPABASE_KEY",
		},
		cache: make(map[string]cachedSourceValue),
	}

	if _, err := source.Resolve(context.Background(), "doubao_app_key"); err == nil {
		t.Fatal("expected missing env error")
	}
}
