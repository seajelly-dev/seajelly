package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const version = "1.0.0"

var (
	flagPort        = flag.Int("port", 9100, "Listen port")
	flagSecret      = flag.String("secret", "", "Gateway secret (auto-generated if empty)")
	flagSupabaseURL = flag.String("supabase-url", "", "Supabase project URL (enables WS proxy)")
	flagSupabaseKey = flag.String("supabase-key", "", "Supabase service_role key")
	flagAllowDomain = flag.String("allow-domains", "qyapi.weixin.qq.com", "Comma-separated allowed domains for HTTP proxy")
	flagCert        = flag.String("cert", "", "TLS certificate file (optional)")
	flagKey         = flag.String("key", "", "TLS key file (optional)")
)

var (
	gatewaySecret string
	supabaseURL   string
	supabaseKey   string
	allowedHosts  map[string]bool
	publicIP      string
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
	flag.Parse()

	if env := os.Getenv("PROXY_SECRET"); env != "" && *flagSecret == "" {
		*flagSecret = env
	}
	if env := os.Getenv("SUPABASE_URL"); env != "" && *flagSupabaseURL == "" {
		*flagSupabaseURL = env
	}
	if env := os.Getenv("SUPABASE_SERVICE_ROLE_KEY"); env != "" && *flagSupabaseKey == "" {
		*flagSupabaseKey = env
	}

	if *flagSecret != "" {
		gatewaySecret = *flagSecret
	} else {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			log.Fatal("Failed to generate secret:", err)
		}
		gatewaySecret = hex.EncodeToString(b)
	}

	supabaseURL = *flagSupabaseURL
	supabaseKey = *flagSupabaseKey
	wsEnabled := supabaseURL != "" && supabaseKey != ""

	allowedHosts = make(map[string]bool)
	for _, d := range strings.Split(*flagAllowDomain, ",") {
		d = strings.TrimSpace(d)
		if d != "" {
			allowedHosts[d] = true
		}
	}

	publicIP = detectPublicIP()

	fmt.Printf("\nOpenCrab Edge Gateway v%s\n", version)
	fmt.Printf("Public IP:      %s\n", publicIP)
	fmt.Printf("Listen:         :%d\n", *flagPort)
	fmt.Printf("Gateway Secret: %s\n", gatewaySecret)
	fmt.Printf("HTTP Proxy:     http://%s:%d/proxy\n", publicIP, *flagPort)
	if wsEnabled {
		fmt.Printf("WS Proxy:       ws://%s:%d/ws/doubao-asr\n", publicIP, *flagPort)
	}
	fmt.Printf("Health:         http://%s:%d/health\n", publicIP, *flagPort)
	if wsEnabled {
		fmt.Printf("Supabase:       connected (%s)\n", supabaseURL)
	} else {
		fmt.Printf("Supabase:       not configured (WS proxy disabled)\n")
	}
	fmt.Println()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/proxy", handleProxy)
	mux.HandleFunc("/upload", handleUpload)
	mux.HandleFunc("/ws/doubao-asr", handleWSDoubaoASR)

	addr := fmt.Sprintf(":%d", *flagPort)
	if *flagCert != "" && *flagKey != "" {
		log.Printf("Starting HTTPS server on %s", addr)
		log.Fatal(http.ListenAndServeTLS(addr, *flagCert, *flagKey, mux))
	} else {
		log.Printf("Starting HTTP server on %s", addr)
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}

func detectPublicIP() string {
	client := &http.Client{Timeout: 5 * time.Second}
	for _, svc := range []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"} {
		resp, err := client.Get(svc)
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

func verifySecret(r *http.Request) bool {
	h := r.Header.Get("X-Gateway-Secret")
	if h != "" {
		return h == gatewaySecret
	}
	return r.URL.Query().Get("secret") == gatewaySecret
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if !verifySecret(r) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	wsEnabled := supabaseURL != "" && supabaseKey != ""
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":         true,
		"ip":         publicIP,
		"version":    version,
		"ws_enabled": wsEnabled,
	})
}

type ProxyRequest struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

func handleProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if !verifySecret(r) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	var req ProxyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	parsed, err := url.Parse(req.URL)
	if err != nil || !allowedHosts[parsed.Hostname()] {
		http.Error(w, fmt.Sprintf(`{"error":"domain not allowed: %s"}`, parsed.Hostname()), http.StatusForbidden)
		return
	}

	method := req.Method
	if method == "" {
		method = "GET"
	}

	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}

	httpReq, err := http.NewRequest(method, req.URL, bodyReader)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"upstream: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Raw passthrough: copy upstream status, headers, body directly
	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set("X-Proxy-Status", fmt.Sprintf("%d", resp.StatusCode))
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

type UploadRequest struct {
	URL      string `json:"url"`
	FileName string `json:"file_name"`
	FileData string `json:"file_data"`
	MimeType string `json:"mime_type"`
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if !verifySecret(r) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	var req UploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	parsed, err := url.Parse(req.URL)
	if err != nil || !allowedHosts[parsed.Hostname()] {
		http.Error(w, fmt.Sprintf(`{"error":"domain not allowed: %s"}`, parsed.Hostname()), http.StatusForbidden)
		return
	}

	fileBytes, err := base64.StdEncoding.DecodeString(req.FileData)
	if err != nil {
		http.Error(w, `{"error":"invalid base64 file_data"}`, http.StatusBadRequest)
		return
	}

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("media", req.FileName)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	part.Write(fileBytes)
	writer.Close()

	httpReq, err := http.NewRequest("POST", req.URL, &buf)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"upstream: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func fetchDoubaoCredentials() (appKey, accessKey string, err error) {
	if supabaseURL == "" || supabaseKey == "" {
		return "", "", fmt.Errorf("supabase not configured")
	}

	client := &http.Client{Timeout: 10 * time.Second}
	apiURL := fmt.Sprintf("%s/rest/v1/voice_settings?select=key,value&key=in.(doubao_app_key,doubao_access_key)", supabaseURL)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)

	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("supabase request failed: %w", err)
	}
	defer resp.Body.Close()

	var rows []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return "", "", fmt.Errorf("supabase decode failed: %w", err)
	}

	for _, r := range rows {
		switch r.Key {
		case "doubao_app_key":
			appKey = r.Value
		case "doubao_access_key":
			accessKey = r.Value
		}
	}
	if appKey == "" || accessKey == "" {
		return "", "", fmt.Errorf("doubao credentials not found in voice_settings (app_key=%v, access_key=%v)", appKey != "", accessKey != "")
	}
	return appKey, accessKey, nil
}

func handleWSDoubaoASR(w http.ResponseWriter, r *http.Request) {
	if !verifySecret(r) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	if supabaseURL == "" || supabaseKey == "" {
		http.Error(w, `{"error":"websocket proxy not enabled (supabase not configured)"}`, http.StatusServiceUnavailable)
		return
	}

	appKey, accessKey, err := fetchDoubaoCredentials()
	if err != nil {
		log.Printf("[WS] Failed to fetch doubao credentials: %v", err)
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade failed: %v", err)
		return
	}
	defer clientConn.Close()

	connectID := generateUUID()
	log.Printf("[WS] Client connected, connect_id=%s", connectID)

	doubaoURL := "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	upstreamHeaders := http.Header{
		"X-Api-App-Key":    {appKey},
		"X-Api-Access-Key": {accessKey},
		"X-Api-Resource-Id": {"volc.bigasr.sauc.duration"},
		"X-Api-Connect-Id": {connectID},
	}

	upstream, _, err := dialer.Dial(doubaoURL, upstreamHeaders)
	if err != nil {
		log.Printf("[WS] Doubao dial failed: %v", err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "upstream connection failed"))
		return
	}
	defer upstream.Close()

	log.Printf("[WS] Connected to Doubao ASR, connect_id=%s", connectID)

	var wg sync.WaitGroup
	wg.Add(2)

	// client -> upstream
	go func() {
		defer wg.Done()
		for {
			msgType, data, err := clientConn.ReadMessage()
			if err != nil {
				upstream.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			if err := upstream.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}()

	// upstream -> client
	go func() {
		defer wg.Done()
		for {
			msgType, data, err := upstream.ReadMessage()
			if err != nil {
				clientConn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			if err := clientConn.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}()

	wg.Wait()
	log.Printf("[WS] Session ended, connect_id=%s", connectID)
}

func generateUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
