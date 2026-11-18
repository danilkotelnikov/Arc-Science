package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	mrand "math/rand/v2"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	cfgFn     func() Config // read per request, so edits to gateway.json apply at once
	sigs      *sigStore
	vertex    *vertexAuth
	api       *http.Client // AI providers: HTTP/1.1 keep-alive pool, no total timeout (answers stream for minutes)
	cammut    *http.Client // Cammut: headers must arrive within 300 s
	tokenHash [32]byte
	started   time.Time
	logUsage  func(line []byte)
	cammutUp  sync.Map // upstream -> last error text ("" = fine)
	paceMu          sync.Mutex
	sems            map[string]chan struct{}
	lastHit         map[string]time.Time
	vertexHeartbeat time.Duration // SSE reasoning keepalive interval for slow-TTFB Vertex streams (e.g. Carbon); <=0 disables
	retryWaits      []time.Duration
}

func (s *Server) vertexRetryWaits() []time.Duration {
	if len(s.retryWaits) > 0 {
		return s.retryWaits
	}
	return []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 12 * time.Second, 16 * time.Second}
}

func newTransport() *http.Transport {
	return &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
		ExpectContinueTimeout: time.Second,
		ForceAttemptHTTP2:     true,
	}
}

// newAPITransport uses dedicated HTTP/1.1 keep-alive connections so concurrent AI streams over
// VPN/TUN proxies never suffer HTTP/2 head-of-line blocking or silently blackholed single-socket stalls.
func newAPITransport() *http.Transport {
	return &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 15 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       60 * time.Second,
		ExpectContinueTimeout: time.Second,
		WriteBufferSize:       64 << 10,
		ReadBufferSize:        64 << 10,
		ForceAttemptHTTP2:     false,
		TLSNextProto:          map[string]func(string, *tls.Conn) http.RoundTripper{},
	}
}

func NewServer(cfgFn func() Config) *Server {
	ct := newTransport()
	ct.ResponseHeaderTimeout = 300 * time.Second
	s := &Server{
		cfgFn:   cfgFn,
		sigs:    newSigStore(filepath.Join(Home(), "thought-signatures.json")),
		api:     &http.Client{Transport: newAPITransport(), CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		cammut:  &http.Client{Transport: ct},
		started: time.Now(),
		sems:            map[string]chan struct{}{},
		lastHit:         map[string]time.Time{},
		vertexHeartbeat: 25 * time.Second,
	}
	s.vertex = &vertexAuth{client: &http.Client{Timeout: 20 * time.Second}}
	s.tokenHash = sha256.Sum256([]byte(loadOrCreateToken()))
	s.logUsage = func(line []byte) {
		p := filepath.Join(Home(), "logs", "cammut-usage.jsonl")
		_ = os.MkdirAll(filepath.Dir(p), 0o700)
		if f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
			f.Write(append(line, '\n'))
			f.Close()
		}
	}
	return s
}

// The token protects settings changes. Created once, 64 hex chars, readable only by the owner.
func loadOrCreateToken() string {
	p := filepath.Join(Home(), ".gateway-token")
	if b, err := os.ReadFile(p); err == nil {
		if t := strings.TrimSpace(string(b)); regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(t) {
			return t
		}
	}
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	t := hex.EncodeToString(buf)
	_ = os.MkdirAll(Home(), 0o700)
	_ = os.WriteFile(p, []byte(t+"\n"), 0o600)
	return t
}

func (s *Server) tokenOK(h string) bool {
	sum := sha256.Sum256([]byte(h))
	return h != "" && subtle.ConstantTimeCompare(sum[:], s.tokenHash[:]) == 1
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

var dropReq = map[string]bool{"host": true, "connection": true, "content-length": true, "x-arc-gateway-token": true,
	"accept-encoding": true, "keep-alive": true, "proxy-connection": true, "te": true, "trailer": true, "transfer-encoding": true, "upgrade": true}
var dropResp = map[string]bool{"content-encoding": true, "transfer-encoding": true, "content-length": true, "connection": true}

// readBody reads the whole request body. Too large gives 413; a broken upload gives 400.
func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	b, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "request body broke off"})
		return nil, false
	}
	if int64(len(b)) > limit {
		writeJSON(w, 413, map[string]string{"error": "request body too large"})
		return nil, false
	}
	return b, true
}

// isDialError is true when the connection never opened, so the request surely did not reach that upstream.
func isDialError(err error) bool {
	var op *net.OpError
	return errors.As(err, &op) && op.Op == "dial"
}

// subPath returns the still-encoded path after prefix, or false when a segment climbs with "..".
func subPath(r *http.Request, prefix string) (string, bool) {
	p := strings.TrimPrefix(r.URL.EscapedPath(), prefix)
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." || strings.EqualFold(seg, "%2e%2e") || strings.EqualFold(seg, ".%2e") || strings.EqualFold(seg, "%2e.") {
			return "", false
		}
	}
	return p, true
}

func copyReqHeaders(r *http.Request) http.Header {
	h := http.Header{}
	for k, v := range r.Header {
		if !dropReq[strings.ToLower(k)] {
			h[k] = v
		}
	}
	return h
}

func copyRespHeaders(w http.ResponseWriter, up *http.Response) {
	for k, v := range up.Header {
		if !dropResp[strings.ToLower(k)] {
			w.Header()[k] = v
		}
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cfg := s.cfgFn()
	own := map[string]bool{fmt.Sprintf("127.0.0.1:%d", cfg.Port): true, fmt.Sprintf("localhost:%d", cfg.Port): true}
	// Blocks DNS rebinding (Host) and requests from web pages (Origin); the own settings page sends its own origin.
	if !own[strings.ToLower(r.Host)] || (r.Header.Get("Origin") != "" && !own[strings.TrimPrefix(r.Header.Get("Origin"), "http://")]) {
		writeJSON(w, 403, map[string]string{"error": "forbidden host or origin"})
		return
	}
	switch p := r.URL.Path; {
	case p == "/" || p == "/settings" || p == "/ui":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, settingsHTML(cfg))
	case p == "/api/config":
		s.handleConfig(w, r, cfg)
	case p == "/health":
		s.handleHealth(w, cfg)
	case strings.HasPrefix(p, "/cammut"):
		s.handleCammut(w, r, cfg)
	default:
		s.handleRoute(w, r, cfg)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, cfg Config) {
	ups := map[string]string{}
	s.cammutUp.Range(func(k, v any) bool { ups[k.(string)] = v.(string); return true })
	routes := []string{}
	for _, rt := range cfg.Routes {
		routes = append(routes, rt.Prefix)
	}
	writeJSON(w, 200, map[string]any{"status": "ok", "version": version, "uptimeSeconds": int(time.Since(s.started).Seconds()),
		"routes": routes, "cammut": fmt.Sprintf("http://127.0.0.1:%d/cammut/mcp", cfg.Port), "cammutUpstreams": ups})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request, cfg Config) {
	if r.Method == http.MethodGet {
		refs := LoadRefs()
		keys := map[string]bool{}
		for _, rt := range cfg.Routes {
			if rt.KeyRef != "" {
				keys[rt.KeyRef] = refs[rt.KeyRef] != ""
			}
		}
		writeJSON(w, 200, map[string]any{"defaultReasoningEffort": cfg.DefaultReasoningEffort, "forceReasoningEffort": cfg.ForceReasoningEffort,
			"temperature": cfg.Temperature, "maxTokens": cfg.MaxTokens, "keys": keys})
		return
	}
	if !s.tokenOK(r.Header.Get("X-Arc-Gateway-Token")) {
		writeJSON(w, 401, map[string]string{"error": "gateway token required"})
		return
	}
	var body map[string]any
	if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "bad JSON"})
		return
	}
	if keys := obj(body["keys"]); keys != nil {
		for k, v := range keys {
			if sv, ok := v.(string); ok {
				_ = SaveRef(k, sv)
			}
		}
	}
	updated, err := SaveSettings(body)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"saved": true, "defaultReasoningEffort": updated.DefaultReasoningEffort})
}

// handleCammut forwards to Cammut, adds its Authorization, and slims memory answers.
func (s *Server) handleCammut(w http.ResponseWriter, r *http.Request, cfg Config) {
	sub, ok := subPath(r, "/cammut")
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "bad path"})
		return
	}
	if sub == "" {
		sub = "/mcp"
	}
	body, ok := readBody(w, r, 32<<20)
	if !ok {
		return
	}
	g := cfg.Cammut.Governor
	cr := capResult{Body: body}
	if r.Method == http.MethodPost && len(body) > 0 {
		cr = capRequest(body, g)
	}
	h := copyReqHeaders(r)
	if auth := CammutAuth(cfg); auth != "" {
		h.Set("Authorization", auth)
	}
	var up *http.Response
	var lastErr error
	for _, base := range cfg.Cammut.Upstreams {
		var rb io.Reader
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			rb = bytes.NewReader(cr.Body)
		}
		req, err := http.NewRequestWithContext(r.Context(), r.Method, strings.TrimRight(base, "/")+sub+queryOf(r), rb)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header = h.Clone()
		up, err = s.cammut.Do(req)
		if err == nil {
			s.cammutUp.Store(base, "")
			break
		}
		s.cammutUp.Store(base, err.Error())
		lastErr = err
		up = nil
		if r.Context().Err() != nil {
			return
		}
		// Only a connection that never opened is tried elsewhere; a request that went out may have run.
		if !isDialError(err) {
			break
		}
	}
	if up == nil {
		log.Printf("cammut: no upstream answered: %v", lastErr)
		writeJSON(w, 502, map[string]string{"error": "Cammut is not reachable", "detail": fmt.Sprint(lastErr)})
		return
	}
	defer up.Body.Close()
	copyRespHeaders(w, up)
	if cr.IsRecall {
		raw, err := io.ReadAll(up.Body)
		if err != nil {
			writeJSON(w, 502, map[string]string{"error": "Cammut answer broke off"})
			return
		}
		gg := g
		if cr.Lab {
			gg.SwapRate = 0
		}
		var tr Trace
		res := governResponse(string(raw), up.Header.Get("Content-Type"), gg, nil, &tr)
		if res != nil && !cr.Lab && g.UsageLog && len(tr.Shown) > 0 {
			line, _ := json.Marshal(map[string]any{"at": time.Now().UTC().Format(time.RFC3339Nano), "query": cr.Query,
				"order": tr.Order, "shown": tr.Shown, "swaps": tr.Swaps, "from": tr.From})
			go s.logUsage(line)
		}
		w.WriteHeader(up.StatusCode)
		if res != nil {
			log.Printf("governor: recall %d -> %d chars, kept %d, omitted %d", res.FromChars, res.ToChars, res.Kept, res.Omitted)
			_, _ = io.WriteString(w, res.Text)
		} else {
			_, _ = w.Write(raw)
		}
		return
	}
	w.WriteHeader(up.StatusCode)
	stream(w, up.Body, nil)
}

func queryOf(r *http.Request) string {
	if r.URL.RawQuery == "" {
		return ""
	}
	return "?" + r.URL.RawQuery
}

// stream copies the answer and flushes each chunk, so streamed tokens reach the client at once.
// A broken upstream aborts the reply, so the client sees a cut answer, never a short "complete" one.
func stream(w http.ResponseWriter, body io.Reader, onChunk func([]byte)) {
	fl, _ := w.(http.Flusher)
	buf := make([]byte, 32<<10)
	for {
		n, err := body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if fl != nil {
				fl.Flush()
			}
			if onChunk != nil {
				onChunk(buf[:n])
			}
		}
		if err == io.EOF {
			return
		}
		if err != nil {
			panic(http.ErrAbortHandler)
		}
	}
}

var doubled = strings.NewReplacer("/responses/responses", "/responses", "/chat/completions/chat/completions", "/chat/completions")

func (s *Server) handleRoute(w http.ResponseWriter, r *http.Request, cfg Config) {
	var rt *Route
	for i := range cfg.Routes {
		p := cfg.Routes[i].Prefix
		if r.URL.Path == p || strings.HasPrefix(r.URL.Path, p+"/") {
			rt = &cfg.Routes[i]
			break
		}
	}
	if rt == nil {
		http.NotFound(w, r)
		return
	}
	raw, ok := subPath(r, rt.Prefix)
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "bad path"})
		return
	}
	sub := doubled.Replace(raw)
	target := rt.Target
	if rt.Auth == "vertex" && target == "" {
		loc := rt.VertexLocation
		if loc == "" {
			loc = "global"
		}
		proj := rt.VertexProject
		if proj == "" {
			proj = os.Getenv("GOOGLE_CLOUD_PROJECT")
		}
		target = fmt.Sprintf("https://aiplatform.googleapis.com/v1/projects/%s/locations/%s/endpoints/openapi", proj, loc)
	}
	h := copyReqHeaders(r)
	refs := LoadRefs()
	switch {
	case rt.Anthropic || rt.Auth == "x-api-key":
		h.Del("Authorization")
		h.Del("X-Api-Key")
		if k := refs[rt.KeyRef]; k != "" {
			h.Set("X-Api-Key", k)
		}
	case rt.Auth == "vertex":
		tok, err := s.vertex.Token()
		if err != nil {
			writeJSON(w, 502, map[string]string{"error": err.Error()})
			return
		}
		h.Set("Authorization", "Bearer "+tok)
	case rt.Auth == "none":
	default:
		if k := refs[rt.KeyRef]; k != "" {
			h.Set("Authorization", "Bearer "+k)
		}
	}

	body, ok := readBody(w, r, 64<<20)
	if !ok {
		return
	}
	var parsed map[string]any
	var preCache []byte
	injectedThinkingCfg := false
	reqModel := ""
	reqStart := time.Now()
	cache := cfg.PromptCaching
	if r.Method == http.MethodPost && len(body) > 0 {
		if rt.Anthropic && strings.HasSuffix(sub, "/messages") && cache.Enabled {
			body, _ = applyAnthropicCache(body, true, cache.TTL)
		} else if !rt.Anthropic && json.Unmarshal(body, &parsed) == nil && parsed != nil {
			reqModel, _ = parsed["model"].(string)
			snapshot := marshal(parsed)
			injectedThinkingCfg = s.tuneRequest(parsed, cfg, rt)
			before := body // nothing changed: send the caller's own bytes, key order intact
			if after := marshal(parsed); after != snapshot {
				before = []byte(after)
			}
			body = before
			if strings.HasSuffix(sub, "/chat/completions") && cache.Enabled {
				if nb, ok := applyAnthropicCache(before, false, cache.TTL); ok {
					preCache, body = before, nb
				}
			}
		} else {
			parsed = nil
		}
	}

	reqStream := false
	if parsed != nil {
		reqStream, _ = parsed["stream"].(bool)
	}
	rawBodyLen := len(body)
	wireBodyLen := rawBodyLen
	send := func(b []byte) (*http.Response, error) {
		hdr := h.Clone()
		payload := b
		if r.Method != http.MethodGet && r.Method != http.MethodHead && rt.compressRequestsEnabled() && len(b) >= 8192 && hdr.Get("Content-Encoding") == "" {
			if gz, ok := gzipBytes(b); ok && len(gz) < len(b) {
				payload = gz
				hdr.Set("Content-Encoding", "gzip")
			}
		}
		wireBodyLen = len(payload)
		var rb io.Reader
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			rb = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(r.Context(), r.Method, target+sub+queryOf(r), rb)
		if err != nil {
			return nil, err
		}
		req.Header = hdr
		return s.api.Do(req)
	}

	type upResult struct {
		up      *http.Response
		release func()
		err     error
	}
	doUpstream := func() upResult {
		var release func()
		if maxConc := rt.maxConcurrentCap(); maxConc > 0 && r.Method == http.MethodPost {
			var ok bool
			release, ok = s.acquireRouteSlot(r.Context(), rt.Prefix, maxConc)
			if !ok {
				return upResult{err: context.Canceled}
			}
		}
		free := func() {
			if release != nil {
				release()
				release = nil
			}
		}
		up, err := send(body)
		// The upstream refused cache_control blocks: send again without them.
		if err == nil && up.StatusCode == 400 && preCache != nil && cache.AutoFallbackNoCache {
			up.Body.Close()
			up, err = send(preCache)
		}
		// Vertex refused injected thinking_config (e.g. non-thinking model): strip it and retry once.
		if err == nil && up.StatusCode == 400 && parsed != nil && injectedThinkingCfg {
			up.Body.Close()
			stripVertexThinkingConfig(parsed)
			injectedThinkingCfg = false
			body = []byte(marshal(parsed))
			up, err = send(body)
		}
		// The model refused reasoning_effort / reasoning: send again without them.
		if err == nil && up.StatusCode == 400 && parsed != nil && cfg.AutoFallbackNoReasoning && (parsed["reasoning_effort"] != nil || parsed["reasoning"] != nil) {
			up.Body.Close()
			delete(parsed, "reasoning_effort")
			delete(parsed, "reasoning")
			body = []byte(marshal(parsed))
			up, err = send(body)
		}
		// Vertex AI Dynamic Shared Quota (429), concurrency abort (409), or transient 503:
		// back off with jitter (respecting Retry-After) and step down thinking level to LOW on retry.
		if rt.Auth == "vertex" && r.Method == http.MethodPost {
			baseWaits := s.vertexRetryWaits()
			for attempt, baseWait := range baseWaits {
				if err != nil || (up.StatusCode != 429 && up.StatusCode != 409 && up.StatusCode != 503) {
					break
				}
				code := up.StatusCode
				wait := jitterDuration(baseWait)
				if ra := parseRetryAfter(up.Header.Get("Retry-After")); ra > 0 {
					if ra > 20*time.Second {
						ra = 20 * time.Second
					}
					wait = ra
				}
				up.Body.Close()
				t := time.NewTimer(wait)
				select {
				case <-r.Context().Done():
					t.Stop()
					free()
					return upResult{err: context.Canceled}
				case <-t.C:
				}
				retryBody := body
				if parsed != nil && stepDownVertexEffort(parsed) {
					retryBody = []byte(marshal(parsed))
					body = retryBody
				}
				log.Printf("vertex: retry %d model=%s after HTTP %d (wait=%dms)", attempt+1, reqModel, code, wait.Milliseconds())
				up, err = send(retryBody)
			}
			if err == nil && up.StatusCode == 429 && up.Header.Get("Retry-After") == "" {
				up.Header.Set("Retry-After", "5")
			}
		}
		if err != nil {
			free()
			return upResult{err: err}
		}
		return upResult{up: up, release: release}
	}

	useHeartbeat := reqStream && r.Method == http.MethodPost && strings.HasSuffix(sub, "/chat/completions") &&
		s.vertexHeartbeat > 0 && (rt.Auth == "vertex" || rt.streamThoughtsEnabled())
	var res upResult
	headersSent := false
	heartbeats := 0
	if !useHeartbeat {
		res = doUpstream()
	} else {
		resCh := make(chan upResult, 1)
		go func() { resCh <- doUpstream() }()
		ticker := time.NewTicker(s.vertexHeartbeat)
		defer ticker.Stop()
		fl, _ := w.(http.Flusher)
	waitLoop:
		for {
			select {
			case res = <-resCh:
				break waitLoop
			case <-r.Context().Done():
				return
			case <-ticker.C:
				if !headersSent {
					w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
					w.Header().Set("Cache-Control", "no-cache")
					w.Header().Set("X-Accel-Buffering", "no")
					w.WriteHeader(http.StatusOK)
					headersSent = true
				}
				if !writeVertexHeartbeat(w, reqModel) {
					return
				}
				if fl != nil {
					fl.Flush()
				}
				heartbeats++
			}
		}
	}
	if res.release != nil {
		defer res.release()
	}
	up, err := res.up, res.err
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if headersSent {
			writeVertexSSEError(w, 502, err.Error())
			return
		}
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	defer up.Body.Close()
	ttfbMs := time.Since(reqStart).Milliseconds()

	if headersSent {
		if up.StatusCode >= 300 {
			errBody, _ := io.ReadAll(io.LimitReader(up.Body, 4096))
			msg := strings.TrimSpace(string(errBody))
			if up.StatusCode == 429 && (rt.Auth == "vertex" || strings.HasPrefix(rt.Prefix, "/vertex")) {
				msg = "Vertex AI temporary rate limit (HTTP 429). Retry with backoff."
			} else if msg == "" {
				msg = fmt.Sprintf("upstream HTTP %d", up.StatusCode)
			}
			writeVertexSSEError(w, up.StatusCode, msg)
			log.Printf("vertex: model=%s status=%d ttfb=%dms total=%dms req=%dB->%dB heartbeats=%d", reqModel, up.StatusCode, ttfbMs, time.Since(reqStart).Milliseconds(), rawBodyLen, wireBodyLen, heartbeats)
			return
		}
		midHB := s.streamVertexSSE(w, up.Body, reqModel, s.vertexHeartbeat)
		log.Printf("vertex: model=%s status=%d ttfb=%dms total=%dms req=%dB->%dB sse-thoughts=1 heartbeats=%d", reqModel, up.StatusCode, ttfbMs, time.Since(reqStart).Milliseconds(), rawBodyLen, wireBodyLen, heartbeats+midHB)
		return
	}

	// Vertex AI returns HTTP 429 with "Quota exceeded ..." text on transient per-minute DSQ bursts.
	// Normalize transient 429 bodies to standard rate_limit_exceeded JSON so downstream clients
	// (arc-llm) execute their retryPolicy backoff instead of aborting as terminal account QUOTA.
	if up.StatusCode == 429 && (rt.Auth == "vertex" || strings.HasPrefix(rt.Prefix, "/vertex")) {
		_, _ = io.Copy(io.Discard, io.LimitReader(up.Body, 64<<10))
		copyRespHeaders(w, up)
		if w.Header().Get("Retry-After") == "" {
			w.Header().Set("Retry-After", "5")
		}
		writeJSON(w, 429, map[string]any{
			"error": map[string]any{
				"type":    "rate_limit_exceeded",
				"code":    "rate_limit_exceeded",
				"message": "Vertex AI temporary rate limit (HTTP 429). Retry with backoff.",
			},
		})
		log.Printf("vertex: model=%s status=429 (normalized rate_limit_exceeded) ttfb=%dms total=%dms req=%dB->%dB", reqModel, ttfbMs, time.Since(reqStart).Milliseconds(), rawBodyLen, wireBodyLen)
		return
	}

	if rt.NormalizeModels && r.Method == http.MethodGet && sub == "/models" && up.StatusCode == 200 {
		rawList, rerr := io.ReadAll(up.Body)
		var j map[string]any
		if rerr == nil && json.Unmarshal(rawList, &j) == nil {
			for _, m := range asList(j["data"]) {
				if m["id"] == nil {
					m["id"] = m["model"]
				}
				if m["object"] == nil {
					m["object"] = "model"
				}
			}
			writeJSON(w, 200, j)
			return
		}
		if rerr != nil {
			panic(http.ErrAbortHandler)
		}
		copyRespHeaders(w, up)
		w.WriteHeader(up.StatusCode)
		_, _ = w.Write(rawList)
		return
	}
	copyRespHeaders(w, up)
	w.WriteHeader(up.StatusCode)
	capture := up.StatusCode < 300 && r.Method == http.MethodPost && strings.HasSuffix(sub, "/chat/completions")
	if !capture {
		stream(w, up.Body, nil)
		if rt.Auth == "vertex" && r.Method == http.MethodPost {
			log.Printf("vertex: model=%s status=%d ttfb=%dms total=%dms req=%dB->%dB", reqModel, up.StatusCode, ttfbMs, time.Since(reqStart).Milliseconds(), rawBodyLen, wireBodyLen)
		}
		return
	}
	isSSE := strings.Contains(strings.ToLower(up.Header.Get("Content-Type")), "text/event-stream")
	if isSSE && (rt.Auth == "vertex" || rt.streamThoughtsEnabled()) && rt.streamThoughtsEnabled() {
		midHB := s.streamVertexSSE(w, up.Body, reqModel, s.vertexHeartbeat)
		log.Printf("vertex: model=%s status=%d ttfb=%dms total=%dms req=%dB->%dB sse-thoughts=1 heartbeats=%d", reqModel, up.StatusCode, ttfbMs, time.Since(reqStart).Milliseconds(), rawBodyLen, wireBodyLen, midHB)
		return
	}
	byIndex := map[int]*[2]string{}
	var pending []byte
	stream(w, up.Body, func(c []byte) {
		pending = append(pending, c...)
		for {
			i := bytes.IndexByte(pending, '\n')
			if i < 0 {
				break
			}
			s.captureLine(pending[:i], byIndex)
			pending = pending[i+1:]
		}
	})
	if len(bytes.TrimSpace(pending)) > 0 {
		s.captureLine(pending, byIndex)
	}
	if rt.Auth == "vertex" {
		log.Printf("vertex: model=%s status=%d ttfb=%dms total=%dms req=%dB->%dB", reqModel, up.StatusCode, ttfbMs, time.Since(reqStart).Milliseconds(), rawBodyLen, wireBodyLen)
	}
}

func (s *Server) acquireRouteSlot(ctx context.Context, prefix string, maxConc int) (func(), bool) {
	s.paceMu.Lock()
	sem, ok := s.sems[prefix]
	if !ok || cap(sem) != maxConc {
		sem = make(chan struct{}, maxConc)
		s.sems[prefix] = sem
	}
	s.paceMu.Unlock()

	select {
	case sem <- struct{}{}:
	case <-ctx.Done():
		return nil, false
	}

	// Smooth burst spikes by staggering concurrent dispatches by 100ms.
	var wait time.Duration
	s.paceMu.Lock()
	now := time.Now()
	if prev, ok := s.lastHit[prefix]; ok {
		if gap := 100*time.Millisecond - now.Sub(prev); gap > 0 {
			wait = gap
			s.lastHit[prefix] = prev.Add(100 * time.Millisecond)
		} else {
			s.lastHit[prefix] = now
		}
	} else {
		s.lastHit[prefix] = now
	}
	s.paceMu.Unlock()

	if wait > 0 {
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			<-sem
			return nil, false
		case <-t.C:
		}
	}
	return func() { <-sem }, true
}

func gzipBytes(b []byte) ([]byte, bool) {
	var buf bytes.Buffer
	gw, err := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if err != nil {
		return nil, false
	}
	if _, err := gw.Write(b); err != nil {
		return nil, false
	}
	if err := gw.Close(); err != nil {
		return nil, false
	}
	return buf.Bytes(), true
}

func jitterDuration(base time.Duration) time.Duration {
	// +/- 25% jitter
	factor := 0.75 + mrand.Float64()*0.5
	return time.Duration(float64(base) * factor)
}

func parseRetryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if secs, err := strconv.ParseFloat(v, 64); err == nil && secs > 0 {
		return time.Duration(secs * float64(time.Second))
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := time.Until(t); d > 0 {
			return d
		}
	}
	return 0
}

func stepDownVertexEffort(p map[string]any) bool {
	changed := false
	if v, _ := p["reasoning_effort"].(string); v == "high" || v == "medium" {
		p["reasoning_effort"] = "low"
		changed = true
	}
	if ro := obj(p["reasoning"]); ro != nil {
		if v, _ := ro["effort"].(string); v == "high" || v == "medium" {
			ro["effort"] = "low"
			changed = true
		}
	}
	if eb := obj(p["extra_body"]); eb != nil {
		if g := obj(eb["google"]); g != nil {
			if tc := obj(g["thinking_config"]); tc != nil {
				if lvl, _ := tc["thinking_level"].(string); lvl == "HIGH" || lvl == "MEDIUM" {
					tc["thinking_level"] = "LOW"
					changed = true
				}
			}
		}
	}
	return changed
}

func stripVertexThinkingConfig(p map[string]any) {
	eb := obj(p["extra_body"])
	if eb == nil {
		return
	}
	g := obj(eb["google"])
	if g == nil {
		return
	}
	delete(g, "thinking_config")
	if len(g) == 0 {
		delete(eb, "google")
	}
	if len(eb) == 0 {
		delete(p, "extra_body")
	}
}

func writeVertexHeartbeat(w http.ResponseWriter, model string) bool {
	if model == "" {
		model = "google/gemini-4"
	}
	b, _ := json.Marshal(map[string]any{
		"id":      "gw-hb",
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{{
			"index":         0,
			"delta":         map[string]any{"role": "assistant", "reasoning_content": " "},
			"finish_reason": nil,
		}},
	})
	_, err := w.Write(append(append([]byte("data: "), b...), '\n', '\n'))
	return err == nil
}

func writeVertexSSEError(w http.ResponseWriter, status int, msg string) {
	b, _ := json.Marshal(map[string]any{"error": map[string]any{"message": msg, "code": status}})
	_, _ = w.Write(append(append([]byte("data: "), b...), '\n', '\n'))
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	if fl, ok := w.(http.Flusher); ok {
		fl.Flush()
	}
}

// streamVertexSSE reads Vertex OpenAPI SSE lines, captures thought_signature, translates
// thought chunks (delta.extra_content.google.thought=true) into delta.reasoning_content,
// and emits reasoning keepalives if upstream pauses longer than hbEvery mid-stream.
func (s *Server) streamVertexSSE(w http.ResponseWriter, body io.Reader, model string, hbEvery time.Duration) int {
	fl, _ := w.(http.Flusher)
	br := bufio.NewReaderSize(body, 64<<10)
	byIndex := map[int]*[2]string{}
	if hbEvery <= 0 {
		for {
			line, err := br.ReadBytes('\n')
			if len(line) > 0 {
				out := s.processVertexSSELine(line, byIndex)
				if _, werr := w.Write(out); werr != nil {
					return 0
				}
				if fl != nil {
					fl.Flush()
				}
			}
			if err == io.EOF {
				return 0
			}
			if err != nil {
				panic(http.ErrAbortHandler)
			}
		}
	}
	type lineRes struct {
		line []byte
		err  error
	}
	ch := make(chan lineRes, 16)
	done := make(chan struct{})
	defer close(done)
	go func() {
		defer close(ch)
		for {
			line, err := br.ReadBytes('\n')
			select {
			case ch <- lineRes{line: line, err: err}:
			case <-done:
				return
			}
			if err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(hbEvery)
	defer ticker.Stop()
	hbCount := 0
	for {
		select {
		case r, ok := <-ch:
			if !ok {
				return hbCount
			}
			if len(r.line) > 0 {
				out := s.processVertexSSELine(r.line, byIndex)
				if _, werr := w.Write(out); werr != nil {
					return hbCount
				}
				if fl != nil {
					fl.Flush()
				}
				ticker.Reset(hbEvery)
			}
			if r.err == io.EOF {
				return hbCount
			}
			if r.err != nil {
				panic(http.ErrAbortHandler)
			}
		case <-ticker.C:
			if !writeVertexHeartbeat(w, model) {
				return hbCount
			}
			if fl != nil {
				fl.Flush()
			}
			hbCount++
		}
	}
}

func (s *Server) processVertexSSELine(line []byte, byIndex map[int]*[2]string) []byte {
	trimmed := bytes.TrimSpace(line)
	if !bytes.HasPrefix(trimmed, []byte("data:")) {
		return line
	}
	payload := bytes.TrimSpace(bytes.TrimPrefix(trimmed, []byte("data:")))
	if len(payload) == 0 || payload[0] != '{' {
		return line
	}
	var p map[string]any
	if json.Unmarshal(payload, &p) != nil {
		return line
	}
	s.sigs.capture(p, byIndex)
	rewritten := false
	for _, ch := range asList(p["choices"]) {
		delta := obj(ch["delta"])
		if delta == nil {
			continue
		}
		ec := obj(delta["extra_content"])
		g := obj(ec["google"])
		if isThought, _ := g["thought"].(bool); isThought {
			if txt, ok := delta["content"].(string); ok && txt != "" {
				delta["reasoning_content"] = txt
				delete(delta, "content")
			}
			delete(g, "thought")
			if len(g) == 0 {
				delete(ec, "google")
			}
			if len(ec) == 0 {
				delete(delta, "extra_content")
			}
			rewritten = true
		}
	}
	if !rewritten {
		return line
	}
	b, err := json.Marshal(p)
	if err != nil {
		return line
	}
	eol := "\n"
	if bytes.HasSuffix(line, []byte("\r\n")) {
		eol = "\r\n"
	}
	out := make([]byte, 0, 6+len(b)+len(eol))
	out = append(out, "data: "...)
	out = append(out, b...)
	out = append(out, eol...)
	return out
}

func (s *Server) captureLine(line []byte, byIndex map[int]*[2]string) {
	t := bytes.TrimSpace(line)
	t = bytes.TrimPrefix(t, []byte("data:"))
	t = bytes.TrimSpace(t)
	if len(t) == 0 || t[0] != '{' {
		return
	}
	var p map[string]any
	if json.Unmarshal(t, &p) == nil {
		s.sigs.capture(p, byIndex)
	}
}

// tuneRequest applies the reasoning, temperature and token settings, then Gemini thought signatures.
// Returns true when it converted reasoning_effort into Vertex extra_body.google.thinking_config.
func (s *Server) tuneRequest(p map[string]any, cfg Config, rt *Route) bool {
	eff := cfg.ForceReasoningEffort
	routeForced := false
	if eff == "" && p["messages"] != nil {
		if rf := strings.ToLower(strings.TrimSpace(rt.ForceReasoningEffort)); rf != "" {
			switch rf {
			case "off", "minimal", "low", "medium", "high", "xhigh", "max":
				eff, routeForced = rf, true
			}
		}
	}
	if eff == "" {
		if v, ok := p["reasoning_effort"].(string); ok && v != "" {
			eff = v
		} else if v, ok := obj(p["reasoning"])["effort"].(string); ok {
			eff = v
		}
	}
	// The route's own default fills in only for chat requests that carry no effort.
	// "off", an empty value and unknown words add nothing.
	added := false
	if d := strings.ToLower(strings.TrimSpace(rt.DefaultReasoningEffort)); eff == "" && p["messages"] != nil {
		switch d {
		case "minimal", "low", "medium", "high", "xhigh", "max":
			eff, added = d, true
		}
	}
	normEff := ""
	if eff == "off" {
		delete(p, "reasoning_effort")
		delete(p, "reasoning")
	} else if eff != "" {
		n := eff
		switch eff {
		case "xhigh", "max":
			n = "high"
		case "minimal":
			n = "low"
		}
		normEff = n
		if _, ok := p["reasoning_effort"]; ok || cfg.ForceReasoningEffort != "" || (routeForced && obj(p["reasoning"]) == nil) || (added && obj(p["reasoning"]) == nil) {
			p["reasoning_effort"] = n
		}
		if ro := obj(p["reasoning"]); ro != nil {
			ro["effort"] = n
		}
	}
	if cfg.Temperature != nil {
		p["temperature"] = *cfg.Temperature
	}
	if cfg.MaxTokens != nil {
		p["max_tokens"] = *cfg.MaxTokens
	} else if maxOut := rt.maxOutputCap(); maxOut > 0 && p["messages"] != nil {
		if mt, ok := p["max_completion_tokens"].(float64); ok && mt > float64(maxOut) {
			p["max_completion_tokens"] = float64(maxOut)
		}
		if mt, ok := p["max_tokens"].(float64); ok && mt > float64(maxOut) {
			p["max_tokens"] = float64(maxOut)
		}
	}
	injectedThinking := false
	if rt.Auth == "vertex" && p["messages"] != nil {
		delete(p, "store")
		for _, msg := range asList(p["messages"]) {
			if msg["role"] == "developer" {
				msg["role"] = "system"
			}
		}
		// Enable live thought streaming on streaming Vertex OpenAPI calls so TTFB drops from
		// 50-284s of silence to ~1-3s and prevents client 300s stream idle timeouts.
		isStream, _ := p["stream"].(bool)
		hasCustomTC := obj(obj(p["extra_body"])["google"])["thinking_config"] != nil
		if isStream && rt.streamThoughtsEnabled() && normEff != "" && !hasCustomTC {
			lvl := strings.ToUpper(normEff)
			if lvl == "LOW" || lvl == "MEDIUM" || lvl == "HIGH" {
				eb := obj(p["extra_body"])
				if eb == nil {
					eb = map[string]any{}
					p["extra_body"] = eb
				}
				g := obj(eb["google"])
				if g == nil {
					g = map[string]any{}
					eb["google"] = g
				}
				g["thinking_config"] = map[string]any{
					"include_thoughts": true,
					"thinking_level":   lvl,
				}
				delete(p, "reasoning_effort")
				delete(p, "reasoning")
				injectedThinking = true
			}
		}
	}
	s.sigs.inject(p, rt.Auth == "vertex")
	return injectedThinking
}
