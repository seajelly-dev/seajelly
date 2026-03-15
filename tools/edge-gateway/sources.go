package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type RuntimeSource interface {
	Resolve(ctx context.Context, key string) (string, error)
}

type SourceRegistry struct {
	sources map[string]RuntimeSource
}

func NewSourceRegistry(configs []SourceConfig) (*SourceRegistry, error) {
	sources := make(map[string]RuntimeSource, len(configs))
	for _, config := range configs {
		switch config.Kind {
		case sourceKindSupabaseKV:
			sources[config.ID] = &supabaseKVSource{
				config: config,
				cache:  make(map[string]cachedSourceValue),
				client: &http.Client{Timeout: 10 * time.Second},
			}
		case sourceKindEnv:
			sources[config.ID] = &envSource{config: config}
		default:
			return nil, fmt.Errorf("unsupported source kind %q", config.Kind)
		}
	}

	return &SourceRegistry{sources: sources}, nil
}

func (r *SourceRegistry) Resolve(ctx context.Context, sourceID, key string) (string, error) {
	source, ok := r.sources[sourceID]
	if !ok {
		return "", fmt.Errorf("unknown source %q", sourceID)
	}
	return source.Resolve(ctx, key)
}

type envSource struct {
	config SourceConfig
}

func (s *envSource) Resolve(_ context.Context, key string) (string, error) {
	envName := key
	if mapped, ok := s.config.KeyToEnv[key]; ok && mapped != "" {
		envName = mapped
	} else if s.config.Prefix != "" {
		envName = s.config.Prefix + key
	}

	value := os.Getenv(envName)
	if value == "" {
		return "", fmt.Errorf("env source %q is missing %q", s.config.ID, envName)
	}
	return value, nil
}

type cachedSourceValue struct {
	value     string
	expiresAt time.Time
}

type supabaseKVSource struct {
	config SourceConfig
	client *http.Client

	mu    sync.Mutex
	cache map[string]cachedSourceValue
}

func (s *supabaseKVSource) Resolve(ctx context.Context, key string) (string, error) {
	if cached, ok := s.lookupCache(key); ok {
		return cached, nil
	}

	baseURL := strings.TrimRight(os.Getenv(s.config.URLEnv), "/")
	serviceKey := os.Getenv(s.config.ServiceKeyEnv)
	if baseURL == "" || serviceKey == "" {
		return "", fmt.Errorf(
			"supabase source %q requires env %q and %q",
			s.config.ID,
			s.config.URLEnv,
			s.config.ServiceKeyEnv,
		)
	}

	apiURL, err := url.Parse(fmt.Sprintf("%s/rest/v1/%s", baseURL, s.config.Table))
	if err != nil {
		return "", err
	}
	query := apiURL.Query()
	query.Set("select", fmt.Sprintf("%s,%s", s.config.KeyColumn, s.config.ValueColumn))
	query.Set(s.config.KeyColumn, "eq."+key)
	apiURL.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("supabase request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("supabase returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var rows []map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return "", fmt.Errorf("supabase decode failed: %w", err)
	}
	if len(rows) == 0 {
		return "", fmt.Errorf("source %q key %q not found", s.config.ID, key)
	}

	value := rows[0][s.config.ValueColumn]
	if value == "" {
		return "", fmt.Errorf("source %q key %q has an empty value", s.config.ID, key)
	}

	s.storeCache(key, value)
	return value, nil
}

func (s *supabaseKVSource) lookupCache(key string) (string, bool) {
	if s.config.CacheTTLMS <= 0 {
		return "", false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	cached, ok := s.cache[key]
	if !ok || time.Now().After(cached.expiresAt) {
		return "", false
	}

	return cached.value, true
}

func (s *supabaseKVSource) storeCache(key, value string) {
	if s.config.CacheTTLMS <= 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache[key] = cachedSourceValue{
		value:     value,
		expiresAt: time.Now().Add(time.Duration(s.config.CacheTTLMS) * time.Millisecond),
	}
}
