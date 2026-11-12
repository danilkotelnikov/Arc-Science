package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Server struct {
	cfgFn     func() Config // read per request, so edits to gateway.json apply at once
	sigs      *sigStore
	vertex    *vertexAuth
	api       *http.Client // AI providers: no total timeout (answers stream for minutes)
	cammut    *http.Client // Cammut: headers must arrive within 300 s
	tokenHash [32]byte
	started   time.Time
	logUsage  func(line []byte)
	cammutUp  sync.Map // upstream -> last error text ("" = fine)
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

func NewServer(cfgFn func() Config) *Server {
	ct := newTransport()
	ct.ResponseHeaderTimeout = 300 * time.Second
	s := &Server{
		cfgFn:   cfgFn,
		sigs:    newSigStore(filepath.Join(Home(), "thought-signatures.json")),
		api:     &http.Client{Transport: newTransport(), CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		cammut:  &http.Client{Transport: ct},
		started: time.Now(),
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
	cache := cfg.PromptCaching
	if r.Method == http.MethodPost && len(body) > 0 {
		if rt.Anthropic && strings.HasSuffix(sub, "/messages") && cache.Enabled {
			body, _ = applyAnthropicCache(body, true, cache.TTL)
		} else if !rt.Anthropic && json.Unmarshal(body, &parsed) == nil && parsed != nil {
			snapshot := marshal(parsed)
			s.tuneRequest(parsed, cfg, rt)
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

	send := func(b []byte) (*http.Response, error) {
		var rb io.Reader
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			rb = bytes.NewReader(b)
		}
		req, err := http.NewRequestWithContext(r.Context(), r.Method, target+sub+queryOf(r), rb)
		if err != nil {
			return nil, err
		}
		req.Header = h.Clone()
		return s.api.Do(req)
	}
	up, err := send(body)
	// The upstream refused cache_control blocks: send again without them.
	if err == nil && up.StatusCode == 400 && preCache != nil && cache.AutoFallbackNoCache {
		up.Body.Close()
		up, err = send(preCache)
	}
	// The model refused reasoning_effort / reasoning: send again without them.
	if err == nil && up.StatusCode == 400 && parsed != nil && cfg.AutoFallbackNoReasoning && (parsed["reasoning_effort"] != nil || parsed["reasoning"] != nil) {
		up.Body.Close()
		delete(parsed, "reasoning_effort")
		delete(parsed, "reasoning")
		up, err = send([]byte(marshal(parsed)))
	}
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	defer up.Body.Close()

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
func (s *Server) tuneRequest(p map[string]any, cfg Config, rt *Route) {
	eff := cfg.ForceReasoningEffort
	if eff == "" {
		if v, ok := p["reasoning_effort"].(string); ok {
			eff = v
		} else if v, ok := obj(p["reasoning"])["effort"].(string); ok {
			eff = v
		}
	}
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
		if _, ok := p["reasoning_effort"]; ok || cfg.ForceReasoningEffort != "" {
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
	}
	s.sigs.inject(p, rt.Auth == "vertex")
}
