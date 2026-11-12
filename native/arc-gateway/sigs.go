package main

// Gemini thought signatures: Google models return a signature with each tool call and refuse the next turn
// without it. Some clients drop it, so the gateway remembers signatures by tool-call id and puts them back.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

const maxSigs = 2000
const skipSig = "skip_thought_signature_validator"

type sigStore struct {
	mu    sync.Mutex
	order []string
	m     map[string]string
	path  string
	timer *time.Timer
}

func newSigStore(path string) *sigStore {
	s := &sigStore{m: map[string]string{}, path: path}
	b, _ := os.ReadFile(path)
	var pairs [][2]string // saved oldest first, so trimming drops the oldest after a restart too
	if json.Unmarshal(b, &pairs) != nil {
		var old map[string]string // the node gateway saved a plain map
		_ = json.Unmarshal(b, &old)
		for k, v := range old {
			pairs = append(pairs, [2]string{k, v})
		}
	}
	for _, p := range pairs {
		if p[0] != "" && p[1] != "" {
			if _, ok := s.m[p[0]]; !ok {
				s.order = append(s.order, p[0])
			}
			s.m[p[0]] = p[1]
		}
	}
	return s
}

func (s *sigStore) get(id string) string { s.mu.Lock(); defer s.mu.Unlock(); return s.m[id] }

func (s *sigStore) remember(id, sig string) {
	if id == "" || sig == "" || sig == skipSig {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.m[id] == sig {
		return
	}
	if _, ok := s.m[id]; !ok {
		s.order = append(s.order, id)
	}
	s.m[id] = sig
	for len(s.order) > maxSigs {
		delete(s.m, s.order[0])
		s.order = s.order[1:]
	}
	if s.timer == nil && s.path != "" {
		s.timer = time.AfterFunc(400*time.Millisecond, s.save)
	}
}

func (s *sigStore) save() {
	s.mu.Lock()
	pairs := make([][2]string, 0, len(s.order))
	for _, id := range s.order {
		pairs = append(pairs, [2]string{id, s.m[id]})
	}
	b, _ := json.Marshal(pairs)
	s.timer = nil
	s.mu.Unlock()
	_ = os.MkdirAll(filepath.Dir(s.path), 0o700)
	_ = writeAtomic(s.path, b)
}

var googleModel = regexp.MustCompile(`(?i)^(google/|gemini)`)

func toolSig(tc map[string]any) string {
	g := obj(obj(tc["extra_content"])["google"])
	s, _ := g["thought_signature"].(string)
	return s
}

func setToolSig(tc map[string]any, sig string) {
	ec := obj(tc["extra_content"])
	if ec == nil {
		ec = map[string]any{}
		tc["extra_content"] = ec
	}
	g := obj(ec["google"])
	if g == nil {
		g = map[string]any{}
		ec["google"] = g
	}
	g["thought_signature"] = sig
}

func (s *sigStore) inject(body map[string]any, vertex bool) {
	model, _ := body["model"].(string)
	needs := vertex || googleModel.MatchString(model)
	for _, msg := range asList(body["messages"]) {
		tcs := asList(msg["tool_calls"])
		if msg["role"] != "assistant" || len(tcs) == 0 {
			continue
		}
		for _, tc := range tcs {
			id, _ := tc["id"].(string)
			if ex := toolSig(tc); ex != "" {
				s.remember(id, ex)
				continue
			}
			if c := s.get(id); c != "" {
				setToolSig(tc, c)
			}
		}
		if needs && toolSig(tcs[0]) == "" {
			sig := skipSig
			for _, tc := range tcs {
				if v := toolSig(tc); v != "" {
					sig = v
					break
				}
			}
			setToolSig(tcs[0], sig)
		}
	}
}

// capture reads one streamed or whole completion payload and remembers id+signature pairs.
func (s *sigStore) capture(payload map[string]any, byIndex map[int]*[2]string) {
	for _, ch := range asList(payload["choices"]) {
		list := asList(obj(ch["delta"])["tool_calls"])
		if list == nil {
			list = asList(obj(ch["message"])["tool_calls"])
		}
		for i, tc := range list {
			idx := i
			if f, ok := tc["index"].(float64); ok {
				idx = int(f)
			}
			rec := byIndex[idx]
			if rec == nil {
				rec = &[2]string{}
				byIndex[idx] = rec
			}
			if id, _ := tc["id"].(string); id != "" {
				rec[0] = id
			}
			if sig := toolSig(tc); sig != "" {
				rec[1] = sig
			}
			if rec[0] != "" && rec[1] != "" {
				s.remember(rec[0], rec[1])
			}
		}
	}
}
