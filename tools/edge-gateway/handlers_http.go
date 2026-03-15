package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"
)

type ForwardRequest struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

type MultipartUploadRequest struct {
	URL      string `json:"url"`
	FileName string `json:"file_name"`
	FileData string `json:"file_data"`
	MimeType string `json:"mime_type"`
}

func (g *Gateway) handleHTTPForward(route RouteConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		if !g.verifySecret(r) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		var req ForwardRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}

		targetURL, err := validateForwardTarget(req.URL, route.AllowedHosts)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
			return
		}

		method := req.Method
		if method == "" {
			method = http.MethodGet
		}

		var bodyReader io.Reader
		if req.Body != "" {
			bodyReader = strings.NewReader(req.Body)
		}

		upstreamReq, err := http.NewRequest(method, targetURL.String(), bodyReader)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
			return
		}
		for key, value := range req.Headers {
			upstreamReq.Header.Set(key, value)
		}

		client := &http.Client{Timeout: 60 * time.Second}
		resp, err := client.Do(upstreamReq)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"upstream: %s"}`, err.Error()), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		copyResponse(w, resp)
	}
}

func (g *Gateway) handleMultipartUpload(route RouteConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		if !g.verifySecret(r) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		var req MultipartUploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}

		targetURL, err := validateForwardTarget(req.URL, route.AllowedHosts)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
			return
		}
		if req.FileName == "" || req.FileData == "" {
			http.Error(w, `{"error":"file_name and file_data are required"}`, http.StatusBadRequest)
			return
		}

		fileBytes, err := base64.StdEncoding.DecodeString(req.FileData)
		if err != nil {
			http.Error(w, `{"error":"invalid base64 file_data"}`, http.StatusBadRequest)
			return
		}

		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		formField := route.FormFieldName
		if formField == "" {
			formField = "file"
		}

		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, formField, escapeMultipartValue(req.FileName)))
		if req.MimeType != "" {
			header.Set("Content-Type", req.MimeType)
		}

		part, err := writer.CreatePart(header)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}
		if _, err := part.Write(fileBytes); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}
		if err := writer.Close(); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}

		upstreamReq, err := http.NewRequest(http.MethodPost, targetURL.String(), &body)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
			return
		}
		upstreamReq.Header.Set("Content-Type", writer.FormDataContentType())

		client := &http.Client{Timeout: 60 * time.Second}
		resp, err := client.Do(upstreamReq)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"upstream: %s"}`, err.Error()), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		copyResponse(w, resp)
	}
}

func validateForwardTarget(rawURL string, allowedHosts []string) (*url.URL, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, fmt.Errorf("url must include a host")
	}

	for _, allowedHost := range allowedHosts {
		if strings.EqualFold(strings.TrimSpace(allowedHost), host) {
			return parsed, nil
		}
	}

	return nil, fmt.Errorf("domain not allowed: %s", host)
}

func copyResponse(w http.ResponseWriter, resp *http.Response) {
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.Header().Set("X-Proxy-Status", fmt.Sprintf("%d", resp.StatusCode))
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func escapeMultipartValue(value string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value)
}
