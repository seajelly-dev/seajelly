package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const (
	configVersionV1      = "v1"
	sourceKindSupabaseKV = "supabase_rest_kv"
	sourceKindEnv        = "env"
	routeKindHTTPForward = "http_forward"
	routeKindUpload      = "multipart_upload"
	routeKindWSRelay     = "ws_relay"
)

var supportedGeneratedValues = []string{"uuid"}

type Config struct {
	Version string         `json:"version"`
	Sources []SourceConfig `json:"sources"`
	Routes  []RouteConfig  `json:"routes"`
}

type SourceConfig struct {
	ID            string            `json:"id"`
	Kind          string            `json:"kind"`
	URLEnv        string            `json:"url_env,omitempty"`
	ServiceKeyEnv string            `json:"service_key_env,omitempty"`
	Table         string            `json:"table,omitempty"`
	KeyColumn     string            `json:"key_column,omitempty"`
	ValueColumn   string            `json:"value_column,omitempty"`
	CacheTTLMS    int               `json:"cache_ttl_ms,omitempty"`
	KeyToEnv      map[string]string `json:"key_to_env,omitempty"`
	Prefix        string            `json:"prefix,omitempty"`
}

type RouteConfig struct {
	ID            string                 `json:"id"`
	Capability    string                 `json:"capability"`
	Kind          string                 `json:"kind"`
	Path          string                 `json:"path"`
	AllowedHosts  []string               `json:"allowed_hosts,omitempty"`
	FormFieldName string                 `json:"form_field_name,omitempty"`
	Upstream      *WSRelayUpstreamConfig `json:"upstream,omitempty"`
}

type WSRelayUpstreamConfig struct {
	URL     string                   `json:"url"`
	Headers map[string]TemplateValue `json:"headers,omitempty"`
}

type TemplateValue struct {
	Value     string `json:"value,omitempty"`
	Source    string `json:"source,omitempty"`
	Key       string `json:"key,omitempty"`
	Env       string `json:"env,omitempty"`
	Generated string `json:"generated,omitempty"`
}

func LoadConfig(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var config Config
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, err
	}

	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}

	return &config, nil
}

func (c *Config) Validate() error {
	if c.Version != configVersionV1 {
		return fmt.Errorf("version must be %q", configVersionV1)
	}

	sourceIDs := make(map[string]struct{}, len(c.Sources))
	for _, source := range c.Sources {
		if source.ID == "" {
			return fmt.Errorf("source id is required")
		}
		if _, exists := sourceIDs[source.ID]; exists {
			return fmt.Errorf("duplicate source id %q", source.ID)
		}
		sourceIDs[source.ID] = struct{}{}

		switch source.Kind {
		case sourceKindSupabaseKV:
			if source.URLEnv == "" || source.ServiceKeyEnv == "" {
				return fmt.Errorf("source %q requires url_env and service_key_env", source.ID)
			}
			if source.Table == "" || source.KeyColumn == "" || source.ValueColumn == "" {
				return fmt.Errorf("source %q requires table, key_column and value_column", source.ID)
			}
		case sourceKindEnv:
			// env sources are intentionally flexible: key_to_env, prefix, or direct env lookup by key.
		default:
			return fmt.Errorf("source %q has unsupported kind %q", source.ID, source.Kind)
		}
	}

	routeIDs := make(map[string]struct{}, len(c.Routes))
	capabilities := make(map[string]struct{}, len(c.Routes))
	paths := make(map[string]struct{}, len(c.Routes))

	for _, route := range c.Routes {
		if route.ID == "" {
			return fmt.Errorf("route id is required")
		}
		if _, exists := routeIDs[route.ID]; exists {
			return fmt.Errorf("duplicate route id %q", route.ID)
		}
		routeIDs[route.ID] = struct{}{}

		if route.Capability == "" {
			return fmt.Errorf("route %q requires capability", route.ID)
		}
		if _, exists := capabilities[route.Capability]; exists {
			return fmt.Errorf("duplicate route capability %q", route.Capability)
		}
		capabilities[route.Capability] = struct{}{}

		if route.Path == "" || !strings.HasPrefix(route.Path, "/") {
			return fmt.Errorf("route %q requires an absolute path", route.ID)
		}
		if strings.Contains(route.Path, " ") {
			return fmt.Errorf("route %q path must not contain spaces", route.ID)
		}
		if _, exists := paths[route.Path]; exists {
			return fmt.Errorf("duplicate route path %q", route.Path)
		}
		paths[route.Path] = struct{}{}

		switch route.Kind {
		case routeKindHTTPForward, routeKindUpload:
			if len(route.AllowedHosts) == 0 {
				return fmt.Errorf("route %q requires allowed_hosts", route.ID)
			}
			for _, host := range route.AllowedHosts {
				if strings.TrimSpace(host) == "" {
					return fmt.Errorf("route %q contains an empty allowed host", route.ID)
				}
			}
		case routeKindWSRelay:
			if route.Upstream == nil {
				return fmt.Errorf("route %q requires upstream", route.ID)
			}
			upstreamURL, err := url.Parse(route.Upstream.URL)
			if err != nil {
				return fmt.Errorf("route %q has invalid upstream url: %w", route.ID, err)
			}
			if upstreamURL.Scheme != "ws" && upstreamURL.Scheme != "wss" {
				return fmt.Errorf("route %q upstream must use ws or wss", route.ID)
			}
			for headerName, value := range route.Upstream.Headers {
				if strings.TrimSpace(headerName) == "" {
					return fmt.Errorf("route %q contains an empty header name", route.ID)
				}
				if err := value.Validate(sourceIDs); err != nil {
					return fmt.Errorf("route %q header %q: %w", route.ID, headerName, err)
				}
			}
		default:
			return fmt.Errorf("route %q has unsupported kind %q", route.ID, route.Kind)
		}
	}

	return nil
}

func (t TemplateValue) Validate(sourceIDs map[string]struct{}) error {
	modeCount := 0

	if t.Value != "" {
		modeCount++
	}
	if t.Env != "" {
		modeCount++
	}
	if t.Generated != "" {
		modeCount++
		if !slices.Contains(supportedGeneratedValues, t.Generated) {
			return fmt.Errorf("unsupported generated value %q", t.Generated)
		}
	}
	if t.Source != "" || t.Key != "" {
		modeCount++
		if t.Source == "" || t.Key == "" {
			return fmt.Errorf("source templates require both source and key")
		}
		if _, exists := sourceIDs[t.Source]; !exists {
			return fmt.Errorf("unknown source %q", t.Source)
		}
	}

	if modeCount != 1 {
		return fmt.Errorf("must define exactly one of value, env, generated, or source/key")
	}

	return nil
}
