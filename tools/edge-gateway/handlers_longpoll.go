package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// --- iLink Bot API types ---

type ilinkBaseInfo struct {
	ChannelVersion string `json:"channel_version"`
}

type ilinkMessageItem struct {
	Type      int              `json:"type"`
	TextItem  *ilinkTextItem   `json:"text_item,omitempty"`
	ImageItem *json.RawMessage `json:"image_item,omitempty"`
	VoiceItem *json.RawMessage `json:"voice_item,omitempty"`
	FileItem  *json.RawMessage `json:"file_item,omitempty"`
	VideoItem *json.RawMessage `json:"video_item,omitempty"`
	RefMsg    *json.RawMessage `json:"ref_msg,omitempty"`
}

type ilinkTextItem struct {
	Text string `json:"text"`
}

type ilinkMessage struct {
	MessageID    int64              `json:"message_id"`
	FromUserID   string             `json:"from_user_id"`
	ToUserID     string             `json:"to_user_id"`
	ClientID     string             `json:"client_id"`
	CreateTimeMs int64              `json:"create_time_ms"`
	MessageType  int                `json:"message_type"`
	MessageState int                `json:"message_state"`
	ContextToken string             `json:"context_token"`
	ItemList     []ilinkMessageItem `json:"item_list"`
}

type ilinkGetUpdatesResp struct {
	Ret           int            `json:"ret"`
	Msgs          []ilinkMessage `json:"msgs"`
	GetUpdatesBuf string         `json:"get_updates_buf"`
	ErrCode       int            `json:"errcode"`
	ErrMsg        string         `json:"errmsg"`
}

// --- Bridge state ---

type longpollBridgeState struct {
	mu            sync.RWMutex
	contextTokens map[string]string // userId -> latest context_token
	botToken      string
	botID         string
	baseURL       string
	cursor        string
	status        string // "running", "stopped", "login_required"
	lastError     string
	lastPollAt    time.Time
}

func newLongpollBridgeState() *longpollBridgeState {
	return &longpollBridgeState{
		contextTokens: make(map[string]string),
		status:        "stopped",
	}
}

func (s *longpollBridgeState) setContextToken(userId, token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.contextTokens[userId] = token
}

func (s *longpollBridgeState) getContextToken(userId string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.contextTokens[userId]
	return t, ok
}

func (s *longpollBridgeState) setStatus(status, lastErr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = status
	s.lastError = lastErr
	s.lastPollAt = time.Now()
}

func (s *longpollBridgeState) getStatus() (string, string, time.Time) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status, s.lastError, s.lastPollAt
}

// --- Long-poll loop ---

func (g *Gateway) startLongpollBridge(route RouteConfig) {
	state := newLongpollBridgeState()
	g.bridgeStates[route.ID] = state

	go g.longpollLoop(route, state)
}

func (g *Gateway) longpollLoop(route RouteConfig, state *longpollBridgeState) {
	retryDelay := 2 * time.Second

	for {
		token, err := g.resolveBridgeCredential(route, "bot_token")
		if err != nil {
			log.Printf("[ilink-bridge:%s] failed to resolve bot_token: %v", route.ID, err)
			state.setStatus("login_required", err.Error())
			time.Sleep(30 * time.Second)
			continue
		}

		baseURL := route.LongpollBridge.APIBase
		if baseURL == "" {
			baseURL = "https://ilinkai.weixin.qq.com"
		}

		state.mu.Lock()
		state.botToken = token
		state.baseURL = baseURL
		state.status = "running"
		state.mu.Unlock()

		log.Printf("[ilink-bridge:%s] poll loop started, base=%s", route.ID, baseURL)

		for {
			msgs, newCursor, err := g.ilinkGetUpdates(baseURL, token, state.cursor)
			if err != nil {
				if isIlinkSessionExpired(err) {
					log.Printf("[ilink-bridge:%s] session expired, need re-login", route.ID)
					state.setStatus("login_required", "session expired (errcode -14)")
					state.mu.Lock()
					state.cursor = ""
					state.contextTokens = make(map[string]string)
					state.mu.Unlock()
					break
				}

				log.Printf("[ilink-bridge:%s] poll error: %v (retry in %v)", route.ID, err, retryDelay)
				state.setStatus("running", err.Error())
				time.Sleep(retryDelay)
				retryDelay = min(retryDelay*2, 30*time.Second)
				continue
			}

			retryDelay = 2 * time.Second
			if newCursor != "" {
				state.mu.Lock()
				state.cursor = newCursor
				state.mu.Unlock()
			}
			state.setStatus("running", "")

			for _, msg := range msgs {
				g.rememberIlinkContext(state, &msg)

				if msg.MessageType != 1 { // only forward USER messages
					continue
				}

				go g.forwardToWebhook(route, state, &msg)
			}
		}

		time.Sleep(30 * time.Second)
	}
}

func (g *Gateway) ilinkGetUpdates(baseURL, token, cursor string) ([]ilinkMessage, string, error) {
	body := map[string]any{
		"get_updates_buf": cursor,
		"base_info":       ilinkBaseInfo{ChannelVersion: " "},
	}
	bodyBytes, _ := json.Marshal(body)

	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/ilink/bot/getupdates", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("AuthorizationType", "ilink_bot_token")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, "", err
	}

	var result ilinkGetUpdatesResp
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, "", fmt.Errorf("decode error: %w", err)
	}

	if result.Ret != 0 {
		return nil, "", &ilinkAPIError{Code: result.ErrCode, Msg: result.ErrMsg, Ret: result.Ret}
	}

	return result.Msgs, result.GetUpdatesBuf, nil
}

func (g *Gateway) rememberIlinkContext(state *longpollBridgeState, msg *ilinkMessage) {
	var userId string
	if msg.MessageType == 1 { // USER
		userId = msg.FromUserID
	} else {
		userId = msg.ToUserID
	}
	if userId != "" && msg.ContextToken != "" {
		state.setContextToken(userId, msg.ContextToken)
	}
}

func (g *Gateway) forwardToWebhook(route RouteConfig, state *longpollBridgeState, msg *ilinkMessage) {
	webhookURL := route.LongpollBridge.WebhookTarget
	if webhookURL == "" {
		log.Printf("[ilink-bridge:%s] no webhook_target configured, dropping message", route.ID)
		return
	}

	text := extractIlinkText(msg)
	msgType := detectIlinkMsgType(msg)

	payload := map[string]any{
		"message_id":    msg.MessageID,
		"from_user_id":  msg.FromUserID,
		"to_user_id":    msg.ToUserID,
		"client_id":     msg.ClientID,
		"create_time_ms": msg.CreateTimeMs,
		"message_type":  msgType,
		"text":          text,
		"context_token": msg.ContextToken,
		"item_list":     msg.ItemList,
	}
	payloadBytes, _ := json.Marshal(payload)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("[ilink-bridge:%s] webhook request build error: %v", route.ID, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gateway-Secret", g.secret)
	req.Header.Set("X-Bridge-Source", "ilink")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[ilink-bridge:%s] webhook forward error: %v", route.ID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		log.Printf("[ilink-bridge:%s] webhook returned %d: %s", route.ID, resp.StatusCode, string(body))
	}
}

// --- HTTP handlers for reply/typing/status ---

type bridgeReplyRequest struct {
	UserID string `json:"user_id"`
	Text   string `json:"text"`
}

type bridgeTypingRequest struct {
	UserID string `json:"user_id"`
	Status int    `json:"status"` // 1=start, 2=stop
}

func (g *Gateway) handleLongpollReply(route RouteConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		if !g.verifySecret(r) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		state, ok := g.bridgeStates[route.ID]
		if !ok {
			http.Error(w, `{"error":"bridge not initialized"}`, http.StatusInternalServerError)
			return
		}

		var req bridgeReplyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}
		if req.UserID == "" || req.Text == "" {
			http.Error(w, `{"error":"user_id and text are required"}`, http.StatusBadRequest)
			return
		}

		ctxToken, ok := state.getContextToken(req.UserID)
		if !ok {
			http.Error(w, `{"error":"no context_token for this user, user must send a message first"}`, http.StatusPreconditionFailed)
			return
		}

		if err := g.ilinkSendMessage(state.baseURL, state.botToken, req.UserID, ctxToken, req.Text); err != nil {
			log.Printf("[ilink-bridge:%s] send error: %v", route.ID, err)
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (g *Gateway) handleLongpollTyping(route RouteConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		if !g.verifySecret(r) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		state, ok := g.bridgeStates[route.ID]
		if !ok {
			http.Error(w, `{"error":"bridge not initialized"}`, http.StatusInternalServerError)
			return
		}

		var req bridgeTypingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}
		if req.UserID == "" {
			http.Error(w, `{"error":"user_id is required"}`, http.StatusBadRequest)
			return
		}

		ctxToken, ok := state.getContextToken(req.UserID)
		if !ok {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "no context_token"})
			return
		}

		status := req.Status
		if status == 0 {
			status = 1
		}

		if err := g.ilinkSendTyping(state.baseURL, state.botToken, req.UserID, ctxToken, status); err != nil {
			log.Printf("[ilink-bridge:%s] typing error: %v", route.ID, err)
		}

		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (g *Gateway) handleLongpollStatus(route RouteConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !g.verifySecret(r) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		state, ok := g.bridgeStates[route.ID]
		if !ok {
			http.Error(w, `{"error":"bridge not initialized"}`, http.StatusInternalServerError)
			return
		}

		status, lastErr, lastPoll := state.getStatus()
		state.mu.RLock()
		tokenCount := len(state.contextTokens)
		state.mu.RUnlock()

		writeJSON(w, http.StatusOK, map[string]any{
			"ok":                  true,
			"bridge_id":           route.ID,
			"status":              status,
			"last_error":          lastErr,
			"last_poll_at":        lastPoll.Format(time.RFC3339),
			"active_context_count": tokenCount,
		})
	}
}

// --- iLink Bot API calls ---

func (g *Gateway) ilinkSendMessage(baseURL, token, userId, ctxToken, text string) error {
	clientID := fmt.Sprintf("gw_%d", time.Now().UnixMilli())
	msg := map[string]any{
		"msg": map[string]any{
			"from_user_id":  "",
			"to_user_id":    userId,
			"client_id":     clientID,
			"message_type":  2, // BOT
			"message_state": 2, // FINISH
			"context_token": ctxToken,
			"item_list": []map[string]any{
				{"type": 1, "text_item": map[string]string{"text": text}},
			},
		},
		"base_info": ilinkBaseInfo{ChannelVersion: " "},
	}

	return g.ilinkPost(baseURL, token, "/ilink/bot/sendmessage", msg)
}

func (g *Gateway) ilinkSendTyping(baseURL, token, userId, ctxToken string, status int) error {
	configBody := map[string]any{
		"ilink_user_id": userId,
		"context_token": ctxToken,
		"base_info":     ilinkBaseInfo{ChannelVersion: " "},
	}
	configBytes, _ := json.Marshal(configBody)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/ilink/bot/getconfig", bytes.NewReader(configBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("AuthorizationType", "ilink_bot_token")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var configResp struct {
		TypingTicket string `json:"typing_ticket"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&configResp); err != nil {
		return err
	}
	if configResp.TypingTicket == "" {
		return nil
	}

	typingBody := map[string]any{
		"ilink_user_id":  userId,
		"typing_ticket":  configResp.TypingTicket,
		"status":         status,
		"base_info":      ilinkBaseInfo{ChannelVersion: " "},
	}
	return g.ilinkPost(baseURL, token, "/ilink/bot/sendtyping", typingBody)
}

func (g *Gateway) ilinkPost(baseURL, token, path string, body any) error {
	bodyBytes, _ := json.Marshal(body)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("AuthorizationType", "ilink_bot_token")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ilink %s returned %d: %s", path, resp.StatusCode, string(respBody))
	}

	var result struct {
		Ret     int    `json:"ret"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(respBody, &result); err == nil && result.Ret != 0 {
		return &ilinkAPIError{Code: result.ErrCode, Msg: result.ErrMsg, Ret: result.Ret}
	}

	return nil
}

// --- helpers ---

type ilinkAPIError struct {
	Code int
	Msg  string
	Ret  int
}

func (e *ilinkAPIError) Error() string {
	return fmt.Sprintf("ilink api error: ret=%d errcode=%d errmsg=%s", e.Ret, e.Code, e.Msg)
}

func isIlinkSessionExpired(err error) bool {
	if apiErr, ok := err.(*ilinkAPIError); ok {
		return apiErr.Code == -14
	}
	return false
}

func extractIlinkText(msg *ilinkMessage) string {
	var parts []string
	for _, item := range msg.ItemList {
		switch item.Type {
		case 1: // TEXT
			if item.TextItem != nil {
				parts = append(parts, item.TextItem.Text)
			}
		case 2: // IMAGE
			parts = append(parts, "[image]")
		case 3: // VOICE
			parts = append(parts, "[voice]")
		case 4: // FILE
			parts = append(parts, "[file]")
		case 5: // VIDEO
			parts = append(parts, "[video]")
		}
	}
	return strings.Join(parts, "\n")
}

func detectIlinkMsgType(msg *ilinkMessage) string {
	if len(msg.ItemList) == 0 {
		return "text"
	}
	switch msg.ItemList[0].Type {
	case 2:
		return "image"
	case 3:
		return "voice"
	case 4:
		return "file"
	case 5:
		return "video"
	default:
		return "text"
	}
}

func (g *Gateway) resolveBridgeCredential(route RouteConfig, key string) (string, error) {
	tmpl, ok := route.LongpollBridge.Credentials[key]
	if !ok {
		return "", fmt.Errorf("credential %q not defined", key)
	}
	return g.resolveTemplateValue(context.Background(), tmpl)
}
