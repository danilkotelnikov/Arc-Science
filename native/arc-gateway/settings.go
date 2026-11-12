package main

import (
	"fmt"
	"html"
	"sort"
	"strings"
)

// settingsHTML is the small page at http://127.0.0.1:<port>/settings.
func settingsHTML(cfg Config) string {
	keys := map[string]bool{}
	for _, r := range cfg.Routes {
		if r.KeyRef != "" {
			keys[r.KeyRef] = true
		}
	}
	names := make([]string, 0, len(keys))
	for k := range keys {
		names = append(names, k)
	}
	sort.Strings(names)
	var inputs strings.Builder
	for _, k := range names {
		e := html.EscapeString(k)
		fmt.Fprintf(&inputs, `<div><label>%s (leave masked to keep it)</label><input data-key="%s" type="password" autocomplete="off"></div>`, e, e)
	}
	return strings.ReplaceAll(strings.ReplaceAll(page, "{{PORT}}", fmt.Sprint(cfg.Port)), "{{KEYS}}", inputs.String())
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Arc gateway</title>
<style>
 body{font-family:system-ui,sans-serif;background:#f7f4ef;color:#2a2421;max-width:720px;margin:32px auto;padding:0 20px}
 h1{font-size:20px} .card{background:#fff;border:1px solid #e3ddd4;border-radius:8px;padding:18px;margin-bottom:16px}
 label{display:block;font-size:13px;color:#6b625b;margin:12px 0 4px}
 input,select{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #cfc7bc;border-radius:6px;font-size:14px;background:#fff}
 .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 button{background:#54453c;color:#fff;border:0;padding:9px 16px;border-radius:6px;margin-top:14px;cursor:pointer}
 #msg{margin-left:10px;font-size:13px}
</style></head><body>
<h1>Arc gateway on 127.0.0.1:{{PORT}}</h1>
<div class="card">
 <div class="row">
  <div><label>Reasoning effort when the app sends none</label><select id="defaultReasoningEffort"><option>off</option><option>low</option><option>medium</option><option>high</option></select></div>
  <div><label>Always use this reasoning effort</label><select id="forceReasoningEffort"><option value="">No, follow the app</option><option>off</option><option>low</option><option>medium</option><option>high</option></select></div>
 </div>
 <div class="row">
  <div><label>Temperature (blank = model default)</label><input id="temperature" type="number" step="0.1"></div>
  <div><label>Max output tokens (blank = model default)</label><input id="maxTokens" type="number"></div>
 </div>
 <div class="row">{{KEYS}}</div>
 <label>Gateway token (file .arc/.gateway-token; needed to save)</label><input id="tok" type="password" autocomplete="off">
 <button onclick="save()">Save</button><span id="msg"></span>
</div>
<script>
async function load(){const r=await fetch('/api/config').then(x=>x.json());
 for(const k of ['defaultReasoningEffort','forceReasoningEffort'])document.getElementById(k).value=r[k]??'';
 document.getElementById('temperature').value=r.temperature??'';document.getElementById('maxTokens').value=r.maxTokens??'';
 for(const el of document.querySelectorAll('[data-key]'))el.value=r.keys&&r.keys[el.dataset.key]?'********':'';}
async function save(){const num=id=>{const v=document.getElementById(id).value;return v===''?null:Number(v)};
 const keys={};for(const el of document.querySelectorAll('[data-key]'))if(el.value&&!el.value.includes('***'))keys[el.dataset.key]=el.value;
 const body={defaultReasoningEffort:document.getElementById('defaultReasoningEffort').value,forceReasoningEffort:document.getElementById('forceReasoningEffort').value,temperature:num('temperature'),maxTokens:num('maxTokens'),keys};
 const tok=document.getElementById('tok').value.trim();sessionStorage.setItem('arcGwToken',tok);
 const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-Arc-Gateway-Token':tok},body:JSON.stringify(body)});
 document.getElementById('msg').textContent=r.ok?'Saved. Active now.':'Not saved: '+r.status+(r.status===401?' (wrong token)':'');}
document.getElementById('tok').value=sessionStorage.getItem('arcGwToken')||'';load();
</script></body></html>`
