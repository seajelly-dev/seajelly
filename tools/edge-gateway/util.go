package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func resolveGatewaySecret(flagSecret string) (string, error) {
	if env := os.Getenv("PROXY_SECRET"); env != "" && flagSecret == "" {
		flagSecret = env
	}
	if flagSecret != "" {
		return flagSecret, nil
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func detectPublicIP() string {
	client := &http.Client{Timeout: 5 * time.Second}
	for _, serviceURL := range []string{
		"https://api.ipify.org",
		"https://ifconfig.me/ip",
		"https://icanhazip.com",
	} {
		resp, err := client.Get(serviceURL)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		ip := strings.TrimSpace(string(body))
		if ip != "" {
			return ip
		}
	}
	return "unknown"
}

func lookupEnv(key string) string {
	return os.Getenv(key)
}

func generateUUID() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		buf[0:4],
		buf[4:6],
		buf[6:8],
		buf[8:10],
		buf[10:16],
	)
}
