package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// Route sends one path prefix to one upstream API.
type Route struct {
	Prefix          string `json:"prefix"`          // "/anthropic", "/merge/v1"
	Target          string `json:"target"`          // upstream base URL
	KeyRef          string `json:"keyRef"`          // name in .credentials.yaml refs
	Auth            string `json:"auth"`            // "bearer" (default), "x-api-key", "vertex", "none"
	Anthropic       bool   `json:"anthropic"`       // native Anthropic API: prompt caching on /messages, stop on client close
	NormalizeModels bool   `json:"normalizeModels"` // fill id/object in GET /models
	VertexProject   string `json:"vertexProject"`
	VertexLocation  string `json:"vertexLocation"`
	// reasoning effort for chat requests that carry none ("off", "low", ...); empty adds nothing
	DefaultReasoningEffort string `json:"defaultReasoningEffort"`
	// overrides request reasoning effort on this route when set ("off", "low", "medium", "high")
	ForceReasoningEffort string `json:"forceReasoningEffort,omitempty"`
	// Vertex AI performance knobs (nil / 0 = smart defaults for auth=="vertex")
	StreamThoughts   *bool `json:"streamThoughts,omitempty"`
	CompressRequests *bool `json:"compressRequests,omitempty"`
	MaxOutputTokens  int   `json:"maxOutputTokens,omitempty"`
	MaxConcurrent    int   `json:"maxConcurrent,omitempty"`
}

func (rt Route) streamThoughtsEnabled() bool {
	if rt.StreamThoughts != nil {
		return *rt.StreamThoughts
	}
	return rt.Auth == "vertex"
}

func (rt Route) compressRequestsEnabled() bool {
	if rt.CompressRequests != nil {
		return *rt.CompressRequests
	}
	return rt.Auth == "vertex"
}

func (rt Route) maxOutputCap() int {
	if rt.MaxOutputTokens > 0 {
		return rt.MaxOutputTokens
	}
	if rt.Auth == "vertex" {
		return 32768
	}
	return 0
}

func (rt Route) maxConcurrentCap() int {
	if rt.MaxConcurrent > 0 {
		return rt.MaxConcurrent
	}
	if rt.Auth == "vertex" {
		return 3
	}
	return 0
}

// Governor keeps Cammut memory answers inside a size budget.
type Governor struct {
	Enabled       bool    `json:"enabled"`
	MaxChars      int     `json:"maxChars"`
	MaxTokensCap  int     `json:"maxTokensCap"`
	MinScoreRatio float64 `json:"minScoreRatio"`
	MinKeep       int     `json:"minKeep"`
	SwapRate      float64 `json:"swapRate"`
	UsageLog      bool    `json:"usageLog"` // one line per recall in logs/cammut-usage.jsonl
}

type Cammut struct {
	Upstreams []string `json:"upstreams"` // tried in order; the next one only when the connection fails
	AuthFile  string   `json:"authFile"`  // JSON file with mcpServers.cammut.headers.Authorization
	// Auth names the key of one upstream (a name in .credentials.yaml refs). An upstream with an entry never
	// gets the AuthFile header; "" means no Authorization header at all. Upstreams without an entry keep AuthFile.
	Auth     map[string]string `json:"auth,omitempty"`
	Governor Governor          `json:"governor"`
}

type Caching struct {
	Enabled             bool   `json:"enabled"`
	AutoFallbackNoCache bool   `json:"autoFallbackNoCache"`
	TTL                 string `json:"ttl"`
}

type Config struct {
	Port                    int      `json:"port"`
	Routes                  []Route  `json:"routes"`
	Cammut                  Cammut   `json:"cammut"`
	DefaultReasoningEffort  string   `json:"defaultReasoningEffort"`
	ForceReasoningEffort    string   `json:"forceReasoningEffort"`
	Temperature             *float64 `json:"temperature"`
	MaxTokens               *float64 `json:"maxTokens"`
	AutoFallbackNoReasoning bool     `json:"autoFallbackNoReasoning"`
	PromptCaching           Caching  `json:"promptCaching"`
}

func defaultConfig() Config {
	return Config{
		Port: 7424,
		Cammut: Cammut{
			Upstreams: []string{"http://127.0.0.1:7421"},
			Governor:  Governor{Enabled: true, MaxChars: 9000, MaxTokensCap: 1500, MinScoreRatio: 0.8, MinKeep: 3},
		},
		DefaultReasoningEffort:  "high",
		AutoFallbackNoReasoning: true,
		PromptCaching:           Caching{Enabled: true, AutoFallbackNoCache: true},
	}
}

// Home is the gateway's folder (default ~/.arc; ARC_HOME overrides it for tests).
func Home() string {
	if h := os.Getenv("ARC_HOME"); h != "" {
		return h
	}
	d, _ := os.UserHomeDir()
	return filepath.Join(d, ".arc")
}

func configPath() string { return filepath.Join(Home(), "gateway.json") }

var cfgMu sync.Mutex

// LoadConfig reads gateway.json over the defaults. A missing or broken file gives the defaults.
func LoadConfig() Config {
	c := defaultConfig()
	b, err := os.ReadFile(configPath())
	if err != nil {
		return withEnvPort(c)
	}
	_ = json.Unmarshal(b, &c)
	if c.Port == 0 {
		c.Port = 7424
	}
	if len(c.Cammut.Upstreams) == 0 {
		c.Cammut.Upstreams = defaultConfig().Cammut.Upstreams
	}
	return withEnvPort(c)
}

// ARC_GATEWAY_PORT overrides the port (handy for running a second copy side by side).
func withEnvPort(c Config) Config {
	var p int
	if _, err := fmt.Sscan(os.Getenv("ARC_GATEWAY_PORT"), &p); err == nil && p > 0 {
		c.Port = p
	}
	return c
}

// SaveSettings merges the editable settings into gateway.json and keeps every other field.
func SaveSettings(patch map[string]any) (Config, error) {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	raw := map[string]any{}
	if b, err := os.ReadFile(configPath()); err == nil {
		// a broken file is never overwritten: the routes in it would be lost
		if err := json.Unmarshal(b, &raw); err != nil {
			return Config{}, fmt.Errorf("gateway.json does not parse, fix it by hand first: %w", err)
		}
	}
	for _, k := range []string{"defaultReasoningEffort", "forceReasoningEffort", "temperature", "maxTokens"} {
		if v, ok := patch[k]; ok {
			raw[k] = v
		}
	}
	if v, ok := patch["cammut"]; ok {
		if err := mergeCammutPatch(raw, v); err != nil {
			return Config{}, err
		}
	}
	b, _ := json.MarshalIndent(raw, "", "  ")
	if err := os.MkdirAll(Home(), 0o700); err != nil {
		return Config{}, err
	}
	if err := writeAtomic(configPath(), b); err != nil {
		return Config{}, err
	}
	return LoadConfig(), nil
}

// settingsError is a refused settings patch (the caller sent something wrong), as opposed to a failed write.
type settingsError string

func (e settingsError) Error() string { return string(e) }

const maxCammutUpstreams = 8

var keyRefName = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)

// normUpstream returns the address without a trailing slash, or an error text. Only http and https, a host,
// no user name or password, no query and no fragment: a secret must never sit in the address.
func normUpstream(s string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return "", fmt.Errorf("a Cammut address must be http or https with a host: %q", s)
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Contains(s, "?") || strings.Contains(s, "#") {
		return "", fmt.Errorf("a Cammut address holds no user name, password, query or fragment")
	}
	u.Host = strings.ToLower(u.Host)
	return strings.TrimRight(u.String(), "/"), nil
}

// mergeCammutPatch sets cammut.upstreams (and cammut.auth) inside raw and keeps authFile, governor and every other field.
// An empty list is refused: LoadConfig would quietly put the default server back.
func mergeCammutPatch(raw map[string]any, v any) error {
	p := obj(v)
	list, ok := p["upstreams"].([]any)
	if p == nil || !ok || len(list) == 0 || len(list) > maxCammutUpstreams {
		return settingsError(fmt.Sprintf("cammut.upstreams must list 1 to %d addresses", maxCammutUpstreams))
	}
	ups := make([]string, 0, len(list))
	seen := map[string]bool{}
	for _, it := range list {
		s, _ := it.(string)
		n, err := normUpstream(s)
		if err != nil {
			return settingsError(err.Error())
		}
		if seen[n] {
			return settingsError("a Cammut address is listed twice: " + n)
		}
		seen[n] = true
		ups = append(ups, n)
	}
	cm := obj(raw["cammut"])
	if cm == nil {
		cm = map[string]any{}
	}
	// a server that is new in this patch starts with an empty key entry, so the owner's AuthFile never reaches it
	known := map[string]bool{}
	if old, ok := cm["upstreams"].([]any); ok {
		for _, o := range old {
			if str, _ := o.(string); str != "" {
				known[strings.TrimRight(str, "/")] = true
			}
		}
	} else {
		for _, d := range defaultConfig().Cammut.Upstreams {
			known[d] = true
		}
	}
	auth := map[string]any{}
	src := obj(cm["auth"])
	if a, has := p["auth"]; has {
		src = obj(a)
		if src == nil {
			return settingsError("cammut.auth must be an object")
		}
	}
	for k, val := range src {
		n, err := normUpstream(k)
		name, isStr := val.(string)
		if _, has := p["auth"]; has && !isStr {
			return settingsError("a key name must be text")
		}
		if err != nil || !seen[n] {
			if _, has := p["auth"]; has {
				return settingsError("cammut.auth names a server that is not in the list: " + k)
			}
			continue // a removed server drops its key entry
		}
		if name != "" && !keyRefName.MatchString(name) {
			return settingsError("a key name holds only letters, digits and underscores")
		}
		auth[n] = name
	}
	for _, n := range ups {
		if _, has := auth[n]; !has && !known[n] {
			auth[n] = ""
		}
	}
	cm["upstreams"] = ups
	if len(auth) > 0 {
		cm["auth"] = auth
	} else {
		delete(cm, "auth")
	}
	raw["cammut"] = cm
	return nil
}

// cammutAuthFor picks the Authorization value for one upstream: its own key, nothing, or the AuthFile header.
func cammutAuthFor(c Config, base string, refs map[string]string) (value string, own bool) {
	if ref, ok := c.Cammut.Auth[strings.TrimRight(base, "/")]; ok {
		if ref == "" || refs[ref] == "" {
			return "", true
		}
		return "Bearer " + refs[ref], true
	}
	return CammutAuth(c), false
}

// writeAtomic writes beside the target and renames, so a crash never leaves half a file.
func writeAtomic(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Credentials: .credentials.yaml holds a "refs:" block of NAME: value lines (the format the desktop app writes).
func credPath() string { return filepath.Join(Home(), ".credentials.yaml") }

var refLine = regexp.MustCompile(`^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$`)

func LoadRefs() map[string]string {
	refs := map[string]string{}
	f, err := os.Open(credPath())
	if err != nil {
		return refs
	}
	defer f.Close()
	in := false
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.TrimRight(line, " ") == "refs:" {
			in = true
			continue
		}
		if in && len(line) > 0 && line[0] != ' ' && line[0] != '\t' {
			in = false
		}
		if in {
			if m := refLine.FindStringSubmatch(line); m != nil {
				refs[m[1]] = strings.Trim(m[2], `'"`)
			}
		}
	}
	return refs
}

// SaveRef sets one key in the refs block. A masked value ("***") is ignored.
func SaveRef(key, val string) error {
	val = strings.TrimSpace(val)
	if val == "" || strings.Contains(val, "***") || !regexp.MustCompile(`^[A-Za-z0-9_]+$`).MatchString(key) {
		return nil
	}
	if strings.ContainsAny(val, "\r\n") {
		return fmt.Errorf("a key value must be one line")
	}
	raw := "version: 1\nrecords: {}\nrefs:\n"
	if b, err := os.ReadFile(credPath()); err == nil {
		raw = string(b)
	}
	re := regexp.MustCompile(`(?m)^(\s+` + key + `:\s*)(.+)$`)
	if re.MatchString(raw) {
		raw = re.ReplaceAllLiteralString(raw, "  "+key+": "+val)
	} else {
		raw = strings.TrimRight(raw, "\r\n") + "\n  " + key + ": " + val + "\n"
	}
	return writeAtomic(credPath(), []byte(raw))
}

// CammutAuth returns the Authorization header for Cammut from the configured JSON file, if any.
func CammutAuth(c Config) string {
	if c.Cammut.AuthFile == "" {
		return ""
	}
	p := c.Cammut.AuthFile
	if strings.HasPrefix(p, "~") {
		h, _ := os.UserHomeDir()
		p = filepath.Join(h, p[1:])
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	var v struct {
		McpServers map[string]struct {
			Headers map[string]string `json:"headers"`
		} `json:"mcpServers"`
	}
	if json.Unmarshal(b, &v) != nil {
		return ""
	}
	return v.McpServers["cammut"].Headers["Authorization"]
}
