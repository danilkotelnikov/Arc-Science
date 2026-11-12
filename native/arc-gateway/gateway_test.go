package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var gov = Governor{Enabled: true, MaxChars: 9000, MaxTokensCap: 1500, MinScoreRatio: 0.8, MinKeep: 3}

func rec(n int, f func(i int) map[string]any) map[string]any {
	rs := []any{}
	for i := 0; i < n; i++ {
		rs = append(rs, f(i))
	}
	return map[string]any{"results": rs}
}

func note(i int, text string, s float64) map[string]any {
	return map[string]any{"id": fmt.Sprint("n", i), "text": text, "fact_type": "world", "mentioned_at": "2026-11-09T10:00:00Z",
		"tags": []any{"topic:vpn", "date:2026-11-09", "source:x", "project:y", "a", "b"}, "scores": map[string]any{"final": s}, "chunk_id": "c", "entities": []any{}}
}

func TestSlimKeepsTextAndIDAndStaysInBudget(t *testing.T) {
	r := rec(40, func(i int) map[string]any {
		return note(i, fmt.Sprintf("fact number %d %s", i, strings.Repeat("x", 400)), 1)
	})
	out := slimRecall(r, gov, func() float64 { return 1 }, nil)
	if out.Governor.Kept < 3 || out.Governor.Kept >= 40 {
		t.Fatalf("kept %d", out.Governor.Kept)
	}
	if jsLen(marshal(out.Results)) > gov.MaxChars+50 {
		t.Fatalf("over budget")
	}
	it := out.Results[0]
	if it.ID != "n0" || !strings.HasPrefix(it.Text, "fact number 0") || len(it.Tags) != 3 || it.Tags[0] != "topic:vpn" || it.Date != "2026-11-09" {
		t.Fatalf("item %+v", it)
	}
	if strings.Contains(marshal(out), "chunk_id") {
		t.Fatal("metadata kept")
	}
}

func TestSlimDropsDuplicatesAndWeakTailButKeepsThree(t *testing.T) {
	r := rec(6, func(i int) map[string]any {
		s := []float64{1, 0.95, 0.2, 0.1, 0.9, 0.05}[i]
		txt := fmt.Sprintf("note %c | when", 'a'+i)
		if i == 1 {
			txt = "Note A! | other"
		}
		return note(i, txt, s)
	})
	out := slimRecall(r, gov, nil, nil)
	ids := []any{}
	for _, it := range out.Results {
		ids = append(ids, it.ID)
	}
	if fmt.Sprint(ids) != "[n0 n2 n3 n4]" {
		t.Fatalf("got %v", ids)
	}
}

func TestRussianNotesAreNotCopies(t *testing.T) {
	r := rec(2, func(i int) map[string]any {
		return note(i, []string{"Сервер в Германии", "Сервер в Америке"}[i], 1)
	})
	if k := slimRecall(r, gov, nil, nil).Governor.Kept; k != 2 {
		t.Fatalf("kept %d", k)
	}
}

func TestSwapRecordsOrderBeforeSwap(t *testing.T) {
	r := rec(4, func(i int) map[string]any { return note(i, fmt.Sprint("distinct ", i), 1) })
	g := gov
	g.SwapRate = 0.5
	calls := 0
	var tr Trace
	out := slimRecall(r, g, func() float64 { calls++; return 0 }, &tr)
	if out.Results[0].ID != "n1" || out.Results[1].ID != "n0" || fmt.Sprint(tr.Swaps) != "[0 2]" || tr.Order[0][0] != "n0" {
		t.Fatalf("results %v swaps %v order %v", out.Results, tr.Swaps, tr.Order)
	}
	g.SwapRate = 0
	out = slimRecall(r, g, nil, &tr)
	if out.Results[0].ID != "n0" || len(tr.Swaps) != 0 || len(tr.Shown) != 4 {
		t.Fatal("swapRate 0 changed the order")
	}
}

func rpcBody(inner map[string]any) string {
	return marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{
		"content": []any{map[string]any{"type": "text", "text": marshal(inner)}}, "structuredContent": inner}})
}

func TestGovernResponseJSONAndStream(t *testing.T) {
	inner := rec(30, func(i int) map[string]any { return note(i, fmt.Sprint("fact ", i, strings.Repeat(" y", 300)), 1) })
	res := governResponse(rpcBody(inner), "application/json", gov, nil, nil)
	if res == nil || res.ToChars >= res.FromChars || strings.Contains(res.Text, "structuredContent") {
		t.Fatalf("json not slimmed: %+v", res)
	}
	sse := "event: message\ndata: " + rpcBody(inner) + "\n\n"
	res = governResponse(sse, "text/event-stream", gov, nil, nil)
	if res == nil || !strings.HasPrefix(res.Text, "event: message\ndata: ") || res.ToChars >= res.FromChars {
		t.Fatal("stream not slimmed")
	}
	for _, b := range []string{`{"jsonrpc":"2.0","id":1,"error":{"code":1}}`, `not json`, rpcBody(map[string]any{"other": 1})} {
		if governResponse(b, "application/json", gov, nil, nil) != nil {
			t.Fatalf("touched %s", b)
		}
	}
}

func TestCapRequestOnlyForRecall(t *testing.T) {
	call := func(tool string, args map[string]any) []byte {
		return []byte(marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{
			"name": "cammut_call", "arguments": map[string]any{"tool": tool, "arguments": args}}}))
	}
	r := capRequest(call("hindsight/recall", map[string]any{"query": "q", "max_tokens": 9000.0, "_lab": true}), gov)
	if !r.IsRecall || !r.Lab || r.Query != "q" || !strings.Contains(string(r.Body), `"max_tokens":1500`) || strings.Contains(string(r.Body), "_lab") {
		t.Fatalf("recall: %+v %s", r, r.Body)
	}
	if r := capRequest(call("hindsight/recall", map[string]any{"max_tokens": 500.0}), gov); !strings.Contains(string(r.Body), `"max_tokens":500`) {
		t.Fatal("lowered a smaller limit")
	}
	in := call("hindsight/retain", map[string]any{"max_tokens": 9000.0})
	if r := capRequest(in, gov); r.IsRecall || string(r.Body) != string(in) {
		t.Fatal("touched retain")
	}
}

func TestAnthropicCacheNativeAndOpenAI(t *testing.T) {
	native := `{"model":"claude-x","system":"be brief","tools":[{"name":"a"},{"name":"b","defer_loading":true}],"messages":[{"role":"user","content":"one"},{"role":"assistant","content":"ok"},{"role":"user","content":[{"type":"text","text":"two"}]}]}`
	b, ok := applyAnthropicCache([]byte(native), true, "")
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if !ok || strings.Count(string(b), "cache_control") != 4 || asList(m["tools"])[0]["cache_control"] == nil {
		t.Fatalf("native: %s", b)
	}
	oai := `{"model":"gpt-5","messages":[{"role":"user","content":"hi"}]}`
	if _, ok := applyAnthropicCache([]byte(oai), false, ""); ok {
		t.Fatal("marked a non-Anthropic model")
	}
	oai2 := `{"model":"anthropic/claude","messages":[{"role":"system","content":"s"},{"role":"user","content":"hi"}]}`
	b, ok = applyAnthropicCache([]byte(oai2), false, "1h")
	if !ok || strings.Count(string(b), `"ttl":"1h"`) != 2 {
		t.Fatalf("openai-compatible: %s", b)
	}
	full := `{"model":"claude","messages":[{"role":"user","content":[{"type":"text","text":"a","cache_control":{}},{"type":"text","text":"b","cache_control":{}},{"type":"text","text":"c","cache_control":{}},{"type":"text","text":"d","cache_control":{}}]}]}`
	if _, ok := applyAnthropicCache([]byte(full), true, ""); ok {
		t.Fatal("went past 4 breakpoints")
	}
}

// --- proxy tests against fake upstreams ---

// setup starts the gateway on a free port; the config's Port follows the test server so the Host check passes.
func setup(t *testing.T, cfg Config) (*httptest.Server, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	_ = os.WriteFile(filepath.Join(home, ".credentials.yaml"), []byte("version: 1\nrefs:\n  TEST_KEY: sk-test-123\n"), 0o600)
	c := cfg
	s := NewServer(func() Config { return c })
	ts := httptest.NewServer(s)
	c.Port = localPort(ts)
	return ts, home
}

func localPort(ts *httptest.Server) int {
	_, p, _ := net.SplitHostPort(ts.Listener.Addr().String())
	var n int
	fmt.Sscan(p, &n)
	return n
}

func do(t *testing.T, ts *httptest.Server, method, path, body string, hdr map[string]string) *http.Response {
	req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
	req.Host = fmt.Sprintf("127.0.0.1:%d", localPort(ts))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRouteAddsKeyAndStripsGatewayToken(t *testing.T) {
	var got http.Header
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = r.Header.Clone(); io.WriteString(w, `{"ok":1}`) }))
	defer up.Close()
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/p/v1", Target: up.URL, KeyRef: "TEST_KEY"}}
	ts, _ := setup(t, cfg)
	cfg.Port = localPort(ts)
	defer ts.Close()
	r := do(t, ts, "GET", "/p/v1/models", "", map[string]string{"X-Arc-Gateway-Token": "x", "Authorization": "Bearer placeholder"})
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode != 200 || string(b) != `{"ok":1}` || got.Get("Authorization") != "Bearer sk-test-123" || got.Get("X-Arc-Gateway-Token") != "" {
		t.Fatalf("status %d body %s auth %q", r.StatusCode, b, got.Get("Authorization"))
	}
}

func TestForeignHostAndOriginAreRefused(t *testing.T) {
	cfg := defaultConfig()
	ts, _ := setup(t, cfg)
	defer ts.Close()
	cfg.Port = localPort(ts)
	req, _ := http.NewRequest("GET", ts.URL+"/health", nil)
	req.Host = "evil.example:80"
	if r, _ := http.DefaultClient.Do(req); r.StatusCode != 403 {
		t.Fatalf("host: %d", r.StatusCode)
	}
	if r := do(t, ts, "GET", "/health", "", map[string]string{"Origin": "https://evil.example"}); r.StatusCode != 403 {
		t.Fatalf("origin: %d", r.StatusCode)
	}
}

func TestSettingsNeedToken(t *testing.T) {
	cfg := defaultConfig()
	ts, _ := setup(t, cfg)
	defer ts.Close()
	cfg.Port = localPort(ts)
	if r := do(t, ts, "POST", "/api/config", `{"temperature":0.3}`, nil); r.StatusCode != 401 {
		t.Fatalf("no token: %d", r.StatusCode)
	}
}

func TestCammutSkipsDeadUpstreamFastAndSlimsRecall(t *testing.T) {
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	deadURL := "http://" + dead.Addr().String()
	dead.Close() // nothing listens here now
	inner := rec(30, func(i int) map[string]any { return note(i, fmt.Sprint("fact ", i, strings.Repeat(" z", 300)), 1) })
	var gotMax string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if strings.Contains(string(b), `"max_tokens":1500`) {
			gotMax = "capped"
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, rpcBody(inner))
	}))
	defer up.Close()
	cfg := defaultConfig()
	cfg.Cammut.Upstreams = []string{deadURL, up.URL}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	cfg.Port = localPort(ts)
	body := marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "cammut_call",
		"arguments": map[string]any{"tool": "hindsight/recall", "arguments": map[string]any{"query": "q", "max_tokens": 4000}}}})
	start := time.Now()
	r := do(t, ts, "POST", "/cammut/mcp", body, map[string]string{"Content-Type": "application/json"})
	b, _ := io.ReadAll(r.Body)
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("fallback took %v", d)
	}
	if r.StatusCode != 200 || gotMax != "capped" || len(b) >= len(rpcBody(inner)) {
		t.Fatalf("status %d capped=%q len %d", r.StatusCode, gotMax, len(b))
	}
}

func TestCammutAllDownGives502(t *testing.T) {
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	u := "http://" + dead.Addr().String()
	dead.Close()
	cfg := defaultConfig()
	cfg.Cammut.Upstreams = []string{u}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	cfg.Port = localPort(ts)
	if r := do(t, ts, "POST", "/cammut/mcp", `{}`, nil); r.StatusCode != 502 {
		t.Fatalf("got %d", r.StatusCode)
	}
}

func TestStreamArrivesBeforeUpstreamFinishes(t *testing.T) {
	release := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: {\"choices\":[]}\n\n")
		w.(http.Flusher).Flush()
		<-release
		io.WriteString(w, "data: [DONE]\n\n")
	}))
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/s/v1", Target: up.URL, Auth: "none"}}
	ts, _ := setup(t, cfg)
	// Release the upstream first; closing a test server waits for its open requests.
	defer func() { close(release); ts.Close(); up.Close() }()
	r := do(t, ts, "POST", "/s/v1/chat/completions", `{"model":"x","stream":true}`, nil)
	defer r.Body.Close()
	line := make(chan string, 1)
	go func() { l, _ := bufio.NewReader(r.Body).ReadString('\n'); line <- l }()
	select {
	case l := <-line:
		if !strings.HasPrefix(l, "data:") {
			t.Fatalf("got %q", l)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first chunk did not arrive while the upstream was still open")
	}
}

func TestThoughtSignatureRoundTrip(t *testing.T) {
	s := newSigStore("")
	s.capture(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{
		map[string]any{"index": 0.0, "id": "call_1", "extra_content": map[string]any{"google": map[string]any{"thought_signature": "SIG"}}}}}}}}, map[int]*[2]string{})
	body := map[string]any{"model": "gemini-3", "messages": []any{map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "call_1"}}}}}
	s.inject(body, false)
	if !strings.Contains(marshal(body), `"thought_signature":"SIG"`) {
		t.Fatalf("not injected: %s", marshal(body))
	}
}

// --- review fixes ---

func TestCutUpstreamAbortsReply(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, buf, _ := w.(http.Hijacker).Hijack()
		buf.WriteString("HTTP/1.1 200 OK\r\nContent-Length: 100\r\nContent-Type: application/json\r\n\r\n{\"partial\":")
		buf.Flush()
		c.Close()
	}))
	defer up.Close()
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/c/v1", Target: up.URL, Auth: "none"}}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	r := do(t, ts, "GET", "/c/v1/models", "", nil)
	if _, err := io.ReadAll(r.Body); err == nil {
		t.Fatal("a cut upstream answer reached the client as a complete one")
	}
}

func TestDotDotPathRefused(t *testing.T) {
	hits := 0
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer up.Close()
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/p/v1", Target: up.URL, Auth: "none"}}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	if r := do(t, ts, "GET", "/p/v1/%2e%2e/secret", "", nil); r.StatusCode != 400 || hits != 0 {
		t.Fatalf("status %d, upstream hits %d", r.StatusCode, hits)
	}
}

func TestCammutNoRetryAfterRequestWentOut(t *testing.T) {
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		c, _, _ := w.(http.Hijacker).Hijack()
		c.Close() // took the request, then died without an answer
	}))
	defer first.Close()
	second := 0
	up2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { second++; io.WriteString(w, "{}") }))
	defer up2.Close()
	cfg := defaultConfig()
	cfg.Cammut.Upstreams = []string{first.URL, up2.URL}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	r := do(t, ts, "POST", "/cammut/mcp", `{"jsonrpc":"2.0","id":1,"method":"tools/call"}`, nil)
	if r.StatusCode != 502 || second != 0 {
		t.Fatalf("status %d, second upstream got %d request(s)", r.StatusCode, second)
	}
}

func TestOversizeBodyGives413(t *testing.T) {
	cfg := defaultConfig()
	ts, _ := setup(t, cfg)
	defer ts.Close()
	if r := do(t, ts, "POST", "/cammut/mcp", strings.Repeat("x", 32<<20+1), nil); r.StatusCode != 413 {
		t.Fatalf("got %d", r.StatusCode)
	}
}

func TestUntouchedBodyKeepsCallerBytes(t *testing.T) {
	var got string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { b, _ := io.ReadAll(r.Body); got = string(b) }))
	defer up.Close()
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/k/v1", Target: up.URL, Auth: "none"}}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	in := `{"z":1,"a":"<b>","model":"x"}`
	do(t, ts, "POST", "/k/v1/embeddings", in, nil)
	if got != in {
		t.Fatalf("sent %s", got)
	}
}

func TestSignatureOrderSurvivesRestart(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sigs.json")
	s := newSigStore(p)
	for i := 0; i < 50; i++ {
		s.remember(fmt.Sprint("id", i), "s")
	}
	s.save()
	s2 := newSigStore(p)
	for i := 0; i < 50; i++ {
		if s2.order[i] != fmt.Sprint("id", i) {
			t.Fatalf("order lost at %d: %v", i, s2.order[:5])
		}
	}
}

func TestBrokenConfigIsNotOverwritten(t *testing.T) {
	t.Setenv("ARC_HOME", t.TempDir())
	_ = os.WriteFile(configPath(), []byte(`{"routes": [ broken`), 0o600)
	if _, err := SaveSettings(map[string]any{"temperature": 0.2}); err == nil {
		t.Fatal("saved over a broken gateway.json")
	}
	if b, _ := os.ReadFile(configPath()); string(b) != `{"routes": [ broken` {
		t.Fatalf("file changed: %s", b)
	}
	if err := SaveRef("K", "a\nb"); err == nil {
		t.Fatal("multi-line key value accepted")
	}
}
