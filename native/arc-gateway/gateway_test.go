package main

import (
	"bufio"
	"encoding/json"
	"errors"
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

// --- per-route reasoning default ---

func TestRouteDefaultEffortOnlyWhenRequestHasNone(t *testing.T) {
	var got []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { b, _ := io.ReadAll(r.Body); got = append(got, string(b)) }))
	defer up.Close()
	cfg := defaultConfig() // global default stays "high": it must not reach any route
	cfg.Routes = []Route{
		{Prefix: "/vertex/v1", Target: up.URL, Auth: "none", DefaultReasoningEffort: "low"},
		{Prefix: "/radium/v1", Target: up.URL, Auth: "none"},
	}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	cases := []struct{ path, in, want string }{
		{"/vertex/v1/chat/completions", `{"model":"gemini-4-argon","messages":[]}`, `"reasoning_effort":"low"`},
		{"/vertex/v1/chat/completions", `{"model":"gemini-4-argon","messages":[],"reasoning_effort":"high"}`, `"reasoning_effort":"high"`},
		{"/vertex/v1/chat/completions", `{"model":"gemini-4-argon","messages":[],"reasoning":{"effort":"medium"}}`, `"reasoning":{"effort":"medium"}`},
		{"/vertex/v1/embeddings", `{"model":"gemini-embedding","input":"x"}`, `{"model":"gemini-embedding","input":"x"}`},
		{"/radium/v1/chat/completions", `{"model":"m","messages":[]}`, `{"model":"m","messages":[]}`},
		{"/vertex/v1/chat/completions", `{"model":"gemini-4-argon","messages":[],"reasoning":{"summary":"auto"}}`, `"reasoning":{"effort":"low","summary":"auto"}`},
	}
	for i, c := range cases {
		do(t, ts, "POST", c.path, c.in, nil)
		if len(got) != i+1 || !strings.Contains(got[i], c.want) {
			t.Fatalf("case %d %s %s: upstream got %v, want %s", i, c.path, c.in, got, c.want)
		}
	}
	for _, i := range []int{2, 5} { // a reasoning object gets the effort inside it, never a second field
		if strings.Count(got[i], "effort") != 1 {
			t.Fatalf("case %d has %d effort fields: %s", i, strings.Count(got[i], "effort"), got[i])
		}
	}
}

func TestRouteDefaultEffortYieldsToForceAndOff(t *testing.T) {
	var got string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { b, _ := io.ReadAll(r.Body); got = string(b) }))
	defer up.Close()
	for _, c := range []struct{ force, def, in, want string }{
		{"high", "low", `{"messages":[]}`, `{"messages":[],"reasoning_effort":"high"}`},
		{"", "off", `{"messages":[],"reasoning":{"summary":"auto"}}`, `{"messages":[],"reasoning":{"summary":"auto"}}`},
		{"", " Low ", `{"messages":[]}`, `{"messages":[],"reasoning_effort":"low"}`},
		{"", "lwo", `{"messages":[]}`, `{"messages":[]}`},
		{"", "low", `{"messages":[],"reasoning":{"effort":"medium"},"reasoning_effort":""}`, `{"messages":[],"reasoning":{"effort":"medium"},"reasoning_effort":"medium"}`},
	} {
		cfg := defaultConfig()
		cfg.ForceReasoningEffort = c.force
		cfg.Routes = []Route{{Prefix: "/vertex/v1", Target: up.URL, Auth: "none", DefaultReasoningEffort: c.def}}
		ts, _ := setup(t, cfg)
		do(t, ts, "POST", "/vertex/v1/chat/completions", c.in, nil)
		ts.Close()
		if got != c.want {
			t.Fatalf("force %q default %q: upstream got %s, want %s", c.force, c.def, got, c.want)
		}
	}
}

func TestExampleConfigVertexDefaultsLow(t *testing.T) {
	b, err := os.ReadFile("gateway.example.json")
	if err != nil {
		t.Fatal(err)
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	seen := false
	for _, r := range c.Routes {
		want := ""
		if r.Prefix == "/vertex/v1" {
			want, seen = "low", true
		}
		if r.DefaultReasoningEffort != want {
			t.Fatalf("route %s default %q, want %q", r.Prefix, r.DefaultReasoningEffort, want)
		}
	}
	if !seen {
		t.Fatal("example config has no /vertex/v1 route")
	}
}

func TestRouteDefaultEffortSkipsAnthropicRoutes(t *testing.T) {
	var got string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { b, _ := io.ReadAll(r.Body); got = string(b) }))
	defer up.Close()
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/anthropic", Target: up.URL, Anthropic: true, DefaultReasoningEffort: "low"}}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	do(t, ts, "POST", "/anthropic/v1/messages", `{"model":"m","messages":[]}`, nil)
	if got == "" || strings.Contains(got, "effort") {
		t.Fatalf("anthropic route body changed: %s", got)
	}
}

func TestRouteForceEffortAndVertexCleanup(t *testing.T) {
	var got string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { b, _ := io.ReadAll(r.Body); got = string(b) }))
	defer up.Close()
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/vertex/v1", Target: up.URL, Auth: "none", ForceReasoningEffort: "low"}}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	do(t, ts, "POST", "/vertex/v1/chat/completions", `{"model":"google/gemini-4-argon","messages":[{"role":"user","content":"hi"}],"reasoning_effort":"high"}`, nil)
	if !strings.Contains(got, `"reasoning_effort":"low"`) {
		t.Fatalf("route ForceReasoningEffort did not override high: %s", got)
	}
	// Direct tuneRequest check for Auth="vertex": strips store, normalizes developer->system, caps max_completion_tokens
	s := NewServer(func() Config { return cfg })
	p := map[string]any{
		"model":                 "google/gemini-4-argon",
		"store":                 false,
		"max_completion_tokens": float64(65536),
		"reasoning_effort":      "high",
		"messages":              []any{map[string]any{"role": "developer", "content": "sys"}},
	}
	vRoute := Route{Prefix: "/vertex/v1", Auth: "vertex", ForceReasoningEffort: "low"}
	s.tuneRequest(p, cfg, &vRoute)
	if _, hasStore := p["store"]; hasStore {
		t.Fatalf("store not removed: %v", p)
	}
	if p["max_completion_tokens"] != float64(32768) {
		t.Fatalf("max_completion_tokens not capped: %v", p["max_completion_tokens"])
	}
	if p["reasoning_effort"] != "low" {
		t.Fatalf("reasoning_effort not forced to low: %v", p["reasoning_effort"])
	}
	if asList(p["messages"])[0]["role"] != "system" {
		t.Fatalf("developer role not normalized to system: %v", p["messages"])
	}
	// Streaming vertex request converts reasoning_effort into extra_body.google.thinking_config
	ps := map[string]any{
		"model":            "google/gemini-4-neon",
		"stream":           true,
		"reasoning_effort": "high",
		"messages":         []any{map[string]any{"role": "user", "content": "hi"}},
	}
	vRouteStream := Route{Prefix: "/vertex/v1", Auth: "vertex"}
	if !s.tuneRequest(ps, cfg, &vRouteStream) {
		t.Fatal("expected injectedThinking=true for streaming vertex request")
	}
	if ps["reasoning_effort"] != nil {
		t.Fatalf("reasoning_effort should be removed when thinking_config is injected: %v", ps)
	}
	tc := obj(obj(obj(ps["extra_body"])["google"])["thinking_config"])
	if tc["include_thoughts"] != true || tc["thinking_level"] != "HIGH" {
		t.Fatalf("unexpected thinking_config: %v", tc)
	}
	if !stepDownVertexEffort(ps) || tc["thinking_level"] != "LOW" {
		t.Fatalf("stepDownVertexEffort did not lower thinking_level to LOW: %v", tc)
	}
}

func TestVertexSSEThoughtTranslationAndSigCapture(t *testing.T) {
	s := NewServer(func() Config { return defaultConfig() })
	byIndex := map[int]*[2]string{}
	thoughtLine := []byte("data: {\"choices\":[{\"delta\":{\"content\":\"thinking step\",\"extra_content\":{\"google\":{\"thought\":true}},\"role\":\"assistant\"},\"index\":0}]}\n")
	out := string(s.processVertexSSELine(thoughtLine, byIndex))
	if !strings.Contains(out, `"reasoning_content":"thinking step"`) || strings.Contains(out, `"content":"thinking step"`) || strings.Contains(out, `"thought":true`) {
		t.Fatalf("thought line not translated cleanly: %s", out)
	}
	toolLine := []byte("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_abc\",\"extra_content\":{\"google\":{\"thought_signature\":\"SIG_XYZ\"}}}]},\"index\":0}]}\n")
	out2 := string(s.processVertexSSELine(toolLine, byIndex))
	if out2 != string(toolLine) {
		t.Fatalf("non-thought tool line was modified: %s", out2)
	}
	if s.sigs.get("call_abc") != "SIG_XYZ" {
		t.Fatalf("thought_signature not captured: got %q", s.sigs.get("call_abc"))
	}
}

func TestVertexGzipRequestCompression(t *testing.T) {
	var gotEnc string
	var gotLen int
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotEnc = r.Header.Get("Content-Encoding")
		b, _ := io.ReadAll(r.Body)
		gotLen = len(b)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"ok":1}`)
	}))
	defer up.Close()
	yes := true
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/v/v1", Target: up.URL, Auth: "none", CompressRequests: &yes}}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	big := fmt.Sprintf(`{"model":"google/gemini-4-neon","messages":[{"role":"user","content":"%s"}]}`, strings.Repeat("hello world ", 1000))
	r := do(t, ts, "POST", "/v/v1/chat/completions", big, map[string]string{"Content-Type": "application/json"})
	if r.StatusCode != 200 || gotEnc != "gzip" || gotLen >= len(big)/2 {
		t.Fatalf("status=%d enc=%q raw=%d wire=%d", r.StatusCode, gotEnc, len(big), gotLen)
	}
}

func TestEmptyCammutUpstreamsFallsBackToDefault(t *testing.T) {
	t.Setenv("ARC_HOME", t.TempDir())
	_ = os.WriteFile(configPath(), []byte(`{"port":7424,"cammut":{"upstreams":[]}}`), 0o600)
	c := LoadConfig()
	if len(c.Cammut.Upstreams) == 0 {
		t.Fatal("empty cammut.upstreams was not restored to default")
	}
}

func TestVertexStreamingHeartbeatPreventsSilentIdleTimeout(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		time.Sleep(110 * time.Millisecond) // simulate Carbon silent thinking before HTTP headers
		w.Header().Set("Content-Type", "text/event-stream")
		fl, _ := w.(http.Flusher)
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"CARBON_OK\",\"role\":\"assistant\"},\"index\":0}]}\n\n")
		if fl != nil {
			fl.Flush()
		}
		time.Sleep(60 * time.Millisecond) // simulate mid-stream pause
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_c1\",\"extra_content\":{\"google\":{\"thought_signature\":\"SIG_C1\"}}}]},\"index\":0}]}\n\n")
		io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer up.Close()
	yes := true
	cfg := defaultConfig()
	cfg.Routes = []Route{{Prefix: "/vertex/v1", Target: up.URL, Auth: "none", StreamThoughts: &yes}}
	t.Setenv("ARC_HOME", t.TempDir())
	c := cfg
	s := NewServer(func() Config { return c })
	s.vertexHeartbeat = 35 * time.Millisecond
	ts := httptest.NewServer(s)
	c.Port = localPort(ts)
	defer ts.Close()

	req, _ := http.NewRequest("POST", ts.URL+"/vertex/v1/chat/completions", strings.NewReader(`{"model":"google/gemini-4-carbon","messages":[{"role":"user","content":"hi"}],"stream":true}`))
	req.Header.Set("Content-Type", "application/json")
	t0 := time.Now()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	headerElapsed := time.Since(t0)
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	bodyStr := string(bodyBytes)
	if headerElapsed >= 100*time.Millisecond {
		t.Fatalf("expected early SSE headers via heartbeat (<100ms), got %v", headerElapsed)
	}
	if !strings.Contains(bodyStr, `"reasoning_content":" "`) {
		t.Fatalf("missing heartbeat reasoning_content chunk: %s", bodyStr)
	}
	if !strings.Contains(bodyStr, `"CARBON_OK"`) || !strings.Contains(bodyStr, "data: [DONE]") {
		t.Fatalf("real Carbon payload lost: %s", bodyStr)
	}
	if s.sigs.get("call_c1") != "SIG_C1" {
		t.Fatalf("thought_signature lost after heartbeat: got %q", s.sigs.get("call_c1"))
	}
}

func TestVertex429NormalizesTransientQuotaWordingToRateLimit(t *testing.T) {
	hits := 0
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(429)
		io.WriteString(w, `{"error":{"code":429,"message":"Quota exceeded for aiplatform.googleapis.com/generate_content_requests_per_minute_per_project_per_base_model","status":"RESOURCE_EXHAUSTED"}}`)
	}))
	defer up.Close()
	c := defaultConfig()
	yes := true
	c.Routes = []Route{{Prefix: "/vertex/v1", Target: up.URL, Auth: "none", StreamThoughts: &yes}}
	t.Setenv("ARC_HOME", t.TempDir())
	s := NewServer(func() Config { return c })
	s.vertexHeartbeat = 10 * time.Millisecond
	s.retryWaits = []time.Duration{8 * time.Millisecond, 8 * time.Millisecond, 8 * time.Millisecond, 8 * time.Millisecond, 8 * time.Millisecond}
	ts := httptest.NewServer(s)
	c.Port = localPort(ts)
	defer ts.Close()

	// Stream=true verifies heartbeat is deferred during 429 retries so client still receives HTTP 429 rate_limit_exceeded.
	req, _ := http.NewRequest("POST", ts.URL+"/vertex/v1/chat/completions", strings.NewReader(`{"model":"google/gemini-4-neon","stream":true,"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	bodyLower := strings.ToLower(string(bodyBytes))
	if hits != 6 {
		t.Fatalf("expected 1 initial + 5 retry attempts = 6 hits, got %d", hits)
	}
	if resp.StatusCode != 429 {
		t.Fatalf("expected HTTP 429 (not premature 200 SSE heartbeat), got %d (%s)", resp.StatusCode, bodyLower)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Fatalf("expected Retry-After header on normalized 429")
	}
	if strings.Contains(bodyLower, "quota") {
		t.Fatalf("transient 429 still contains 'quota' wording that triggers terminal QUOTA abort: %s", bodyLower)
	}
	if !strings.Contains(bodyLower, "rate_limit_exceeded") {
		t.Fatalf("expected rate_limit_exceeded in normalized 429 body: %s", bodyLower)
	}
}

// --- Cammut servers: settings patch and per-server keys (slice S051) ---

func writeGatewayJSON(t *testing.T, home, text string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(home, "gateway.json"), []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestSaveSettingsMergesCammutUpstreamsAndKeepsTheRest(t *testing.T) {
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	writeGatewayJSON(t, home, `{"routes":[{"prefix":"/p/v1","target":"http://127.0.0.1:1"}],"cammut":{"upstreams":["http://127.0.0.1:7421"],"authFile":"~/x.json","governor":{"enabled":true,"maxChars":9000}}}`)
	_, err := SaveSettings(map[string]any{"cammut": map[string]any{
		"upstreams": []any{"http://127.0.0.1:7421", "https://memory.example.org/cammut"},
		"auth":      map[string]any{"https://memory.example.org/cammut": "VPS_KEY"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	b, _ := os.ReadFile(filepath.Join(home, "gateway.json"))
	_ = json.Unmarshal(b, &raw)
	c := raw["cammut"].(map[string]any)
	if c["authFile"] != "~/x.json" || c["governor"].(map[string]any)["maxChars"].(float64) != 9000 {
		t.Fatalf("authFile or governor lost: %v", c)
	}
	if len(c["upstreams"].([]any)) != 2 || c["auth"].(map[string]any)["https://memory.example.org/cammut"] != "VPS_KEY" {
		t.Fatalf("patch not applied: %v", c)
	}
	if len(raw["routes"].([]any)) != 1 {
		t.Fatalf("routes lost")
	}
	// removing a server drops its key entry too
	if _, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": []any{"http://127.0.0.1:7421"}}}); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(filepath.Join(home, "gateway.json"))
	_ = json.Unmarshal(b, &raw)
	if a, ok := raw["cammut"].(map[string]any)["auth"]; ok && len(a.(map[string]any)) != 0 {
		t.Fatalf("stale key entry kept: %v", a)
	}
}

func TestSaveSettingsRefusesBadCammutPatch(t *testing.T) {
	t.Setenv("ARC_HOME", t.TempDir())
	bad := map[string]map[string]any{
		"empty list":      {"upstreams": []any{}},
		"not a list":      {"upstreams": "http://a"},
		"ftp scheme":      {"upstreams": []any{"ftp://a.example"}},
		"userinfo":        {"upstreams": []any{"https://user:pw" + "@a.example"}},
		"query":           {"upstreams": []any{"https://a.example/?k=v"}},
		"no host":         {"upstreams": []any{"https:///x"}},
		"duplicate":       {"upstreams": []any{"https://a.example", "https://a.example/"}},
		"key for unknown": {"upstreams": []any{"https://a.example"}, "auth": map[string]any{"https://b.example": "K"}},
		"bad key name":    {"upstreams": []any{"https://a.example"}, "auth": map[string]any{"https://a.example": "sk-abc def"}},
		"too many":        {"upstreams": []any{"http://1.x", "http://2.x", "http://3.x", "http://4.x", "http://5.x", "http://6.x", "http://7.x", "http://8.x", "http://9.x"}},
	}
	for name, p := range bad {
		_, err := SaveSettings(map[string]any{"cammut": p})
		var se settingsError
		if err == nil || !errors.As(err, &se) {
			t.Errorf("%s: want a settingsError, got %v", name, err)
		}
	}
	if _, err := os.Stat(configPath()); err == nil {
		t.Errorf("a refused patch wrote gateway.json")
	}
}

func TestConfigGetListsCammutServersWithoutKeyValues(t *testing.T) {
	cfg := defaultConfig()
	cfg.Cammut.Upstreams = []string{"http://127.0.0.1:7421", "https://m.example"}
	cfg.Cammut.Auth = map[string]string{"https://m.example": "TEST_KEY"}
	ts, _ := setup(t, cfg)
	defer ts.Close()
	r := do(t, ts, "GET", "/api/config", "", nil)
	b, _ := io.ReadAll(r.Body)
	if strings.Contains(string(b), "sk-test-123") {
		t.Fatalf("key value leaked: %s", b)
	}
	var got struct {
		Cammut struct {
			Upstreams  []string          `json:"upstreams"`
			Auth       map[string]string `json:"auth"`
			KeyPresent map[string]bool   `json:"keyPresent"`
		} `json:"cammut"`
	}
	_ = json.Unmarshal(b, &got)
	if len(got.Cammut.Upstreams) != 2 || got.Cammut.Auth["https://m.example"] != "TEST_KEY" || !got.Cammut.KeyPresent["https://m.example"] {
		t.Fatalf("got %s", b)
	}
}

func TestConfigPostCammutNeedsTokenAndAnswersBadPatchWith400(t *testing.T) {
	cfg := defaultConfig()
	ts, home := setup(t, cfg)
	defer ts.Close()
	body := `{"cammut":{"upstreams":["https://m.example"]}}`
	if r := do(t, ts, "POST", "/api/config", body, nil); r.StatusCode != 401 {
		t.Fatalf("no token: %d", r.StatusCode)
	}
	tok, _ := os.ReadFile(filepath.Join(home, ".gateway-token"))
	h := map[string]string{"X-Arc-Gateway-Token": strings.TrimSpace(string(tok))}
	if r := do(t, ts, "POST", "/api/config", `{"cammut":{"upstreams":["ftp://x"]}}`, h); r.StatusCode != 400 {
		t.Fatalf("bad patch: %d", r.StatusCode)
	}
	if r := do(t, ts, "POST", "/api/config", body, h); r.StatusCode != 200 {
		t.Fatalf("good patch: %d", r.StatusCode)
	}
	if got := LoadConfig().Cammut.Upstreams; len(got) != 1 || got[0] != "https://m.example" {
		t.Fatalf("saved %v", got)
	}
}

func TestCammutAuthIsPerServer(t *testing.T) {
	var gotA, gotB, gotC string
	mk := func(dst *string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			*dst = r.Header.Get("Authorization")
			io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{}}`)
		}))
	}
	a, b, c := mk(&gotA), mk(&gotB), mk(&gotC)
	defer a.Close()
	defer b.Close()
	defer c.Close()
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	_ = os.WriteFile(filepath.Join(home, ".credentials.yaml"), []byte("version: 1\nrefs:\n  B_KEY: key-for-b\n"), 0o600)
	af := filepath.Join(home, "auth.json")
	_ = os.WriteFile(af, []byte(`{"mcpServers":{"cammut":{"headers":{"Authorization":"Bearer owner-token"}}}}`), 0o600)
	for _, tc := range []struct {
		name string
		up   string
		auth map[string]string
		got  *string
		want string
	}{
		{"legacy server keeps the owner file", a.URL, nil, &gotA, "Bearer owner-token"},
		{"added server uses its own key", b.URL, map[string]string{b.URL: "B_KEY"}, &gotB, "Bearer key-for-b"},
		{"added server without key gets no header", c.URL, map[string]string{c.URL: ""}, &gotC, ""},
	} {
		cfg := defaultConfig()
		cfg.Cammut.AuthFile = af
		cfg.Cammut.Upstreams = []string{tc.up}
		cfg.Cammut.Auth = tc.auth
		s := NewServer(func() Config { return cfg })
		ts := httptest.NewServer(s)
		cfg.Port = localPort(ts)
		r := do(t, ts, "POST", "/cammut/mcp", `{"jsonrpc":"2.0","id":1,"method":"ping"}`, map[string]string{"Authorization": "Bearer caller-token"})
		r.Body.Close()
		ts.Close()
		if *tc.got != tc.want {
			t.Errorf("%s: header %q, want %q", tc.name, *tc.got, tc.want)
		}
	}
}

// Argon review (S051): a server added without an auth entry must get an empty one, so the owner file never reaches it.
func TestSaveSettingsGivesEveryNewServerAnEmptyKeyEntry(t *testing.T) {
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	writeGatewayJSON(t, home, `{"cammut":{"upstreams":["http://127.0.0.1:7421"],"authFile":"~/x.json"}}`)
	if _, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": []any{"http://127.0.0.1:7421", "https://added.example"}}}); err != nil {
		t.Fatal(err)
	}
	c := LoadConfig().Cammut
	if ref, ok := c.Auth["https://added.example"]; !ok || ref != "" {
		t.Fatalf("added server has no empty key entry: %v", c.Auth)
	}
	if _, ok := c.Auth["http://127.0.0.1:7421"]; ok {
		t.Fatalf("the old server was changed: %v", c.Auth)
	}
	// a non-string key name is refused
	_, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": []any{"https://a.example"}, "auth": map[string]any{"https://a.example": 123}}})
	var se settingsError
	if !errors.As(err, &se) {
		t.Fatalf("want settingsError, got %v", err)
	}
	// host letters are lower-cased so the same server cannot be listed twice
	_, err = SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": []any{"https://A.example", "https://a.example"}}})
	if !errors.As(err, &se) {
		t.Fatalf("want duplicate refused, got %v", err)
	}
}

// A hand-edited empty list makes LoadConfig use the default server. The console then posts that server back:
// it is known, so it gets no empty key entry and the owner's AuthFile still reaches it.
func TestSaveSettingsKeepsAuthFileForDefaultServerAfterEmptyList(t *testing.T) {
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	writeGatewayJSON(t, home, `{"cammut":{"upstreams":[],"authFile":"~/x.json"}}`)
	def := defaultConfig().Cammut.Upstreams[0]
	if _, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": []any{def, "https://memory.example.org"}}}); err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	b, _ := os.ReadFile(filepath.Join(home, "gateway.json"))
	_ = json.Unmarshal(b, &raw)
	auth, _ := raw["cammut"].(map[string]any)["auth"].(map[string]any)
	if _, has := auth[strings.TrimRight(def, "/")]; has {
		t.Fatalf("the default server got a key entry, so the AuthFile no longer reaches it: %v", auth)
	}
	if v, has := auth["https://memory.example.org"]; !has || v != "" {
		t.Fatalf("the new server must start with an empty key entry: %v", auth)
	}
}

// A refused address is named in the error, without its user name, password or query.
func TestBadCammutAddressIsNamedWithoutItsSecret(t *testing.T) {
	t.Setenv("ARC_HOME", t.TempDir())
	addr := "https://owner:hunter2" + "@mcp.example/cammut?key=abc123"
	_, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": []any{"http://127.0.0.1:7421", addr}}})
	if err == nil {
		t.Fatal("want an error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "https://mcp.example/cammut") {
		t.Errorf("the error does not name the address: %s", msg)
	}
	for _, secret := range []string{"hunter2", "owner", "abc123"} {
		if strings.Contains(msg, secret) {
			t.Errorf("the error holds %q: %s", secret, msg)
		}
	}
	if got := plainAddr("http://127.0.0.1:7421/"); got != "http://127.0.0.1:7421" {
		t.Errorf("plainAddr changed a plain address: %s", got)
	}
}

// A stored address with capital letters in the host is the same server as its normalized form:
// it stays known, gets no empty key entry and keeps the owner's AuthFile.
func TestStoredUppercaseHostStaysKnown(t *testing.T) {
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	writeGatewayJSON(t, home, `{"cammut":{"upstreams":["https://VPS.example.org"],"authFile":"~/a.json"}}`)
	if _, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": []any{"https://VPS.example.org", "https://new.example.org"}}}); err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	b, _ := os.ReadFile(filepath.Join(home, "gateway.json"))
	_ = json.Unmarshal(b, &raw)
	auth, _ := raw["cammut"].(map[string]any)["auth"].(map[string]any)
	if _, has := auth["https://vps.example.org"]; has {
		t.Fatalf("the stored server got a key entry and lost the AuthFile: %v", auth)
	}
	if v, has := auth["https://new.example.org"]; !has || v != "" {
		t.Fatalf("the new server must start with an empty key entry: %v", auth)
	}
}

// The answers that need no token (GET /api/config, /health) and every address error hold no user name, password or query.
func TestAnswersWithoutTokenHoldNoAddressSecret(t *testing.T) {
	secret := "https://owner:hunter2" + "@mcp.example/cammut?key=abc123"
	cfg := defaultConfig()
	cfg.Cammut.Upstreams = []string{secret}
	sum, _ := json.Marshal(cammutSummary(cfg, map[string]string{}))
	_, ftpErr := normUpstream("ftp://owner:hunter2" + "@mcp.example")
	texts := map[string]string{
		"config summary": string(sum),
		"health error":   scrubAddrs(`Post "` + secret + `": dial tcp: connection refused`),
		"scheme error":   ftpErr.Error(),
	}
	for name, text := range texts {
		for _, s := range []string{"hunter2", "owner", "abc123"} {
			if strings.Contains(text, s) {
				t.Errorf("%s holds %q: %s", name, s, text)
			}
		}
		if !strings.Contains(text, "mcp.example") {
			t.Errorf("%s does not name the server: %s", name, text)
		}
	}
}

// An address that an older build saved with a query keeps its stored form when the console posts its plain form back,
// so adding another server does not drop the key that the address holds.
func TestOlderAddressWithQueryKeepsItsStoredForm(t *testing.T) {
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	def := defaultConfig().Cammut.Upstreams[0]
	writeGatewayJSON(t, home, `{"cammut":{"upstreams":["`+def+`","https://MCP.example/cammut?key=abc123"],"authFile":"~/a.json"}}`)
	save := func(list ...any) map[string]any {
		t.Helper()
		if _, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": list}}); err != nil {
			t.Fatal(err)
		}
		var raw map[string]any
		b, _ := os.ReadFile(filepath.Join(home, "gateway.json"))
		_ = json.Unmarshal(b, &raw)
		return raw["cammut"].(map[string]any)
	}
	c := save(def, "https://mcp.example/cammut", "https://x.example")
	ups := fmt.Sprint(c["upstreams"])
	if !strings.Contains(ups, "https://MCP.example/cammut?key=abc123") || !strings.Contains(ups, "https://x.example") {
		t.Fatalf("the stored form was not kept: %s", ups)
	}
	auth, _ := c["auth"].(map[string]any)
	if len(auth) != 1 || auth["https://x.example"] != "" {
		t.Fatalf("only the new server gets an empty key entry: %v", auth)
	}
	// leaving it out of the list removes it
	c = save(def, "https://x.example")
	if strings.Contains(fmt.Sprint(c["upstreams"]), "mcp.example") {
		t.Fatalf("a removed server stayed: %v", c["upstreams"])
	}
}

// The default server is the owner's own Cammut on this computer: after a remove and a new add it still gets the AuthFile.
func TestReaddedDefaultServerKeepsAuthFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("ARC_HOME", home)
	def := defaultConfig().Cammut.Upstreams[0]
	writeGatewayJSON(t, home, `{"cammut":{"upstreams":["`+def+`","https://b.example"],"authFile":"~/a.json"}}`)
	for _, list := range [][]any{{"https://b.example"}, {"https://b.example", def}} {
		if _, err := SaveSettings(map[string]any{"cammut": map[string]any{"upstreams": list}}); err != nil {
			t.Fatal(err)
		}
	}
	var raw map[string]any
	b, _ := os.ReadFile(filepath.Join(home, "gateway.json"))
	_ = json.Unmarshal(b, &raw)
	if auth, ok := raw["cammut"].(map[string]any)["auth"].(map[string]any); ok {
		if _, has := auth[strings.TrimRight(def, "/")]; has {
			t.Fatalf("the default server got a key entry and lost the AuthFile: %v", auth)
		}
	}
}

// A "/" inside a password does not keep the secret in the plain form of an address.
func TestPlainAddrCutsUserInfoWithSlash(t *testing.T) {
	if got := plainAddr("https://owner:pa/ss@mcp.example/cammut"); got != "https://mcp.example/cammut" {
		t.Fatalf("plainAddr kept the user info: %s", got)
	}
}

// An address kept in its older stored form (with a query) still finds the key entry saved in normalized form.
func TestStoredFormAddressFindsItsKey(t *testing.T) {
	c := defaultConfig()
	c.Cammut.Upstreams = []string{"https://mcp.example/cammut?key=abc"}
	c.Cammut.Auth = map[string]string{"https://mcp.example/cammut": "VPS_KEY"}
	c.Cammut.AuthFile = "~/a.json"
	v, own := cammutAuthFor(c, c.Cammut.Upstreams[0], map[string]string{"VPS_KEY": "k"})
	if !own || v != "Bearer k" {
		t.Fatalf("the key entry was not found: %q %v", v, own)
	}
}
