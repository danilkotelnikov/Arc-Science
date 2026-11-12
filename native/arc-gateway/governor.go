package main

// Cammut recall governor: keeps what Hindsight sends back inside a size budget.
// capRequest lowers max_tokens on hindsight/recall; governResponse slims the answer (fields, duplicates, weak tail, size).
// Every step fails open: anything it does not recognise passes through unchanged.
// swapRate swaps neighbouring results at random so a later model can learn which notes agents use without
// "only the first note is read" bias; the trace holds the order before and after. "_lab": true in the recall
// arguments is removed here, and that call gets no swap and no log row.

import (
	"bytes"
	"encoding/json"
	"math"
	"math/rand"
	"regexp"
	"strings"
	"unicode/utf16"
)

// jsLen is the length JavaScript would report (UTF-16 code units), so budgets match the old gateway.
func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

// marshal is JSON without HTML escaping, close to JSON.stringify.
func marshal(v any) string {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	_ = e.Encode(v)
	return strings.TrimSuffix(b.String(), "\n")
}

func obj(v any) map[string]any { m, _ := v.(map[string]any); return m }
func arr(v any) []any          { a, _ := v.([]any); return a }

func isRecallCall(m map[string]any) bool {
	p := obj(m["params"])
	return m["method"] == "tools/call" && p != nil && p["name"] == "cammut_call" &&
		obj(p["arguments"]) != nil && obj(p["arguments"])["tool"] == "hindsight/recall"
}

func asList(v any) []map[string]any {
	if a, ok := v.([]any); ok {
		out := []map[string]any{}
		for _, x := range a {
			if m := obj(x); m != nil {
				out = append(out, m)
			}
		}
		return out
	}
	if m := obj(v); m != nil {
		return []map[string]any{m}
	}
	return nil
}

type capResult struct {
	Body     []byte
	IsRecall bool
	Lab      bool
	Query    string
}

func capRequest(body []byte, g Governor) capResult {
	if !g.Enabled {
		return capResult{Body: body}
	}
	var msg any
	if json.Unmarshal(body, &msg) != nil {
		return capResult{Body: body}
	}
	r := capResult{Body: body}
	changed := false
	for _, m := range asList(msg) {
		if !isRecallCall(m) {
			continue
		}
		r.IsRecall = true
		outer := obj(obj(m["params"])["arguments"])
		a := obj(outer["arguments"])
		if a == nil {
			a = map[string]any{}
			outer["arguments"] = a
		}
		cap := float64(g.MaxTokensCap)
		if n, ok := a["max_tokens"].(float64); ok {
			cap = math.Min(n, cap)
		}
		if n, ok := a["max_tokens"].(float64); !ok || n != cap {
			a["max_tokens"] = cap
			changed = true
		}
		if v, ok := a["_lab"]; ok {
			r.Lab = r.Lab || v == true
			delete(a, "_lab")
			changed = true
		}
		if q, ok := a["query"].(string); ok {
			r.Query = q
		}
	}
	if changed {
		r.Body = []byte(marshal(msg))
	}
	return r
}

var notWord = regexp.MustCompile(`[^a-z0-9а-яё ]`)
var spaces = regexp.MustCompile(` +`)

func normText(t string) string {
	s := strings.ToLower(strings.SplitN(t, " | ", 2)[0])
	s = strings.TrimSpace(spaces.ReplaceAllString(notWord.ReplaceAllString(s, ""), " "))
	if r := []rune(s); len(r) > 70 {
		s = string(r[:70])
	}
	return s
}

type slimItem struct {
	ID    any      `json:"id"`
	Type  any      `json:"type"`
	Date  string   `json:"date"`
	Score float64  `json:"score"`
	Tags  []string `json:"tags"`
	Text  string   `json:"text"`
}

type govStats struct {
	FromChars   int  `json:"fromChars"`
	FromResults int  `json:"fromResults"`
	Kept        int  `json:"kept"`
	Omitted     int  `json:"omitted"`
	ToChars     *int `json:"toChars,omitempty"`
}

type slimOut struct {
	Results  []slimItem `json:"results"`
	Governor *govStats  `json:"governor"`
}

// Trace records what a recall showed, for the usage log.
type Trace struct {
	Order [][2]any `json:"order"`
	Shown []any    `json:"shown"`
	Swaps []int    `json:"swaps"`
	From  int      `json:"from"`
}

var tagSkip = regexp.MustCompile(`^(date|source|project):`)

func score(r map[string]any) float64 {
	if s := obj(r["scores"]); s != nil {
		if f, ok := s["final"].(float64); ok {
			return f
		}
	}
	return 1
}

func slimRecall(rec map[string]any, g Governor, rng func() float64, tr *Trace) slimOut {
	results := asList(rec["results"])
	fromChars := jsLen(marshal(rec))
	seen := map[string]bool{}
	unique := []map[string]any{}
	for _, r := range results {
		t, _ := r["text"].(string)
		k := normText(t)
		if k != "" && seen[k] {
			continue
		}
		seen[k] = true
		unique = append(unique, r)
	}
	top := math.Inf(-1)
	for _, r := range unique {
		top = math.Max(top, score(r))
	}
	strong := []map[string]any{}
	for i, r := range unique {
		if i < g.MinKeep || score(r) >= g.MinScoreRatio*top {
			strong = append(strong, r)
		}
	}
	order := [][2]any{}
	for _, r := range strong {
		order = append(order, [2]any{r["id"], math.Round(score(r)*1000) / 1000})
	}
	swaps := []int{}
	if g.SwapRate > 0 {
		for i := 0; i+1 < len(strong); i++ {
			if rng() < g.SwapRate {
				strong[i], strong[i+1] = strong[i+1], strong[i]
				swaps = append(swaps, i)
				i++
			}
		}
	}
	out := slimOut{Results: []slimItem{}}
	used := 0
	for _, r := range strong {
		tags := []string{}
		for _, t := range arr(r["tags"]) {
			if s, ok := t.(string); ok && !tagSkip.MatchString(s) && len(tags) < 3 {
				tags = append(tags, s)
			}
		}
		date, _ := r["mentioned_at"].(string)
		if rs := []rune(date); len(rs) > 10 {
			date = string(rs[:10])
		}
		text, _ := r["text"].(string)
		it := slimItem{ID: r["id"], Type: r["fact_type"], Date: date, Score: math.Round(score(r)*100) / 100, Tags: tags, Text: text}
		n := jsLen(marshal(it)) + 1
		if len(out.Results) >= g.MinKeep && used+n > g.MaxChars {
			break
		}
		out.Results = append(out.Results, it)
		used += n
	}
	out.Governor = &govStats{FromChars: fromChars, FromResults: len(results), Kept: len(out.Results), Omitted: len(results) - len(out.Results)}
	to := jsLen(marshal(out))
	out.Governor.ToChars = &to
	if tr != nil {
		shown := []any{}
		for _, it := range out.Results {
			shown = append(shown, it.ID)
		}
		*tr = Trace{Order: order, Shown: shown, Swaps: swaps, From: len(results)}
	}
	return out
}

func isRawRecall(o map[string]any) bool {
	rs := arr(o["results"])
	if len(rs) == 0 {
		return false
	}
	for _, x := range rs {
		r := obj(x)
		if r == nil {
			return false
		}
		if _, ok := r["text"].(string); !ok {
			return false
		}
		_, ft := r["fact_type"]
		_, sc := r["scores"]
		if !ft && !sc {
			return false
		}
	}
	return true
}

func governMessage(msg map[string]any, g Governor, rng func() float64, tr *Trace) *govStats {
	res := obj(msg["result"])
	content := arr(res["content"])
	if content == nil {
		return nil
	}
	var kept *govStats
	for _, x := range content {
		item := obj(x)
		if item == nil || item["type"] != "text" {
			continue
		}
		t, ok := item["text"].(string)
		if !ok {
			continue
		}
		var inner map[string]any
		if json.Unmarshal([]byte(t), &inner) != nil || !isRawRecall(inner) {
			continue
		}
		slim := slimRecall(inner, g, rng, tr)
		item["text"] = marshal(slim)
		kept = slim.Governor
	}
	if kept != nil {
		delete(res, "structuredContent") // the slim text already holds the answer; the structured copy would double it
	}
	return kept
}

type govResult struct {
	Text      string
	FromChars int
	ToChars   int
	Kept      int
	Omitted   int
}

func governResponse(body string, contentType string, g Governor, rng func() float64, tr *Trace) *govResult {
	if !g.Enabled {
		return nil
	}
	if rng == nil {
		rng = rand.Float64
	}
	var kept *govStats
	var text string
	if strings.Contains(strings.ToLower(contentType), "text/event-stream") {
		lines := strings.Split(body, "\n")
		for i, line := range lines {
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			var msg map[string]any
			if json.Unmarshal([]byte(strings.TrimSpace(line[5:])), &msg) != nil {
				continue
			}
			if k := governMessage(msg, g, rng, tr); k != nil {
				kept = k
				lines[i] = "data: " + marshal(msg)
			}
		}
		text = strings.Join(lines, "\n")
	} else {
		var msg any
		if json.Unmarshal([]byte(body), &msg) != nil {
			return nil
		}
		for _, m := range asList(msg) {
			if k := governMessage(m, g, rng, tr); k != nil {
				kept = k
			}
		}
		text = marshal(msg)
	}
	if kept == nil {
		return nil
	}
	return &govResult{Text: text, FromChars: jsLen(body), ToChars: jsLen(text), Kept: kept.Kept, Omitted: kept.Omitted}
}

// Anthropic prompt caching: adds cache_control breakpoints (Anthropic allows 4) on tools, system and the
// last two user turns when the caller did not set them.
const maxCacheBreakpoints = 4

var anthropicModel = regexp.MustCompile(`(?i)^(?:anthropic/|claude-)`)

func hasCC(m map[string]any) bool {
	_, ok := m["cache_control"]
	return ok && m["cache_control"] != nil
}

func hasMsgCache(m map[string]any) bool {
	if hasCC(m) {
		return true
	}
	for _, b := range asList(m["content"]) {
		if hasCC(b) {
			return true
		}
	}
	return false
}

func countBreakpoints(msg map[string]any) int {
	n := 0
	for _, t := range asList(msg["tools"]) {
		if hasCC(t) || (obj(t["function"]) != nil && hasCC(obj(t["function"]))) {
			n++
		}
	}
	if _, ok := msg["system"].([]any); ok {
		for _, b := range asList(msg["system"]) {
			if hasCC(b) {
				n++
			}
		}
	}
	for _, m := range asList(msg["messages"]) {
		if hasCC(m) {
			n++
		}
		if _, ok := m["content"].([]any); ok {
			for _, b := range asList(m["content"]) {
				if hasCC(b) {
					n++
				}
			}
		}
	}
	return n
}

func newMarker(ttl string) map[string]any {
	if ttl == "1h" {
		return map[string]any{"type": "ephemeral", "ttl": "1h"}
	}
	return map[string]any{"type": "ephemeral"}
}

func markContent(m map[string]any, ttl string, native bool) bool {
	if s, ok := m["content"].(string); ok && strings.TrimSpace(s) != "" {
		m["content"] = []any{map[string]any{"type": "text", "text": s, "cache_control": newMarker(ttl)}}
		return true
	}
	c := arr(m["content"])
	for i := len(c) - 1; i >= 0; i-- {
		b := obj(c[i])
		if b == nil {
			continue
		}
		if t, ok := b["text"].(string); ok && b["type"] == "text" && strings.TrimSpace(t) != "" {
			b["cache_control"] = newMarker(ttl)
			return true
		}
		if native && (b["type"] == "tool_result" || b["type"] == "image" || b["type"] == "document") {
			b["cache_control"] = newMarker(ttl)
			return true
		}
	}
	return false
}

// applyAnthropicCache returns the new body and true when it added at least one breakpoint.
func applyAnthropicCache(body []byte, native bool, ttl string) ([]byte, bool) {
	var msg map[string]any
	if len(body) == 0 || json.Unmarshal(body, &msg) != nil || msg == nil {
		return body, false
	}
	model, _ := msg["model"].(string)
	if !native && !anthropicModel.MatchString(strings.TrimSpace(model)) {
		return body, false
	}
	total := countBreakpoints(msg)
	if total >= maxCacheBreakpoints {
		return body, false
	}
	added := 0
	tools := asList(msg["tools"])
	anyToolCC := false
	for _, t := range tools {
		if hasCC(t) || (obj(t["function"]) != nil && hasCC(obj(t["function"]))) {
			anyToolCC = true
		}
	}
	if len(tools) > 0 && !anyToolCC {
		idx := len(tools) - 1
		for idx > 0 && tools[idx]["defer_loading"] == true {
			idx--
		}
		tools[idx]["cache_control"] = newMarker(ttl)
		total++
		added++
	}
	if native {
		if s, ok := msg["system"].(string); ok && total < maxCacheBreakpoints && strings.TrimSpace(s) != "" {
			msg["system"] = []any{map[string]any{"type": "text", "text": s, "cache_control": newMarker(ttl)}}
			total++
			added++
		} else if sys := asList(msg["system"]); total < maxCacheBreakpoints && len(sys) > 0 {
			any := false
			for _, b := range sys {
				if hasCC(b) {
					any = true
				}
			}
			if !any {
				for i := len(sys) - 1; i >= 0; i-- {
					if t, ok := sys[i]["text"].(string); ok && sys[i]["type"] == "text" && strings.TrimSpace(t) != "" {
						sys[i]["cache_control"] = newMarker(ttl)
						total++
						added++
						break
					}
				}
			}
		}
	} else if msgs := asList(msg["messages"]); total < maxCacheBreakpoints && len(msgs) > 0 {
		sys := []map[string]any{}
		for _, m := range msgs {
			if m["role"] == "system" || m["role"] == "developer" {
				sys = append(sys, m)
			}
		}
		anyC := false
		for _, m := range sys {
			if hasMsgCache(m) {
				anyC = true
			}
		}
		if len(sys) > 0 && !anyC && markContent(sys[len(sys)-1], ttl, false) {
			total++
			added++
		}
	}
	if msgs := asList(msg["messages"]); total < maxCacheBreakpoints && len(msgs) > 0 {
		users := []map[string]any{}
		for _, m := range msgs {
			if m["role"] == "user" {
				users = append(users, m)
			}
		}
		anyC := false
		for _, u := range users {
			if hasMsgCache(u) {
				anyC = true
			}
		}
		if len(users) > 0 && !anyC {
			cand := []map[string]any{users[len(users)-1]}
			if len(users) >= 2 {
				cand = append(cand, users[len(users)-2])
			}
			for _, u := range cand {
				if total >= maxCacheBreakpoints {
					continue
				}
				if markContent(u, ttl, native) {
					total++
					added++
				}
			}
		}
	}
	if added == 0 {
		return body, false
	}
	return []byte(marshal(msg)), true
}
