package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var websocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (g *Gateway) handleWSRelay(route RouteConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !g.verifySecret(r) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		clientConn, err := websocketUpgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[WS] Upgrade failed for %s: %v", route.Capability, err)
			return
		}
		defer clientConn.Close()

		headers, err := g.resolveHeaderTemplates(r.Context(), route.Upstream.Headers)
		if err != nil {
			log.Printf("[WS] Failed to resolve headers for %s: %v", route.Capability, err)
			_ = clientConn.WriteMessage(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "header resolution failed"),
			)
			return
		}

		dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
		upstreamConn, _, err := dialer.Dial(route.Upstream.URL, headers)
		if err != nil {
			log.Printf("[WS] Upstream dial failed for %s: %v", route.Capability, err)
			_ = clientConn.WriteMessage(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "upstream connection failed"),
			)
			return
		}
		defer upstreamConn.Close()

		log.Printf("[WS] Relay open: %s -> %s", route.Path, route.Upstream.URL)

		var wg sync.WaitGroup
		wg.Add(2)

		go func() {
			defer wg.Done()
			pipeWebSocket(clientConn, upstreamConn)
		}()

		go func() {
			defer wg.Done()
			pipeWebSocket(upstreamConn, clientConn)
		}()

		wg.Wait()
		log.Printf("[WS] Relay closed: %s", route.Path)
	}
}

func pipeWebSocket(src, dst *websocket.Conn) {
	for {
		messageType, payload, err := src.ReadMessage()
		if err != nil {
			_ = dst.WriteMessage(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
			)
			return
		}
		if err := dst.WriteMessage(messageType, payload); err != nil {
			return
		}
	}
}

func (g *Gateway) resolveHeaderTemplates(ctx context.Context, headers map[string]TemplateValue) (http.Header, error) {
	resolved := make(http.Header, len(headers))
	for name, template := range headers {
		value, err := g.resolveTemplateValue(ctx, template)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		resolved.Set(name, value)
	}
	return resolved, nil
}

func (g *Gateway) resolveTemplateValue(ctx context.Context, template TemplateValue) (string, error) {
	switch {
	case template.Value != "":
		return template.Value, nil
	case template.Env != "":
		value := lookupEnv(template.Env)
		if value == "" {
			return "", fmt.Errorf("env %q is not set", template.Env)
		}
		return value, nil
	case template.Generated != "":
		if template.Generated != "uuid" {
			return "", fmt.Errorf("unsupported generated value %q", template.Generated)
		}
		return generateUUID(), nil
	case template.Source != "":
		return g.sources.Resolve(ctx, template.Source, template.Key)
	default:
		return "", fmt.Errorf("empty template")
	}
}
