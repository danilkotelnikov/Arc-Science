package main

import (
	"bufio"
	"encoding/json"
	"fmt"
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
	Governor  Governor `json:"governor"`
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
	b, _ := json.MarshalIndent(raw, "", "  ")
	if err := os.MkdirAll(Home(), 0o700); err != nil {
		return Config{}, err
	}
	if err := writeAtomic(configPath(), b); err != nil {
		return Config{}, err
	}
	return LoadConfig(), nil
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
