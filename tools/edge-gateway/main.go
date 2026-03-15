package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
)

const version = "2.0.0"

var (
	flagPort   = flag.Int("port", 9100, "Listen port")
	flagSecret = flag.String("secret", "", "Gateway secret (auto-generated if empty)")
	flagConfig = flag.String("config", "/etc/seajelly/gateway.json", "Gateway config file")
	flagCert   = flag.String("cert", "", "TLS certificate file (optional)")
	flagKey    = flag.String("key", "", "TLS key file (optional)")
)

func main() {
	flag.Parse()

	secret, err := resolveGatewaySecret(*flagSecret)
	if err != nil {
		log.Fatal("Failed to resolve gateway secret:", err)
	}

	configPath := *flagConfig
	if env := os.Getenv("GATEWAY_CONFIG_PATH"); env != "" && configPath == "/etc/seajelly/gateway.json" {
		configPath = env
	}

	config, err := LoadConfig(configPath)
	if err != nil {
		log.Fatalf("Failed to load config %q: %v", configPath, err)
	}

	publicIP := detectPublicIP()
	gateway, err := NewGateway(version, configPath, secret, publicIP, config)
	if err != nil {
		log.Fatal("Failed to initialize gateway:", err)
	}

	printStartupSummary(gateway, *flagPort)

	addr := fmt.Sprintf(":%d", *flagPort)
	if *flagCert != "" && *flagKey != "" {
		log.Printf("Starting HTTPS server on %s", addr)
		log.Fatal(http.ListenAndServeTLS(addr, *flagCert, *flagKey, gateway.Handler()))
	}

	log.Printf("Starting HTTP server on %s", addr)
	log.Fatal(http.ListenAndServe(addr, gateway.Handler()))
}

func printStartupSummary(gateway *Gateway, port int) {
	fmt.Printf("\nSEAJelly Edge Gateway v%s\n", gateway.version)
	fmt.Printf("Public IP:      %s\n", gateway.publicIP)
	fmt.Printf("Listen:         :%d\n", port)
	fmt.Printf("Gateway Secret: %s\n", gateway.secret)
	fmt.Printf("Config:         %s\n", gateway.configPath)
	fmt.Printf("Health:         http://%s:%d/health\n", gateway.publicIP, port)
	fmt.Printf("Manifest:       http://%s:%d/manifest\n", gateway.publicIP, port)
	if len(gateway.manifest.Routes) == 0 {
		fmt.Printf("Routes:         none configured\n\n")
		return
	}

	fmt.Println("Routes:")
	for _, route := range gateway.manifest.Routes {
		fmt.Printf("  - %-28s %-16s %s\n", route.Capability, route.Kind, route.Path)
	}
	fmt.Println()
}
