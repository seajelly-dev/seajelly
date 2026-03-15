package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
)

type Gateway struct {
	version    string
	configPath string
	secret     string
	publicIP   string
	config     *Config
	sources    *SourceRegistry
	manifest   GatewayManifest
}

type GatewayManifest struct {
	Version       string          `json:"version"`
	ConfigVersion string          `json:"config_version"`
	PublicIP      string          `json:"public_ip"`
	Capabilities  []string        `json:"capabilities"`
	Routes        []ManifestRoute `json:"routes"`
}

type ManifestRoute struct {
	ID         string `json:"id"`
	Capability string `json:"capability"`
	Kind       string `json:"kind"`
	Path       string `json:"path"`
}

func NewGateway(version, configPath, secret, publicIP string, config *Config) (*Gateway, error) {
	sources, err := NewSourceRegistry(config.Sources)
	if err != nil {
		return nil, err
	}

	manifest := GatewayManifest{
		Version:       version,
		ConfigVersion: config.Version,
		PublicIP:      publicIP,
		Capabilities:  make([]string, 0, len(config.Routes)),
		Routes:        make([]ManifestRoute, 0, len(config.Routes)),
	}
	for _, route := range config.Routes {
		manifest.Capabilities = append(manifest.Capabilities, route.Capability)
		manifest.Routes = append(manifest.Routes, ManifestRoute{
			ID:         route.ID,
			Capability: route.Capability,
			Kind:       route.Kind,
			Path:       route.Path,
		})
	}
	sort.Strings(manifest.Capabilities)

	return &Gateway{
		version:    version,
		configPath: configPath,
		secret:     secret,
		publicIP:   publicIP,
		config:     config,
		sources:    sources,
		manifest:   manifest,
	}, nil
}

func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", g.handleHealth)
	mux.HandleFunc("/manifest", g.handleManifest)

	for _, route := range g.config.Routes {
		route := route
		switch route.Kind {
		case routeKindHTTPForward:
			mux.HandleFunc(route.Path, g.handleHTTPForward(route))
		case routeKindUpload:
			mux.HandleFunc(route.Path, g.handleMultipartUpload(route))
		case routeKindWSRelay:
			mux.HandleFunc(route.Path, g.handleWSRelay(route))
		default:
			panic(fmt.Sprintf("unsupported route kind %q", route.Kind))
		}
	}

	return mux
}

func (g *Gateway) verifySecret(r *http.Request) bool {
	headerSecret := r.Header.Get("X-Gateway-Secret")
	if headerSecret != "" {
		return headerSecret == g.secret
	}
	return r.URL.Query().Get("secret") == g.secret
}

func (g *Gateway) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !g.verifySecret(r) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"ip":             g.publicIP,
		"version":        g.version,
		"config_version": g.config.Version,
		"route_count":    len(g.manifest.Routes),
	})
}

func (g *Gateway) handleManifest(w http.ResponseWriter, r *http.Request) {
	if !g.verifySecret(r) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	writeJSON(w, http.StatusOK, g.manifest)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
