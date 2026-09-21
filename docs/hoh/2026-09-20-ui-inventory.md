# Visible strings and controls — inventory (20 September 2026)

Read-only source inventory of every visible string and control across the Arc Science shell, the seven workspaces and the native desktop startup surface, compiled from separate per-surface readers before the design/copy increment. It records what the source says today together with concrete proposals; it is not a test result and nothing here was verified in a running build.

Surfaces: Shell (`apps/arc-science/web/src/main.jsx`, `icons.jsx`, `styles.css`, `http.js`), Research, Memory, Molecules, BioArt, Prose, Settings, Diagnostics (all under `apps/arc-science/web/src/`), Native startup (`native/arc-desktop/src/launch.rs`, `main.rs`, `startup.rs`, `README.md`). Locations are quoted as the readers gave them; a bare `:N` is a line in the surface's main file.

## 1. Cross-surface findings

Sorted by severity (high, medium, low). Duplicates across surfaces are merged into one row listing every location. Test anchors that pin the current text are named in the proposal where the reader recorded them.

| Severity | Category | Surface | Location | Quote (≤ 12 words) | Proposal (concrete text) |
|---|---|---|---|---|---|
| high | inconsistent-icon | Shell | apps/arc-science/web/src/main.jsx:56 (and icons.jsx:7) | `<Icon name="scan-search"/>BioArt … <Icon name="scan-search"/>Diagnostics` | main.jsx:56: `<Icon name="image"/>BioArt` and `<Icon name="activity"/>Diagnostics`. icons.jsx:7: add two Lucide branches — `name==='image'?<><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></>` and `name==='activity'?<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`. Geometry quoted from Lucide, not from any file read: retrieve via Supericons (icons.jsx:2), verify upstream, credit both in THIRD_PARTY_NOTICES.md. Smaller alternative: reuse the existing `shield-check` for Diagnostics only, after checking it is not already the BioArt receipt glyph. |
| high | duplicated-caveat | Research, Memory, Diagnostics | ResearchWorkspace.jsx:174 (lockCopy) and :190 (alert), both after a 401/403; apps/arc-science/web/src/MemoryWorkspace.jsx:118 and :149; DiagnosticsWorkspace.jsx:6 (rendered at :51, :85, :101, :186, :192) | "Operator session is locked or expired. Enter a current operator token and retry…" | Keep AUTH_RECOVERY / LOCKED once: in the alert (Diagnostics also in the unlock card :186). Research unlock card when authExpired: "Enter a current operator token in the header and retry. To get one, run `arc-science token --data ./data` in the project folder, or open the token file the local service writes. Your draft stays in this window." Memory unlock card: "Enter a current operator token in the header and retry; your unsent search stays here. Get a token with `arc-science token --data ./data` or from the token file the local service writes." Diagnostics cards (:21 protectedFailure, :51, :85, :101): "Operator session is locked. Paste a valid operator token in the shared header to retry." (test substring "Operator session is locked" kept). |
| high | error-copy-not-adjacent | Research, Memory, Molecules, BioArt, Prose, Settings, Diagnostics | ResearchWorkspace.jsx:190 (alert) vs :173/:181 (composer actions); apps/arc-science/web/src/MemoryWorkspace.jsx:149; MolecularRenderPanel.jsx:157 and :166; BioArtWorkspace.jsx:113; ProseWorkspace.jsx:85; SettingsWorkspace.jsx:72-74, :209-210, :259, :267, :342; DiagnosticsWorkspace.jsx:192 | `{error && <p role="alert">{error}</p>}` — one slot per surface | Record which action failed and render the same text under that control, prefixed with the action. Research: under Create and start (including the Measurement JSON parse error) and under Load missions; keep the results-pane alert for verify/export/resume/cancel. Memory: "Range not loaded: {error}" under Load record range, "Not removed: {error}" under the clicked card. Molecules: `<p role="alert">Package check failed: {message}</p>` inside Packages. BioArt: `setErrorScope(recovery\|\|'action')` in task(); alert after :108 (metadata), after :122 (fetch), after the actions row :131 (download/import). Prose: "Rewrite with the prose seat failed: …" / "Detect failed: …" / "Rewrite locally failed: …" inside the group (tests :103, :159 match substrings). Settings: card title "Request failed", text "{action} did not complete. Your draft was kept." under the pressed button (e.g. "Probe Anthropic did not complete. Your draft was kept."). Diagnostics: for kinds mcp/acp render the alert beneath the actions row at :222; keep the card message (tests :138-141 expect both). |
| high | other | Research | ResearchWorkspace.jsx:146 + :51 | `points:points.trim()?JSON.parse(points):null` | Catch the parse error before the request and show "Measurement JSON is not valid JSON: {e.message}" under the Measurement JSON field; never pass a raw SyntaxError through friendlyError. |
| high | unsupported-claim | Research | ResearchWorkspace.jsx:170 | "Adds a sample question to the draft. It will not start a mission." | "Replaces the draft with a sample question. It does not start a mission." |
| high | confusing-locked-state | Research | ResearchWorkspace.jsx:194 | `isDisabled={busy\|\|locked\|\|!mission.release?.eligible_for_human_review}` | Beside the disabled button: `<span className="muted">Export opens when the release decision is Eligible for human review.</span>` |
| high | duplicated-caveat | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:98, :146, :177, :181 | "The stored record is retained locally; this is not deletion." (four wordings) | :181 stays as the single explanation: "Remove from retrieval hides a record from search and session recall. The stored history is not erased." :98 → "Removed from retrieval. The record is still stored locally; nothing was deleted." :146 → "No sessions available for retrieval." :177 middle sentence → "Gaps are records removed from retrieval." |
| high | confusing-locked-state | BioArt, Diagnostics, Prose | BioArtWorkspace.jsx:102, :107; DiagnosticsWorkspace.jsx:219-222; ProseWorkspace.jsx:65-82 | `isDisabled={busy\|\|!token\|\|…}` with no adjacent reason | BioArt after L107: `{!token&&<p className="field-note">Enter the operator token in the header to enable search and inspection.</p>}` (the L7 AUTH_RECOVERY text is never reached while the buttons are disabled). Diagnostics under the actions row: "Needs an operator token (see the unlock note on the left)." Prose: `{!token && <p role="status">Enter the operator token in the header to enable these actions.</p>}` (whether an empty token is reachable depends on the parent, not read). |
| high | other | Settings | SettingsWorkspace.jsx:204 | "Reload" | Label `{dirty ? 'Reload (discards unsaved edits)' : 'Reload'}` — Reload silently replaces the draft; the only warning is inside the 409 card. |
| high | confusing-locked-state | Settings | SettingsWorkspace.jsx:293 and :118 | "CLI executable is not configured for this provider." | OpenClaw CLI cell: replace the permanently disabled input with "not applicable". Readiness/effort note for OpenClaw + CLI: "OpenClaw has no CLI login. Choose API credential." (template at :90: `providerLabel + ' has no ' + (cli ? 'CLI login' : 'API credential') + ' option.'`) |
| high | dead-control | Settings | SettingsWorkspace.jsx:124 and :130 | "Load connection state to check this CLI seat." | No such control exists. Label "not running", detail "Differs from the running seat, or the seat is not running. Save, then Reload." (same at :130 for "Load connection state to compare this API seat with the running route."). |
| high | unsupported-claim | Diagnostics | DiagnosticsWorkspace.jsx:173-180 | "Authenticated diagnostics have not been loaded yet." | sessionState has no 'ok' branch, so the Session card keeps this text after Load capabilities succeeds. Add: when capabilities is non-null and neither locked nor unavailable → state 'ok', copy "Operator token accepted by an authenticated check." (native: "Desktop session verified by an authenticated check."). |
| high | excessive-block | Diagnostics | DiagnosticsWorkspace.jsx:6 | "…or read the project owner-only access.token, then paste it in the shared header." | "Operator session is locked. Get a token by running `arc-science token --data <project directory>` locally, or from the project's owner-only access.token file, then paste it in the shared header token field. Settings holds provider and connection configuration, not the token." (test substrings :41-43 preserved) |
| high | excessive-block | Native startup | launch.rs:406 with startup.rs:428 and startup.rs:12 | `<p class="bad">{reason}</p>` / `format!("{message}\n{tail}")` | `<section class="failure-card" role="alert"><p class="bad">{first line of reason}</p><pre class="muted" style="white-space:pre-wrap;font-size:13px;margin:8px 0">{last 12 lines of the tail}</pre><p class="muted">Earlier output is in the startup log.</p></section>` — the reason can carry up to 16 KB of stderr whose newlines the `<p>` collapses; the full text is already logged at main.rs:736. |
| medium | inconsistent-icon | Shell | apps/arc-science/web/src/icons.jsx:5 | `<line x1="1" y1="14" x2="7" y2="14"/>…<line x1="17" y1="16" x2="23" y2="16"/>` | Replace the three tick lines with `<line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/>` so the glyph spans x 2..22 like `database` (y 2..22) instead of 1..23; every other glyph sits within 3..21, so `sliders` renders ~1.3 px wider per side at 16 px. Matches Lucide's current `sliders-vertical`; verify upstream. |
| medium | responsive | Shell | apps/arc-science/web/src/styles.css:176 (with main.jsx:55) | `.header-note { display: none; }` | Keep hiding the prose ≤1100 px; on main.jsx:55 add `placeholder="Paste token"` to the operator-token input and shorten the note to "Paste the token from `arc-science token --data ./data` (your project's data folder)." aria-describedby still works while hidden. |
| medium | confusing-locked-state | Shell | apps/arc-science/web/src/main.jsx:55 | `<Button variant="ghost" onPress={()=>setToken('')}>Use operator token</Button>` | Rename to "Use a token instead"; store `const [nativeAvailable,setNativeAvailable]=useState(false)` set true in the status probe (line 40); when `nativeAvailable && token!==NATIVE_SESSION` render `<Button variant="ghost" onPress={()=>setToken(NATIVE_SESSION)}>Use desktop session</Button>` beside the token field. The probe runs once on mount, so today the fallback is one-way until reload. |
| medium | undefined-term | Shell | apps/arc-science/web/src/main.jsx:55 | "Desktop session ready" | "Signed in by the desktop app" |
| medium | error-copy-not-adjacent | Shell | apps/arc-science/web/src/main.jsx:25 | `timer=setTimeout(()=>setNotice(null),12000);` | `if(success)timer=setTimeout(()=>setNotice(null),12000);` — keep "Download failed: … Nothing was saved." on screen until the next download event replaces it. |
| medium | responsive | Shell | apps/arc-science/web/src/styles.css:176 | `.app-body { grid-template-columns: 122px minmax(0,1fr); }` | Drop the 122 px override (keep 150 px; the content column is already minmax(0,1fr)) or add `.workspace-nav .button { padding: 0 8px; }`. Arithmetic: 122 − 24 = 98 px per button; "Diagnostics" at 12 px ≈ 68 + 16 icon + 10 gap = 94 px before HeroUI padding. Inferred, verify in a browser. |
| medium | error-copy-not-adjacent | Shell | apps/arc-science/web/src/http.js:29 | `throw new Error(\`Request failed (${response.status})${detail ? ': ' + detail : ''}\`);` | `const message=\`Request failed (${response.status})${detail?': '+detail:''}\`; throw new Error(response.status===401?message+'. Check the operator token in the header.':message);` — status number stays (App.test.jsx:259). |
| medium | excessive-block | Research, Memory | ResearchWorkspace.jsx:6-7, rendered at :174; apps/arc-science/web/src/MemoryWorkspace.jsx:8 (reused at :9 and :118) | "Run arc-science token --data ./data from this project, or use the token file…" | "Paste an operator token in the header field. To get one, run `arc-science token --data ./data` in the project folder, or open the token file the local service writes." Research appends "Your draft stays in this window."; Memory appends "Your unsent search stays here." Anchors `arc-science token --data ./data` and "token file" kept (ResearchToken.test.jsx:179-180; MemoryWorkspace.test.jsx:131-132). |
| medium | duplicated-caveat | Research, Memory | ResearchWorkspace.jsx:7, :8, :50; apps/arc-science/web/src/MemoryWorkspace.jsx:9, :10, :15 | "Draft text stays in this window. / your unsent text stays here / your draft stays here" | One phrase per surface: Research "Your draft stays in this window."; Memory "your unsent search stays here." |
| medium | unclear-label | Research, Memory, Diagnostics | ResearchWorkspace.jsx:162; apps/arc-science/web/src/MemoryWorkspace.jsx:118; DiagnosticsWorkspace.jsx:186 | "Local unlock required" / "Desktop session unavailable" / "Operator token expired" | "Operator token required" (update anchors ResearchToken.test.jsx:178 and MemoryWorkspace.test.jsx 'Local unlock required'). Memory also: "Desktop session unavailable" → "Desktop sign-in was not accepted"; "Operator token expired" → "Operator token not accepted" (a 403 lands there too). |
| medium | unclear-label | Research, Molecules | ResearchWorkspace.jsx:187 and :192; ResearchWorkspace.jsx:16 and :77; MolecularRenderPanel.jsx:140 | "{row.status} · {row.goal} / {state.status}" (budget_exhausted, needs_input) | `status.replace(/_/g,' ')` before rendering (e.g. "budget exhausted", "needs input"); check and obligation states use `replace(/_/g,' ')` instead of `replace('_',' ')`; Molecules default preset option `'default (' + name.replace(/_/g, ' ') + ')'` to match its siblings. |
| medium | other | Prose, Memory | ProseWorkspace.jsx:91, 104, 113; apps/arc-science/web/src/MemoryWorkspace.jsx:145, :152, :160 | "1 edits · 1 protected spans (number)" / "1 records" / "1 hits" | Pluralise: `${n} ${n === 1 ? 'edit' : 'edits'}`, `${p} protected ${p === 1 ? 'span' : 'spans'}`, `{n} record{n === 1 ? '' : 's'}`, `{n} result{n === 1 ? '' : 's'}`; "{totalRecords} retrievable records" and "total not loaded" when sessions === null instead of the literal 'unknown'. Update ProseWorkspace.test.jsx:98, 114. |
| medium | responsive | Shell, Molecules, BioArt, Prose, Diagnostics, Native startup | apps/arc-science/web/src/styles.css:26; MolecularRenderPanel.jsx:233; MolecularViewer.jsx:196-207; MolecularRenderPanel.jsx:221; BioArtWorkspace.jsx:129; ProseWorkspace.jsx:105, 114, 122, 126; DiagnosticsWorkspace.jsx:186, :192 (CSS overflow-wrap covers only .diagnostics-card p at DiagnosticsWorkspace.css:23-26); launch.rs:294 (STYLE) with launch.rs:394, :416, :430 | 64-character hashes, Windows paths and `arc-science token …` cannot wrap at 700 px | `.download-notice { min-width: 0; overflow-wrap: anywhere; }`; `.receipt-metadata code, .hash, .edits code { overflow-wrap: anywhere; }` (BioArt: `className="hash"` on both `<code>`); `.prose-output { white-space: pre-wrap; overflow-wrap: anywhere; }`; `.unlock-card p, .diagnostics-workspace [role="alert"] { overflow-wrap: anywhere; }`; launch.rs STYLE `main{max-width:720px;margin:12vh auto;padding:0 24px;overflow-wrap:anywhere}`; let `.viewer-controls`, `.figure-toolbar`, `.bioart-control-row` and `.receipt-grid` wrap or stack below 720 px. CSS for Molecules, BioArt and Prose was not read; inferred from markup. |
| medium | contrast-focus | Shell, Research, Settings, Diagnostics | apps/arc-science/web/src/styles.css:22 (also 42, 69, 106, 169, 174, 175); styles.css:30, :42, :106, :174; SettingsWorkspace.css:153-180; DiagnosticsWorkspace.css:53, :75, :89 | `font-size: 10px;` / `font-size: 12px;` on notes that carry facts | `.header-note code { font-size: 11px; }` and an 11 px floor for `dt`, `.stage-footer`, `.field-note`, `footer`, `.receipt-metadata code`, `pre`; `.seat-guidance, .seat-readiness strong, .seat-readiness span { font-size: 12px; }`; 13 px for `.diagnostics-table`, `.diagnostics-kv`, `.diagnostics-advanced`. Colours pass AA (#68727a on #fff ≈ 4.9:1; #8a6d1d on #fffaf0 ≈ 4.7:1; #61717c on #fbfcfd ≈ 4.9:1) but only narrowly at these sizes. Shell reader keeps the 10 px uppercase `.eyebrow` (tracking compensates); Research reader raises it to 11 px. |
| medium | undefined-term | Settings, Diagnostics, Prose | SettingsWorkspace.jsx:214, :215, :220, :341; DiagnosticsWorkspace.jsx:46, :50, :51, :66, :69; ProseWorkspace.jsx:69 | "Seat" | Define at first use per surface. Settings Research Models summary: "A seat is one role backed by one provider and model. Select the provider, model, sign-in method and reasoning effort for each seat." Diagnostics field-note under the 'Operator capabilities' h2: "A seat is one model assigned to a role (planner, reviewer, falsifier, vision)." Prose heading: "Seat rewrite (the AI model chosen in Settings)". |
| medium | undefined-term | Settings, Diagnostics | SettingsWorkspace.jsx:10; DiagnosticsWorkspace.jsx:64 | "Falsifier" | Diagnostics label "Falsifier (tries to disprove results)". Settings Research Models summary adds "Planner plans, Reviewer (QA) checks, Falsifier tries to disprove, Vision reads images, Prose writes." Role meanings inferred from names; confirm with the owner before shipping. |
| medium | excessive-block | Research, Molecules | ResearchWorkspace.jsx:77; MolecularRenderPanel.jsx:222 | "{change.kind} at round {change.round} · declared … · derived … · obligations: …" | Research, one change per block: "{kind}, round {round}" / "Declared effect: {declared} · Server-derived effect: {derived}" / "Required checks: {check state}, …" / muted "{note}". Molecules: "Change of render {id8}…. Declared: {declared or 'nothing'}. Derived by the server: {derived} (changed: {fields}). Required checks: {checks}." |
| medium | unsupported-claim | Research | ResearchWorkspace.jsx:174 | "Offline mode uses scripted roles with real numerical computation." | Show only when mode==='demo': "Offline fixture: the model roles are scripted; the numerical fits are computed for real." When mode==='live': "Live models: nothing is sent until you tick the consent box in Execution settings." |
| medium | unclear-label | Research | ResearchWorkspace.jsx:178 | "Execution … Offline validation fixture … Configured live models" | Label "Model source"; options "Offline fixture (no model calls)" and "Live models set up in the local service". |
| medium | undefined-term | Research | ResearchWorkspace.jsx:192 | "Decision frontier" | "Mission overview" |
| medium | undefined-term | Research | ResearchWorkspace.jsx:197 | "Falsifier: {branch.falsifier}" | "Would be refuted by: {branch.falsifier}" |
| medium | undefined-term | Research | ResearchWorkspace.jsx:60-61 | "Claim scope" | Keep the heading; add beneath it: "For each requested claim: what the evidence supports so far, what is still uncertain, and the next test that would tell the branches apart. Provisionally supported is exploratory, not validation." |
| medium | undefined-term | Research | ResearchWorkspace.jsx:194 | "Export replay capsule" | "Export replay archive (.zip)" — test anchor ResearchToken.test.jsx:122 changes with it. |
| medium | undefined-term | Research | ResearchWorkspace.jsx:193 | "{state.model_calls_used} model-role calls · data: {state.data_origin}" | "Round {round} · {actions} tool actions · {calls} model calls · data source: {origin}" |
| medium | undefined-term | Research | ResearchWorkspace.jsx:179-180 | "Permit sending this mission's data to configured models. / Require configured visual review of each new fit image." | "Permit sending this mission's goal and data to the configured models (the text leaves this machine)." and "Require configured visual review: a vision model checks every new fit plot." (both keep the regex-anchored phrases /Permit sending/ and /Require configured visual review/). |
| medium | undefined-term | Research | ResearchWorkspace.jsx:181 | "8-2000 numeric x/y points. Leave empty for public-source exploration in live mode." | "Paste {"x":[…],"y":[…]} with 8–2000 numeric points. Leave empty and live mode will look for public data instead." |
| medium | unsupported-claim | Research | ResearchWorkspace.jsx:202 and :204 | `state.assessments.slice(-12) … state.events.slice(-15)` | Summaries "Reconciliation (last 12 assessments)" and "Event history (last 15 events)"; test anchors getByText('Reconciliation') / getByText('Event history') need the new text. |
| medium | unclear-label | Research | ResearchWorkspace.jsx:22 vs :26 and :28 | "'not reported' … 'unreported' … {n} verification failures." | "not reported" in both places; "{n} verification {n===1?'failure':'failures'}. Open Verification details before relying on this replay." |
| medium | unclear-label | Research | ResearchWorkspace.jsx:194 and :24 | "Verify and recompute … Replay verification …" | Button "Replay and verify" so it matches the "Replay verification" report and the replay archive (test anchors ResearchToken.test.jsx:38, :77, :133, :214 change). |
| medium | other | Research | ResearchWorkspace.jsx:178 + :146 | `<input id="rounds" type="number" min="1" max="12" …> … max_rounds:Number(rounds)` | Clamp on change `setRounds(Math.min(12, Math.max(1, Number(e.target.value)\|\|1)))`; label "Round limit (1–12)". |
| medium | confusing-locked-state | Research | ResearchWorkspace.jsx:173, :186, :194 | `isDisabled={busy\|\|…}` | While busy render `<p role="status" className="muted">Working…</p>` next to the action row; today the only visible loading text is the artifact's. |
| medium | confusing-locked-state | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:29 | `<Button variant="secondary" isDisabled={busy} onPress={() => onDisable(record.record_id)}>Remove from retrieval</Button>` | Pass locked into RecordCard and use `isDisabled={busy \|\| locked}`, matching Search, Load sessions, Previous/Next and Load record range. |
| medium | unsupported-claim | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:128 | "Semantic and hybrid retrieval are unavailable without a configured embedder. Lexical search matches keywords." | Render only after health is loaded: "Semantic and hybrid search need an embedding model; none is reported as configured. Keyword search is available." |
| medium | duplicated-caveat | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:124–128 | "Semantic (unavailable) … Available retrieval: lexical. … unavailable without a configured embedder." | Keep the option suffixes and one note. :127 → "Search modes available: {availableModes.join(', ') \|\| 'none'}." shown only when health is loaded; drop :128 when :127 is shown, or vice versa (update test :30/:32). |
| medium | duplicated-caveat | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:182 | "This range could not be loaded. Adjust the record range and retry." | "No records loaded for this range." (the real cause is already in the alert at :149; "adjust the range" is wrong advice on auth expiry or offline). |
| medium | unsupported-claim | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:184 | "No sessions loaded." | "No session selected. Open a session or run a search." |
| medium | undefined-term | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:159 | "Captured trajectory" | "Captured records" |
| medium | undefined-term | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:157 | "No matching memory. Abstention is a valid answer." | "No matching memory. Returning nothing is a valid answer." |
| medium | undefined-term | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:121–125 | "Retrieval … Lexical (keyword) … Semantic … Hybrid" | Label "Search mode"; options "Keyword (lexical)", "Semantic (by meaning)", "Hybrid (keyword + meaning)", each with " – unavailable" when disabled. |
| medium | other | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:155 | `<p>{(hit.record.text \|\| '').slice(0, 400)}</p>` | `{text.slice(0, 400)}{text.length > 400 ? '…' : ''}` plus the same Show full text / Show less control used by RecordCard. |
| medium | confusing-locked-state | Molecules | MolecularRenderPanel.jsx:154 | `isDisabled={busy\|\|!token\|\|!capabilities?.configured\|\|!file\|\|!antibody.trim()\|\|!antigen.trim()\|\|pending(job?.status)}` | Beneath the button while it is disabled: "Needs a loaded renderer, a coordinate file, antibody and antigen chains, and no render in progress." |
| medium | confusing-locked-state | Molecules | MolecularRenderPanel.jsx:133-136 | `<fieldset disabled={busy\|\|!capabilities?.configured}>` | First line inside the fieldset: "Unlocks once Load renders reports the local renderer is configured." |
| medium | contrast-focus | Molecules | MolecularRenderPanel.jsx:223 | `<p className="muted">Rendering does not establish scientific validity` | Render as a normal paragraph (drop the muted class; CSS not read, judged by class name): "A render does not establish scientific validity, visual acceptance or publication approval. The surface is a Gaussian envelope around the atoms, not a measured surface; dashed lines show proximity only, not hydrogen bonds or affinity." |
| medium | unclear-label | Molecules | MolecularRenderPanel.jsx:149 | "(same coordinates; the earlier render is kept)" | "Render as a declared change of {id8}… — same coordinates (choose the same file again); the earlier render is kept" |
| medium | undefined-term | Molecules | MolecularViewer.jsx:162-163 | "contact residues from the provisional scene highlighted; coordinates unchanged" | "Loaded {n} atoms. {k} contact residues highlighted from provisional contacts (render still running); coordinates unchanged." / "…from verified contacts (render complete); coordinates unchanged." / "Loaded {n} atoms. No contacts in the provisional\|verified set; coordinates unchanged." |
| medium | excessive-block | Molecules | MolecularRenderPanel.jsx:143 | "Panel background, finish and colours are presentation; envelope and stick presets also change the drawn mesh…" | "Presets change the panel background, finish and colours (presentation). Envelope and stick presets also change the drawn mesh (scientific depiction). No preset changes the coordinates or the contacts." |
| medium | excessive-block | Molecules | MolecularRenderPanel.jsx:151 | "Declare every effect the new settings have; the server derives the actual effects and refuses a declaration…" | "Tick every effect the new settings have. The server derives the actual effects and refuses the render if your declaration is narrower." |
| medium | unclear-label | Molecules | MolecularViewer.jsx:201 | `<label>Assembly<input aria-label="Assembly"` | "Viewer assembly (press Enter to apply)" — commit the value on Enter/blur instead of every keystroke (render() re-parses the structure on each change of settings.assembly, :138, :169); removes the duplicate accessible name with MolecularRenderPanel.jsx:144. |
| medium | undefined-term | Molecules | MolecularRenderPanel.jsx:136 | "Author chain IDs, separated by commas." | "Chain IDs as written in the file (author IDs), separated by commas." |
| medium | undefined-term | Molecules | MolecularRenderPanel.jsx:106 | "Enter 1–16 author chains for each partner." | "Enter 1–16 chain IDs for the antibody and 1–16 for the antigen." |
| medium | unsupported-claim | BioArt | BioArtWorkspace.jsx:102, :104 | "Search NIH BioArt … NIH’s live search currently requires browser rendering." | Button "Search cached BioArt". Note L104: "NIH’s live search needs browser rendering, which this app cannot do. Open NIH search to find an entry ID, then enter it below." (tests L88, L106, L127, L147, L150 pin the old button name; the L110 regex still matches the new note). |
| medium | duplicated-caveat | BioArt | BioArtWorkspace.jsx:130, :135 | "Rights metadata has not been independently verified. … / Reuse rights are not inferred…" | One caveat at L130: "Reuse rights are recorded from the NIH entry, not independently verified. Review the NIH entry and the retained credit before publication." Delete the footer at L135 (it also renders when no entry is selected). |
| medium | duplicated-caveat | BioArt | BioArtWorkspace.jsx:99, :103 | "Recorded metadata first; a live NIH request only with consent. … Consent covers one action. Cache hits stay offline." | L99: "Find NIH BioArt illustrations from the local cache, or from NIH with your consent." L103: "Consent covers one search or inspection, then clears. Entries already in the local cache never contact NIH." |
| medium | undefined-term | BioArt | BioArtWorkspace.jsx:115, :120, :126 | "group ${receipt.representation_id} / Representation / Available source variants / Group {item.group_id}" | "variant" everywhere: chip `Verified ${receipt.format} · variant ${receipt.representation_id}`; label "Variant"; list line `Variant {item.group_id} · {formats}`; note L123 "Automatic picks a variant labelled grey, grayscale, or black-and-white that has this format." |
| medium | undefined-term | BioArt | BioArtWorkspace.jsx:120 | "Automatic · neutral compatible {format}" | `Automatic · grey or black-and-white variant with {format}` |
| medium | undefined-term | BioArt | BioArtWorkspace.jsx:127-129 | "Receipt verified … <dt>Receipt</dt>" | aria-label "Verified fetch record"; h2 "File fetched and verified"; dt "Receipt ID"; "Source SHA-256" → "File SHA-256"; "Source page SHA-256" → "NIH page SHA-256". |
| medium | confusing-locked-state | BioArt | BioArtWorkspace.jsx:79, :93, :122 | `setFormat('SVG') … isDisabled={busy\|\|!formats.includes(format)}` | In inspect(): `setFormat(formatOrder.find(f=>data.representations.some(i=>f in i.files))\|\|'SVG')`. After the Format select: `{formats.length===0&&<p className="field-note">This entry lists no downloadable files.</p>}`. Otherwise an entry without SVG shows a mismatched select and a disabled "Fetch verified SVG" with no reason. |
| medium | confusing-locked-state | BioArt | BioArtWorkspace.jsx:130-131 | `{receipt.limitation&&<p>{receipt.limitation}</p>} … \`${receipt.format} import unavailable\`` | Label `Import unavailable · ${receipt.format==='SVG'?'this SVG is not supported':'SVG only'}`; move `{receipt.limitation&&<p className="field-note">{receipt.limitation}</p>}` to immediately after the actions div so the reason sits next to the disabled button. |
| medium | unclear-label | BioArt | BioArtWorkspace.jsx:98 | "Source vectors." | "NIH BioArt illustrations." |
| medium | undefined-term | BioArt | BioArtWorkspace.jsx:25, :40-41 | "'an operator-supplied browser snapshot' / 'BioArt schema drift: required metadata missing or inconsistent'" | L25 substitution → "a browser page snapshot, which this app cannot provide; use Open NIH search and inspect by entry ID". Before L40: `if(/schema drift/i.test(status.detail)) return 'NIH returned metadata in an unexpected shape, so this entry could not be read. Try again later or inspect it by entry ID.'` (test L107 pins 'BioArt schema drift'; update it). |
| medium | unclear-label | BioArt | BioArtWorkspace.jsx:115 | "NIH metadata: {entry.license}" | `License per NIH: {entry.license}` |
| medium | undefined-term | Prose | ProseWorkspace.jsx:104 | "(identity requested-only)" | "(the provider did not report which model answered)" |
| medium | undefined-term | Prose | ProseWorkspace.jsx:104 | "· behaviour sent in the prompt (no system channel)" | "The behaviour text was sent inside the message; this seat takes no separate system instructions." |
| medium | excessive-block | Prose | ProseWorkspace.jsx:104 | "Edited by the prose seat · 2 protected spans preserved · anthropic claude-sonnet-5 (observed …) · behaviour sent…" | h3 "Edited by the prose seat · 2 protected spans preserved". Muted line below the pre: "Model: anthropic claude-sonnet-5 — the provider confirmed claude-sonnet-5." or "… — the provider did not report which model answered." plus, when instruction_channel === 'prompt', "The behaviour text was sent inside the message; this seat takes no separate system instructions." (update ProseWorkspace.test.jsx:64, 98) |
| medium | undefined-term | Prose | ProseWorkspace.jsx:70 | "Sends the text to the prose seat configured in Settings and asks for its edit under the humane-prose behaviour;…" | "Sends the text to the AI model chosen in Settings (the ‘prose seat’). The seat edits under fixed instructions, the humane-prose behaviour (‘Show the behaviour’ below). If any protected span does not come back byte for byte, nothing is returned." |
| medium | confusing-locked-state | Prose | ProseWorkspace.jsx:82 | `isDisabled={busy \|\| !token \|\| !consent \|\| text.length < 20}` | `isDisabled={busy \|\| !token \|\| !consent \|\| text.trim().length < (detection?.bounds.min_chars ?? 20)}`; append to the enabled-branch note at :80: " Detect needs at least ${detection.bounds.min_chars} characters." |
| medium | confusing-locked-state | Prose | ProseWorkspace.jsx:80-81 | "Load the rules to see where the text would be sent." | "Load the rules (‘Show rules and detection terms’, above) to see where the text would be sent; consent unlocks once they are loaded." |
| medium | other | Prose | ProseWorkspace.jsx:42, 46, 112, 119 | `setRewritten(await read('/rewrite', signal, 'POST', {text}))` | Bind these results to their text like the other two: `setRewritten({...result, source: text})`, `setReceipt({...result, source: text})`; render `<p role="status">The text changed since this rewrite; it applies to the earlier text.</p>` when rewritten.source !== text, and `<p role="status">The text changed since this detection; the receipt (SHA-256 above) applies to the earlier text.</p>` when receipt.source !== text. |
| medium | unsupported-claim | Prose | ProseWorkspace.jsx:60 | "leaves numbers, identifiers, citations, units and code untouched" | "Rewrite and diagnose run on this machine. The seat rewrite and third-party detection send the text elsewhere and ask for consent every time. No rewrite changes protected spans (numbers, identifiers, citations, units, code; ‘Show rules’ lists the exact classes)." |
| medium | error-copy-not-adjacent | Settings | SettingsWorkspace.jsx:205 vs :216 | "Resolve these before saving." | Under the Save button: "Save is off until the seat issues under Research Models are fixed." / "Read only: the supervisor cannot write this file." |
| medium | unsupported-claim | Settings | SettingsWorkspace.jsx:62 | "Settings validation failed. Fix the highlighted values and retry." | "Settings were not saved. The supervisor rejected them; see the reason above, fix it and save again." (nothing is highlighted on a 422; only local seat checks set aria-invalid) |
| medium | unsupported-claim | Settings | SettingsWorkspace.jsx:344 | "A probe proves reachability and selector handling, and identity only where the CLI reports it." | "Signed in only means a session exists. A probe makes one real call to show that the model and effort are accepted; the answering model is confirmed only when the CLI reports it." |
| medium | undefined-term | Settings | SettingsWorkspace.jsx:128 | "Last probe reported at least one failed selector." | "probe failed — Last probe failed for at least one model/effort pair." \| "probe ok — Last probe reached the configured model at the configured effort." |
| medium | undefined-term | Settings | SettingsWorkspace.jsx:332, :336 | "no: requested-only" | Column "Reports answering model"; cells "yes" \| "no (only the requested model is known)". |
| medium | undefined-term | Settings | SettingsWorkspace.jsx:264 | "Only a server with consent is offered to missions, every call still needs mission egress consent, and results are untrusted content." | "Missions see only the servers you have consented to. Every call still asks the mission's consent before data leaves this machine. Results are untrusted content." |
| medium | unclear-label | Settings | SettingsWorkspace.jsx:297 | "Third-party AI detection may run after request-level consent." | "Allow third-party AI-text detection. Arc asks again before each request, and the text leaves this machine only when you agree." (test :105 asserts the current label) |
| medium | unclear-label | Settings | SettingsWorkspace.jsx:110 (via :101) | "Planner: Supported here: minimal, low, medium, high." | "Planner: effort max is not accepted for Gemini API. Accepted: minimal, low, medium, high." (template: `label + ': effort ' + seat.effort + ' is not accepted for ' + providerLabel + ' ' + (cli ? 'CLI login' : 'API') + '. Accepted: ' + levels + '.'`; test :120 asserts the current text) |
| medium | undefined-term | Settings | SettingsWorkspace.jsx:182 | "Saved. Applied live: ... Stored for later loops: ... Restart required for ..." | `'Saved.' + (applied ? ' Applied now: {list}.' : '') + (pending ? ' Takes effect on the next run: {list}.' : '') + (restart ? ' Restart Arc Science to apply: {list}.' : '')` — omit empty parts instead of printing 'none'. |
| medium | confusing-locked-state | Settings | SettingsWorkspace.jsx:248 | `placeholder={role}` | `placeholder = seat.auth === 'api_key' ? 'file name' : 'not used with CLI login'` |
| medium | responsive | Settings | SettingsWorkspace.css:145-147, :194-196 | `.settings-table { min-width: 940px; }` | `.settings-table{min-width:640px}` plus `.settings-table th[scope=row]{position:sticky;left:0;background:#fff}`; below 900 px move the Readiness cell under the Seat cell. At 700 px every table scrolls sideways and Readiness is off-screen. |
| medium | duplicated-caveat | Settings | SettingsWorkspace.jsx:209-210 | `{error && <StateCard state={error}/>} {error && <p role="alert">{error.alert}</p>}` | Keep the card; give the `<p role="alert">` a visually-hidden class so it is announced but not shown twice. |
| medium | unclear-label | Settings | SettingsWorkspace.jsx:256 | "Load settings to inspect live connection state." | "Connection state did not load. Press Reload to retry." (only reachable when settings did load but the connection request failed) |
| medium | undefined-term | Settings | SettingsWorkspace.jsx:259, :267 | "List MCP tools" | Button "Check MCP servers" (tests :97, :158 assert the old label). Note under both check buttons: "Starts each enabled entry, asks it to describe itself, and sends no mission data." |
| medium | duplicated-caveat | Diagnostics | DiagnosticsWorkspace.jsx:7 (alert :192 and card :198 via :143) | "Arc Science service is offline or unreachable. Start the local service, then refresh diagnostics." | Alert: "Arc Science service is offline or unreachable. Start the local service, then select Refresh service." Card (:143 error value): "Offline or unreachable." |
| medium | duplicated-caveat | Diagnostics | DiagnosticsWorkspace.jsx:185, :208, :211, :79 | "Public service status is separate from authenticated operator checks." | Keep :211 verbatim (test :50) and :79; :185 → "Service status is public. Operator checks need a token."; :208 → "This public check does not prove scientific validity, model reachability, worker health, MCP or ACP." |
| medium | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:72, :76, :89, :105 | "consented" | Keep the consent term; define once under the h2: "Consented = connectors you approved to run." Do not replace with 'enabled' or 'active'. |
| medium | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:6 | "paste it in the shared header" | "paste it in the shared header token field" (substring still matches test :43). |
| medium | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:13, :22 | "Check the project settings service, then retry." | "Connection checks are unavailable in this local service (settings are not available to it). Start or repair the settings service, then retry." — one constant for :13 and :22. |
| medium | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:179 | "At least one authenticated diagnostic route is unavailable in this service." | "At least one authenticated check is unavailable in this service; see the red card." (update test :143) |
| medium | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:191 | "Diagnostics request in progress…" | `busy === 'capabilities' ? "Loading capabilities…" : busy === 'mcp' ? "Checking MCP servers…" : "Checking ACP agents…"` |
| medium | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:204 | "Advanced" | "Version and limits" |
| medium | other | Diagnostics | DiagnosticsWorkspace.jsx:46 | "Not checked. Load operator capabilities to read configured seats and connectors." | Render the h2 "Operator capabilities" in the null state too, with: "Not checked. Load operator capabilities (button on the left) to see which model seats — planner, reviewer, falsifier, vision — and connectors are configured." (keeps test :76 substring) |
| medium | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:47-53 | `<StatusCard title="Model seats" state={stateFor(capabilities, null)}>` | A 503/401 on the whole capabilities call is displayed under 'Model seats'. Title the failure-branch card "Operator capabilities" and update test :125-126 to card('Operator capabilities'). |
| medium | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:13 (fires for Load capabilities too) | "Connection checks are unavailable in this local service." | Capabilities path: "Capabilities are unavailable in this local service (settings are not available to it). Start or repair the settings service, then retry."; keep the 'Connection checks…' text for MCP/ACP (test :138). |
| medium | unsupported-claim | Native startup | main.rs:91 with launch.rs:331-336, main.rs:500, main.rs:615 | "Elapsed 75 seconds. 60 seconds per-step configuration timeout." | "{n} seconds since launch. Each setup step is allowed 60 seconds." during configuration and "{n} seconds since launch. The service is allowed {t} seconds to answer." during service start — elapsed is counted from window open while each timeout applies to one supervisor step (up to four) or to the service start alone, so elapsed can exceed the timeout while nothing has failed. |
| medium | undefined-term | Native startup | main.rs:498, main.rs:508, main.rs:589 | "Configuring native workspace" | "Preparing the workspace" (log line "Startup: preparing the workspace") |
| medium | unclear-label | Native startup | launch.rs:374 | "A readiness check failed; starting anyway so the reason is visible." | "A startup check failed (marked below). Arc Science will still try to start so the service can show the error." |
| medium | undefined-term | Native startup | launch.rs:415-419 | "Configuration: <code>{toml}</code>. Edit it or delete it to discover the runtime again. Supervisor: …" | "Configuration file: <code>{toml}</code>. Delete it and Arc Science will look for Python and its components again on the next start, or edit it by hand. Startup helper: <code>{exe}</code>." |
| medium | undefined-term | Native startup | launch.rs:411 and launch.rs:430 | "Open redacted startup log / Startup log: <code>{path}</code>" | Button: "Open startup log". Path line: "Startup log (secrets removed): <code>{path}</code>" — keeps the redaction fact next to the file. |
| medium | duplicated-caveat | Native startup | launch.rs:463 and main.rs:742-745 | `let (text, caption) = (wide(reason), wide("Arc Science could not start"));` | Dialog body: "{first line of reason}\n\nRetry and the startup log are in the Arc Science window." — the modal repeats the whole reason shown behind it and blocks Retry / Open log until dismissed; the full reason stays on the page and in the log. |
| medium | unsupported-claim | Native startup | README.md:17-19 versus launch.rs:164, launch.rs:203-207, launch.rs:423 | "Text shown from the supervisor's stderr passes through a redaction pass…" | launch.rs:164: `crate::startup::redact(err.trim().lines().last().unwrap_or("no detail").trim())` and launch.rs:205: `.map(\|l\| crate::startup::redact(l.trim_start_matches("discovery: ")))` — the last stderr line of a failed supervisor step and the init notes reach the page and dialog unredacted today; only the service-start tail (startup.rs:423) and the log file (main.rs:350) are redacted. |
| medium | other | Native startup | main.rs:682-687 and main.rs:688-696 | `webview.load_html(&launch::starting_page_with_progress(startup_plan.as_ref(), &progress))` | On StartupTick keep the document and run `webview.evaluate_script(&format!("document.querySelector('.startup-status p.muted').textContent={}", js_string(Some(&status_line))))` — rebuilding the whole page every second resets keyboard focus, text selection and the screen-reader reading position. |
| low | contrast-focus | Shell, Settings, Native startup | apps/arc-science/web/src/styles.css:16; SettingsWorkspace.css:95-119; launch.rs:294 (STYLE) | `button:focus-visible, … { outline: 2px solid #315d7c; }` (0,1,1) vs HeroUI `.button:focus-visible`; no summary rule; `.button-link` relies on the WebView2 default ring | `.button:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); }`; `.settings-section > summary:focus-visible { outline: 2px solid #315d7c; outline-offset: 2px; }`; `.button-link:focus-visible{outline:2px solid #17212d;outline-offset:2px}`. Text contrast passes throughout (#315d7c on #fff ≈ 7.0:1, on #eaf0f4 ≈ 6.1:1; #a23d3d on #fbeeee ≈ 5.7:1; #5b6875/#fff ≈ 5.7:1; #bb3e03/#fff ≈ 5.5:1; #243542/#eef3f6 ≈ 11:1); @heroui/styles overriding the ring cannot be confirmed from these files. |
| low | unclear-label | Research, Molecules, BioArt | ResearchWorkspace.jsx:44; MolecularRenderPanel.jsx:229; BioArtWorkspace.jsx:59 | "Download authenticated PNG / Loading authenticated artifact… / Loading authenticated collage… / Loading the authenticated preview…" | "Download PNG" / "Loading image…" / "Loading preview…" / "Loading preview…" — 'authenticated' is an implementation detail; 'collage' undefined. |
| low | other | BioArt, Molecules | BioArtWorkspace.jsx:98, :115; MolecularRenderPanel.jsx:160, :230 | `<h1>Source vectors.</h1> … <h1>{entry.title}</h1>` / `<h2>Recent renders</h2> … <h2>Artifacts & provenance</h2>` | Entry title as `<h2>` (tests locate it by heading name, not level); `<h3>` for Recent renders and Output files & provenance (they sit under the h2 "Render locally" and the h2 filename). |
| low | inconsistent-icon | Settings, Diagnostics | SettingsWorkspace.jsx:36, :42, :48, :54, :60, :66, :72; DiagnosticsWorkspace.jsx:184 vs :195 | "Unlock Settings" / "DIAGNOSTICS" | Sentence case for all card titles: "Unlock settings", "Session expired", "Settings file not configured", "Settings changed elsewhere", "Settings were rejected", "Service unreachable", "Request failed"; eyebrow "Diagnostics" (the other eyebrow "Local service" is sentence case; let CSS handle uppercase). |
| low | excessive-block | Shell | apps/arc-science/web/src/http.js:28 | `detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail \|\| '');` | `detail = Array.isArray(data.detail) ? data.detail.map(d => (d && d.msg) ? d.msg : JSON.stringify(d)).join('; ') : typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail \|\| '');` — FastAPI-style validation arrays otherwise dump raw JSON into the visible error. |
| low | undefined-term | Shell | apps/arc-science/web/src/http.js:40 | "Operator token is required for protected requests." | "Operator token is missing. Paste it in the header first." |
| low | unclear-label | Shell | apps/arc-science/web/src/main.jsx:56 | `<p className="eyebrow">MAIN</p>` | `<p className="eyebrow">WORKSPACES</p>` — matches the nav's aria-label "Workspaces" so sighted and screen-reader users hear the same group name. |
| low | other | Shell | apps/arc-science/web/src/main.jsx:55 | `<div className="native-session" role="status">Desktop session ready <Button` | `<div className="native-session"><span role="status">Signed in by the desktop app</span> <Button …>` — keeps the interactive button out of the live region. |
| low | other | Shell | apps/arc-science/web/src/styles.css:25 (also 176, 177) | `.app-header>a { font-size: 11px; color: #68727a; }` | Delete this rule and the two media-query fragments `.app-header>a { margin-left: auto; }` (line 176) and `.app-header>a { display: none; }` (line 177): main.jsx renders no `<a>` in the header. |
| low | other | Shell | apps/arc-science/web/src/styles.css:177 vs 195-198 | `.nav-utility .button { flex: 1 1 112px; color: #4d5962; font-size: 11px; font-weight: 500; background: #fff; }` | Merge the two `@media(max-width:760px)` blocks into one: keep `flex: 0 0 auto; min-height: 30px; padding: 4px 12px; background: transparent;` and `.nav-utility { align-items: center; gap: 4px; }` from lines 196-197; delete the overridden `flex: 1 1 112px`, `background: #fff` and `align-items: stretch` from line 177. |
| low | other | Shell | apps/arc-science/web/src/styles.css:27 | `.download-notice.alert { color: #a23d3d; background: #fbeeee; border-color: #efd3d3; padding: 5px 10px; }` | Remove `padding: 5px 10px;` here; line 26 already sets it. |
| low | other | Shell | apps/arc-science/web/src/styles.css:4 | `:root { … --accent: #315d7c; --accent-foreground: #fff; }` | Add `--border: #e4e7e9; --border-soft: #edf0f2; --text-muted: #4d5962; --text-faint: #68727a;` and replace the hard-coded greys: three near-identical borders (#e4e7e9, #e9ebed, #edf0f2) collapse to two tokens, four muted text greys (#4d5962, #3d4b55, #61717c, #68727a) collapse to two. |
| low | other | Shell | apps/arc-science/web/src/styles.css:11 and 19 | `h1 { font-size: 20px; line-height: 1.4; font-weight: 550; … } .brand { font-size: 18px; font-weight: 650; … }` | Use 600 and 700 unless Inter is bundled as a variable font (no @font-face or `<link>` appears in styles.css; index.html not read); on the `ui-sans-serif, system-ui` fallbacks 550/650 snap to 500/600 or 600/700 depending on the OS. |
| low | other | Shell | apps/arc-science/web/src/styles.css:29 | `.workspace-nav { background: #f8f9fa; border-right: 1px solid #e4e7e9; padding: 25px 12px; …` | `padding: 24px 12px;` — the rest of the shell uses 24 px (header) and 28/32 px (workspaces); 22/26 px in the research composer (lines 77, 91) could likewise round to 24. |
| low | responsive | Research | styles.css:75-76 | `.research-workspace { display: grid; grid-template-columns: 340px minmax(0,1fr); } .guided-research { display: flex; flex-direction: column; … }` | Delete the .research-workspace grid rule (and its 1100 px override at :176); the same element carries .guided-research, which overrides it, so the 340 px column never applies. |
| low | responsive | Research | styles.css:120-122 with ResearchWorkspace.jsx:192 | `.results-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; }` | Add `flex-wrap: wrap` and `overflow-wrap: anywhere` on the eyebrow so a long mission id and the status label do not collide at 700 px. |
| low | responsive | Research | styles.css:42 and :129 | `dt { color: #4d5962; font-size: 10px; margin: 17px 0 4px; } … .claim dt { font-weight: 600; }` | `.claim dt { font-weight: 600; font-size: 12px; margin: 0; color: inherit; }` so claim-scope labels line up with their values in the 11rem/1fr grid instead of sitting 17 px lower at 10 px. |
| low | confusing-locked-state | Research | ResearchWorkspace.jsx:177 | `<summary>Execution settings</summary>` | Summary shows current state: "Execution settings · offline fixture · nothing leaves this machine" / "… · live models · data may leave this machine". |
| low | unclear-label | Research | ResearchWorkspace.jsx:166 | "RESEARCH / DEVELOPMENT" | "RESEARCH" (if it marks build stage, say "Development build" in the app header instead) |
| low | unclear-label | Research | ResearchWorkspace.jsx:187 | "Load missions with your operator token." | "Press Load missions to list your saved missions." |
| low | duplicated-caveat | Research | ResearchWorkspace.jsx:15, :27, :61 | "not validated / Scientific validity is not established by replay verification / never validation" | Keep all three (they qualify different things) but align the wording: :15 "Eligible means ready for a human reviewer; it is not validation."; :27 stays verbatim (test anchor /Scientific validity is not established/); :61 "Provisionally supported is exploratory, not validation." |
| low | duplicated-caveat | Research | ResearchWorkspace.jsx:44 | "Check your token, then retry or select the mission again." | "Retry, or select the mission again." (token advice already sits inside the alert on 401/403) |
| low | undefined-term | Research | ResearchWorkspace.jsx:44 and :84 | "preset {artifact.preset\|\|'default'} … · preset {cycle.preset}" | "render preset: {preset}" |
| low | undefined-term | Research | ResearchWorkspace.jsx:194 | "Resume (declares an analysis change)" | "Resume (recorded as an analysis change)" |
| low | unclear-label | Research | ResearchWorkspace.jsx:195 | `<p role="status">{state.stop_reason}</p>` | "Stop reason: {state.stop_reason}" |
| low | unclear-label | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:140 | "Refresh sessions to check recovery." | "Select Load sessions again to check whether capture recovered." (there is no Refresh sessions control) |
| low | undefined-term | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:25, :28, :137, :138, :145, :154, :156 | "epoch {record.compaction_epoch} · #{record.seq} / {record.trust} · {source_uri} · {digest}… / Worker {protocol} / Capture: {status} · {pending} pending / {reason} · {score}" | Label each value: "seq {seq} · compaction epoch {epoch}", "trust {trust} · source {source_uri \|\| 'none'} · digest {digest}…", "Memory service {protocol}", "Session capture: {status} · {pending} records waiting to be written", "{session_id} · {n} record{s} · compaction epochs {min}–{max}", "matched by {reason} · score {score}". |
| low | error-copy-not-adjacent | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:139 | `{health.capture.last_error && <p>{health.capture.last_error}</p>}` | "Last capture error: {health.capture.last_error}" |
| low | undefined-term | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:177 | "Narrow the range if a page exceeds the read limit." | "If the service reports the page exceeds its read budget, narrow the range." (the server says 'read budget'; its detail text is surfaced verbatim) |
| low | dead-control | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:90 | "This retrieval mode is unavailable. Select an available mode." | Unreachable via the UI (Search is disabled under the same test at :134). Keep as a guard with text "Search mode unavailable. Choose one of the available modes." |
| low | confusing-locked-state | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:131, :134 | `<option value="selected" disabled={!session}>Selected session{session ? ': ' + session : ''}</option>` | `Selected session{session ? ': ' + session : ' (open a session first)'}` |
| low | dead-control | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:111 | `setTimeout(() => document.getElementById('operator-token')?.focus(), 0);` | If the element is missing, set the alert: "Token field not found. Open the header to enter an operator token." |
| low | unclear-label | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:27 | `{open ? 'Collapse' : 'Expand'}` | "Show full text" / "Show less" with aria-label `Show full text of record {record.seq}` / `Show less of record {record.seq}`; Remove from retrieval gets aria-label `Remove record {record.seq} from retrieval`. |
| low | responsive | Memory | apps/arc-science/web/src/MemoryWorkspace.jsx:118, :131, :145, :172–176 | "{s.session_id} · {s.record_count} records · epochs {s.min_epoch}–{s.max_epoch}" | At 700 px (stylesheet not read, unverified): allow the session button label and the unlock-card command to wrap (word-break for `arc-science token --data ./data`), keep the session id out of the `<option>` text ('Selected session' only; the id is in the eyebrow at :159), and let .formrow stack the two number inputs. |
| low | excessive-block | Molecules | MolecularRenderPanel.jsx:162 | "with what a probe observed: presence, never qualification; nothing is installed." | "Structural-biology and cheminformatics software the workbench knows about, and what a probe observed. Presence only, not whether a package works. Nothing is installed." |
| low | unsupported-claim | Molecules | MolecularRenderPanel.jsx:124 | "Local renderer ready." | "Local renderer configured." (capabilities.configured is a configuration flag) |
| low | unclear-label | Molecules | MolecularRenderPanel.jsx:124 | "Load with your operator token." | "Enter your operator token, then choose Load renders." |
| low | undefined-term | Molecules | MolecularRenderPanel.jsx:159 | `(live?'live':'polling')+' · '` | "live updates · " / "checking every 1.5 s · " (poll interval :71, :76) |
| low | undefined-term | Molecules | MolecularRenderPanel.jsx:145 | "Use asymmetric_unit or an assembly ID recorded in the source." | "Use asymmetric_unit (no symmetry operators applied) or an assembly ID listed in the file." |
| low | duplicated-caveat | Molecules | MolecularRenderPanel.jsx:131 | "rendered only with the local pipeline" | "PDB or mmCIF, up to {N} bytes. Shown in the viewer at once; rendered only by the local pipeline." ('local' already appears at :71, :124, :181, :221, :234; the locality commitment stays) |
| low | undefined-term | Molecules | MolecularRenderPanel.jsx:226, :230, :233 | "No completed artifacts are available. / Artifacts & provenance / Artifact hashes" | "No output files are available." / "Output files & provenance" / "File hashes (SHA-256)" |
| low | dead-control | Molecules | MolecularRenderPanel.jsx:158 | `<Button variant="ghost" onPress={()=>onShowJob(true)}>View selected render</Button>` | Hide the button while the details are open (showRender true); otherwise it does nothing. |
| low | error-copy-not-adjacent | Molecules | MolecularRenderPanel.jsx:129 | `if(chosen&&chosen.size<=(capabilities?.limits.max_source_bytes\|\|750000)){…}` | Next to the file input when the chosen file is too large: "This file is {size} bytes; the limit is {N} bytes." / "Choose a .cif, .mmcif or .pdb file." — today an oversize file gives no feedback until Render structure is pressed. |
| low | unclear-label | Molecules | MolecularWorkspace.jsx:67 | `stageLine(renderJob) \|\| renderJob.status` | `stageLine(renderJob) \|\| 'render ' + renderJob.status` (viewer line then reads "… · render queued" instead of "· queued"); STAGE_LABELS fallback at MolecularRenderPanel.jsx:32: `s.stage.replace(/_/g, ' ')`. |
| low | unclear-label | Molecules | MolecularViewer.jsx:202-206 | "contacts / waters / spin / Save view" | "Show contacts / Show waters / Spin / Save view as PNG" |
| low | unclear-label | Molecules | MolecularViewer.jsx:15 | "bfactor" | Option text "B-factor" (keep key bfactor). |
| low | unclear-label | Molecules | MolecularRenderPanel.jsx:221 | "Close render" | "Close details" (the job keeps running) |
| low | unclear-label | Molecules | MolecularRenderPanel.jsx:168 | "Probe again" | "Check again"; while softwareBusy show `<p role="status">Checking packages…</p>` inside Packages. |
| low | other | Molecules | MolecularRenderPanel.jsx:159, :169; MolecularViewer.jsx:194 | `<p className="field-note" aria-label="Render progress"> / <div className="software-report" aria-label="Software catalogue"> / <div className="viewer" aria-label="Molecular viewer">` | aria-label on p/div without a role is not reliably exposed; add `role="status"` to the progress p and `role="group"` to the two divs. |
| low | undefined-term | Molecules | MolecularRenderPanel.jsx:9 | "Samples / Seed" | "Render samples / Random seed" |
| low | unclear-label | Molecules | MolecularRenderPanel.jsx:12 | "Invalid molecular artifact address." | "This file is not served by the local molecular API." |
| low | unsupported-claim | BioArt | BioArtWorkspace.jsx:122 | "Fetch verified {format}" | `Fetch and verify {format}` (nothing is verified until the fetch completes) |
| low | inconsistent-icon | BioArt | BioArtWorkspace.jsx:104, :107, :115 | "Open NIH search / Inspect entry / Open NIH source ↗" | "Open NIH search ↗" (both external links carry the arrow; test L99 uses the exact name) and give Inspect entry an icon like its sibling buttons, or remove icons from all secondary buttons. |
| low | undefined-term | BioArt | BioArtWorkspace.jsx:110 | "No matching entries in the returned metadata." | "No entries match this query in the cached metadata." (test L111 asserts the old text is absent; update it) |
| low | excessive-block | BioArt | BioArtWorkspace.jsx:123 | "Automatic selection prefers an explicitly grey, grayscale, or black-and-white representation…" | "Automatic picks a variant labelled grey, grayscale, or black-and-white that has this format." |
| low | unclear-label | BioArt | BioArtWorkspace.jsx:106 | "Enter the positive whole-number ID. For BIOART-000018, enter 18." | "Enter only the number. For BIOART-000018, enter 18." |
| low | unclear-label | BioArt | BioArtWorkspace.jsx:37 | "No cached BioArt source is available yet. Permit NIH network access for the next search or inspection, then try again." | `No cached BioArt ${recovery==='fetch'?'file':'metadata'} is available yet. Permit NIH network access for ${target}, then try again. Consent is used once and clears after the request.` (test L129 pins 'source'; update it) |
| low | dead-control | BioArt | BioArtWorkspace.jsx:62, :110 | `export default function BioArtWorkspace({token,setToken}) … <Button className="bioart-result" … isDisabled={busy}` | setToken is accepted and never used (drop the prop or use it for an inline unlock field); result rows `isDisabled={busy\|\|!token}` to match Search/Inspect gating. |
| low | error-copy-not-adjacent | BioArt | BioArtWorkspace.jsx:105-106 | `aria-invalid={entryId.trim()!==''&&!validEntryId}` | After L106: `{entryId.trim()!==''&&!validEntryId&&<p role="alert" className="field-note">Enter only the number, for example 18.</p>}` so the invalid state has visible text, not only an ARIA flag. |
| low | other | BioArt | BioArtWorkspace.jsx:130 | "Scientific validity is not established by metadata parsing, file validation, or visual quality." | "File checks and appearance do not establish scientific validity." |
| low | other | Prose | ProseWorkspace.jsx:81 | "I consent to sending this text to api.edgeshop.ai for this one request." | `I consent to sending this text to ${detection?.recipient \|\| 'api.edgeshop.ai'} for this one request only; the box clears after each send.` (literal fallback keeps ProseWorkspace.test.jsx:125, 156 matching) |
| low | undefined-term | Prose | ProseWorkspace.jsx:97 | "Triplets · closing summaries · bullets" | Three dt/dd rows: "Lists of three" → `${triplets.count}`; "Paragraphs ending in a summary" → `${closing_summaries.count} of ${closing_summaries.paragraphs}`; "Bullet points" → `${bullets.count}` |
| low | undefined-term | Prose | ProseWorkspace.jsx:95 | "spread {diagnosis.observations.sentence_length.spread_words}" | "{sentences} sentences · mean {mean_words} words · spread {spread_words} words · {pct}% of sentences within 20% of the mean length" |
| low | undefined-term | Prose | ProseWorkspace.jsx:93 | "Style words" | "Overused style words" |
| low | inconsistent-icon | Prose | ProseWorkspace.jsx:115, 126 | "“{e.after \|\| '∅'}”" | `${after ? '“' + after + '”' : '(removed)'}` in both lists ('∅' has no legend) |
| low | unclear-label | Prose | ProseWorkspace.jsx:76 | "behaviour ? 'Hide behaviour' : 'Show the behaviour'" | "Show behaviour text" / "Hide behaviour text" (update ProseWorkspace.test.jsx:69, 71) |
| low | unclear-label | Prose | ProseWorkspace.jsx:67 | "Show rules and detection terms" | "Load rules and detection details" / "Reload rules" (update ProseWorkspace.test.jsx:127, 155); on success show "Rules loaded — see the list under the results." as the :84 status. |
| low | unclear-label | Prose | ProseWorkspace.jsx:79 | "Third-party detection" | "Third-party AI-text detection" |
| low | unclear-label | Prose | ProseWorkspace.jsx:59 | "PROSE / CONTROL" | "PROSE" |
| low | other | Prose | ProseWorkspace.jsx:63 | "{text.length.toLocaleString()} / 20,000 characters." | `${text.length.toLocaleString()} / ${(20000).toLocaleString()} characters.` (a de/ru locale renders '1.234 / 20,000' today) |
| low | unclear-label | Prose | ProseWorkspace.jsx:84 | "Prose request in progress…" | Per action: "Rewriting locally…" / "Diagnosing locally…" / "Loading rules…" / "Sending the text to the prose seat…" / "Sending the text to api.edgeshop.ai…" |
| low | unclear-label | Prose | ProseWorkspace.jsx:110 | "Behaviour {behaviour.version}" | "Behaviour text (version ${behaviour.version})" |
| low | other | Prose | ProseWorkspace.jsx:88-124 | "Diagnosis … Seat rewrite … Local rewrite … Detection receipt" | Order the result sections as the actions appear: Local rewrite, Diagnosis, Seat rewrite (+ Behaviour), Detection receipt, Rules. |
| low | undefined-term | Settings | SettingsWorkspace.jsx:198 | "Settings are edited here and written back through the native supervisor with the revision you loaded." | "Saving goes through the Arc Science desktop app (the supervisor) and is refused if the file changed since you loaded it, so nothing is overwritten." |
| low | excessive-block | Settings | SettingsWorkspace.jsx:252 | "Credentials name files written by arc-science credential --name NAME; CLI login uses the provider's own signed-in account…" | "Credential: the name of a file created with `arc-science credential --name NAME`; no key is stored here. CLI login uses the account already signed in to that provider's CLI. An effort level the sign-in method cannot express is refused on save, not rounded." |
| low | excessive-block | Settings | SettingsWorkspace.jsx:237 | `<p className="seat-guidance">{support.note}</p>` | Render the note only when `!seat.provider \|\| support.disabled \|\| support.invalid`; otherwise nothing (the select already lists only accepted levels). |
| low | unclear-label | Settings | SettingsWorkspace.jsx:11 | `['', '-']` | `['', 'None']` |
| low | inconsistent-icon | Settings | SettingsWorkspace.jsx:291, :329, :342 | "Probe anthropic" | Use providerLabel()/ROLES labels everywhere: "Anthropic", "Planner", "Probe Anthropic" (tests :172, :174 assert 'Probe anthropic'); aria-labels "Anthropic endpoint" likewise. |
| low | unclear-label | Settings | SettingsWorkspace.jsx:24-26, :284 | "ball_and_stick" | Option labels "Ball and stick", "Secondary structure", "B-factor", "Asymmetric unit", "Assembly 1", "Assembly 2" (others capitalised: Cartoon, Surface, Sticks, Spacefill, Backbone, Chain, Element, Residue, Uniform, White, Black, Transparent); keep stored values. |
| low | undefined-term | Settings | SettingsWorkspace.jsx:294 | "isolated" | "Isolated (own session, no shared state)" — meaning to be confirmed by the owner; the "-" empty-cell marker in the OpenClaw agent column → "not applicable". |
| low | unclear-label | Settings | SettingsWorkspace.jsx:288 | "Provider endpoints, OpenClaw isolation and prose diagnostics." | "Provider endpoints, OpenClaw options and AI-text detection." |
| low | unsupported-claim | Settings | SettingsWorkspace.jsx:214 | "When the supervisor is unavailable, this page will show the recovery step instead of a raw service error." | Delete the sentence; line 74 still surfaces raw server text for unknown errors. |
| low | unclear-label | Settings | SettingsWorkspace.jsx:38 | "Settings is locked. Add an operator token before loading settings." | "Settings are locked. Add an operator token first." (probably never shown: Load is disabled without a token) |
| low | unclear-label | Settings | SettingsWorkspace.jsx:208 | "Settings request in progress..." | "Request in progress…" (also shown for probes and MCP/ACP checks) |
| low | unsupported-claim | Settings | SettingsWorkspace.jsx:130 | "API credential is configured; no live inference was run." | "named — Credential file is named; not checked, and no call was made." ('configured' only means the file name is non-empty) |
| low | unclear-label | Settings | SettingsWorkspace.jsx:277 | "Blender preset" | Keep label; add placeholder "preset name". |
| low | excessive-block | Settings | SettingsWorkspace.jsx:337 | `(last.results \|\| []).map(...).join('; ')` | One line per result: "{model}/{effort}: ok, answering model {observed}" \| "{model}/{effort}: ok, answering model not reported" \| "{model}/{effort}: failed: {error}"; empty cell "not run". |
| low | inconsistent-icon | Settings | SettingsWorkspace.jsx:201, :261, :262, :269, :270, :337 | "failed - " | Use "failed: {error}" and " · " between metadata items throughout ("MCP SDK {version} · consented: {list}", "ACP protocol {version} · consented: {list}", "{path} · read only: the supervisor cannot write this file"). |
| low | unclear-label | Settings | SettingsWorkspace.jsx:95 | "has no per-call effort control; medium keeps the provider default." | "{Provider} {CLI\|API} has no effort setting; the provider default is used (stored as medium)." (test :130 asserts 'provider default' appears) |
| low | unclear-label | Settings | SettingsWorkspace.jsx:356-360 | "mcp args 1" | aria-labels "MCP server 1 arguments", "MCP server 1 name", "MCP server 1 transport", "MCP server 1 URL", "ACP agent 2 command" (tests :154-164 assert the lowercase forms). |
| low | unclear-label | Settings | SettingsWorkspace.jsx:360 | "Arguments" | Keep label; placeholder "space-separated" (input is split on whitespace on every keystroke). |
| low | unclear-label | Settings | SettingsWorkspace.jsx:220, :328 | "Transport" | Use "Auth" in the live table header too; "Credential" → "Credential file" in the seats table. |
| low | duplicated-caveat | Settings | SettingsWorkspace.jsx:126 vs :341 | "Probe only with explicit consent." | "not probed — Signed in. Probe from Connections (needs your consent; spends tokens)." |
| low | unsupported-claim | Diagnostics | DiagnosticsWorkspace.jsx:179-180 | "Desktop session ready." | Before any authenticated call: "Desktop session present, not yet verified." / "Operator token present, not yet verified. Load capabilities or run a check to verify it." Test :23 asserts 'Desktop session ready. Authenticated diagnostics' — update together or keep 'ready' only in the :180 pre-check line. |
| low | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:84, :100 | "Run the MCP check to ask configured consented servers for their tools." | "Not checked. Check MCP contacts each consented server and lists its tools." / "Not checked. Check ACP connects to each consented agent (ACP initialize) and reads its name and version." (button names match; side-effect disclosure kept) |
| low | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:93 | "' (not offered)'" | Field-note after the table when any tool is not offered: "Not offered = the server lists the tool but Arc Science does not expose it to models." (confirm the meaning of `offered` in the API) |
| low | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:201 | "Deployment" | Label "Deployment mode"; keep the raw value (e.g. single-trust-domain) unchanged. |
| low | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:210 | "Refresh service to read public readiness." | "Not checked. Select Refresh service to read the public service status." |
| low | undefined-term | Diagnostics | DiagnosticsWorkspace.jsx:71, :75, :218 | "Explicit connection checks" | "Connection checks (run on demand)"; card titles "MCP servers" / "ACP agents" at :71/:75 to match :224/:225. |
| low | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:65 | "Auth" | "Sign-in" (values unchanged) |
| low | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:213 | "Session" | "Operator session" |
| low | inconsistent-icon | Diagnostics | DiagnosticsWorkspace.jsx:73 vs :89 | "SDK: {…} / SDK {…}" | "SDK: {sdk}" in both places (test :81 asserts 'SDK: 1.2.3'); :89 "SDK: {sdk} · consented servers: {list}", :105 "Protocol version {v} · consented agents: {list}". |
| low | contrast-focus | Diagnostics | DiagnosticsWorkspace.css:32-47 | `.diagnostics-card[data-state="ok"] { border-color: #b8d8c4; … }` | State is conveyed by border colour only; ok cards carry no state text. Render a text label in StatusCard: ok → "OK", unavailable → "Unavailable", locked → "Locked", unchecked → "Not checked", error → "Error". |
| low | contrast-focus | Diagnostics | DiagnosticsWorkspace.css:8-47 | `background: #fbfcfd;` | All colours are hard-coded light values with no dark-mode variants; move to shell tokens (not verified here). |
| low | other | Diagnostics | DiagnosticsWorkspace.jsx:16, :93, :109 | `return message.replace(/\s+/g, ' ').trim();` | Add before the fallback: `if (/JSON\|Unexpected token/.test(message)) return 'The service returned an unreadable response. Refresh and retry.';` keep 'Unavailable: ' + server.error (test :105). |
| low | other | Diagnostics | DiagnosticsWorkspace.jsx:68-77 | `state={connectors.mcp?.configured ? 'ok' : 'unavailable'}` | 0 configured / no vision seat renders a red 'unavailable' card although nothing failed. Copy "Not configured. The service reported no vision seat." / "No model seats configured. Set them up in Settings." with a neutral state styled like 'unchecked'. |
| low | unclear-label | Diagnostics | DiagnosticsWorkspace.jsx:14 | "Review its settings, then retry." | "The check could not complete (the service returned an error). Retry; if it persists, review the connection in Settings." |
| low | unsupported-claim | Native startup | launch.rs:294 (STYLE, reduced-motion rule) | `@media (prefers-reduced-motion:reduce){.progress-track::before{animation:none;transform:translateX(80%)}}` | `@media (prefers-reduced-motion:reduce){.progress-track::before{animation:none;width:100%;transform:none;opacity:.35}}` — a static segment parked at 80 % reads as 80 % complete on a bar that must not claim a percentage (tests launch.rs:535-538). |
| low | other | Native startup | launch.rs:399 and launch.rs:435 | `<!doctype html><html><head><meta charset="utf-8"><title>Arc Science</title>` | `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Arc Science</title>` |
| low | unclear-label | Native startup | launch.rs:377-392 | `body.push_str("<ul>");` | `body.push_str("<p class=\"muted\">Startup checks</p><ul aria-label=\"Startup checks\">");` and render optional items as "{name} (optional): {detail}" instead of grey colour alone. |
| low | unclear-label | Native startup | launch.rs:420-426 | `body.push_str("<ul>"); for note in &plan.notes { … <li class="muted">{note}</li> }` | `body.push_str("<p class=\"muted\">Noted during setup</p><ul>");` |
| low | other | Native startup | main.rs:613, main.rs:621 versus launch.rs:315, main.rs:114 | "Starting local service" / "Starting the local service" | "Starting the local service" in all four places. |
| low | duplicated-caveat | Native startup | main.rs:736 | `append_startup_log(startup_log.as_deref(), &format!("Startup failed: {reason}"));` | `append_startup_log(startup_log.as_deref(), "Startup: failure shown in window");` — the same reason is already logged at main.rs:596 or main.rs:659. |
| low | undefined-term | Native startup | main.rs:415 | `Err(format!("ShellExecuteW failed with code {result}"))` | `Err(format!("Windows could not open {} (ShellExecuteW returned {result})", path.display()))` |
| low | undefined-term | Native startup | launch.rs:88, launch.rs:137, launch.rs:170, launch.rs:173 | "The native supervisor {} was not found beside Arc Science.exe, in the development layout, or on PATH…" | "Arc Science needs its startup helper, arc-science-native.exe, and could not find it next to Arc Science.exe, in native/arc-science/target/release, or on PATH. Build it with `cargo build --release` in native/arc-science, or point ARC_DESKTOP_SUPERVISOR at it." Then "the startup helper" in place of "the supervisor" at :137, :170, :173. |
| low | unclear-label | Native startup | launch.rs:245 with startup.rs:31-69 | `let url = LocalUrl::parse(value["url"].as_str().ok_or("The startup plan has no URL")?)?;` | `let url = LocalUrl::parse(…).map_err(\|e\| format!("The startup plan's URL is invalid: {e}"))?;` — on a double-click the user never set ARC_DESKTOP_URL, yet every parse error names it. |
| low | unsupported-claim | Native startup | main.rs:374 with main.rs:596 and launch.rs:154-165 | "Arc Science startup log (redacted). No raw secrets or shell commands are recorded." | "Arc Science startup log. Credential-like values are replaced with [redacted]." — failure lines record the startup helper's full command line, which a reader will take as a recorded command. |
| low | undefined-term | Native startup | main.rs:460-467 | "Arc Science readiness verified; service owned (shutdown requested on exit) \| reused (left running)" | "Arc Science is ready. The service was started by this check and is shut down on exit." \| "Arc Science is ready. An existing service answered and is left running." |
| low | unclear-label | Native startup | launch.rs:394 | `Workspace <code>{}</code>` | `Workspace: <code>{}</code>` (matches "Configuration:" and "Startup log:") |
| low | unclear-label | Native startup | launch.rs:409 | `<a class="button-link" href="arc-science://startup/retry">Retry</a>` | `<a class="button-link" href="arc-science://startup/retry">Retry (reopens Arc Science)</a>` |
| low | other | Native startup | startup.rs:439 and startup.rs:461 | "Service exited before readiness: {status}" → "Service exited before readiness: exit code: 1" | "The service exited before it was ready ({status})" / "The service exited while being checked ({status})" |
| low | other | Native startup | README.md:37 | "or under `Windows Kitsin`" | "or under `Windows Kits`" |

## 2. Per surface

Each section lists only the controls that have an issue and only the strings that have a proposal. "Keep as is" lists the caveats, consent terms and facts that must survive any rewording.

### 2.1 Shell

Files: `apps/arc-science/web/src/main.jsx`, `icons.jsx`, `styles.css`, `http.js`, `App.test.jsx`.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Operator token | password input (id operator-token, autoComplete off, aria-describedby operator-token-note) | visible whenever token !== NATIVE_SESSION (plain browser, service offline/401 on /api/session/status, or after "Use operator token"); not rendered while the native desktop session is detected; always enabled; value in React state only, never in localStorage/sessionStorage (App.test.jsx:62, 273, 290); no error state of its own — a rejected token surfaces as a workspace error (http.js:29) | apps/arc-science/web/src/main.jsx:55 | Its explanation (header note) is visually hidden ≤1100 px; no placeholder; token rejection errors appear elsewhere. Proposal: `placeholder="Paste token"`; keep the note; 401 errors mention the header. |
| Use operator token | ghost button inside a role=status div | rendered only when token === NATIVE_SESSION (after /api/session/status returned ok); always enabled; onPress sets token '' and swaps the status for the token field; irreversible without reload | apps/arc-science/web/src/main.jsx:55 | One-way: no adjacent way back to the desktop session; an interactive control sits inside a live region. Proposal: `nativeAvailable` flag set when the probe succeeds; when `nativeAvailable && token !== NATIVE_SESSION` render `<Button variant="ghost" onPress={()=>setToken(NATIVE_SESSION)}>Use desktop session</Button>` next to the token field; put role="status" on a `<span>` around the text. |
| BioArt | toggle button (aria-pressed) in nav "Workspaces" | always enabled; aria-pressed when workspace==='bioart'; navigate('bioart') → '/' | apps/arc-science/web/src/main.jsx:56 | Icon `scan-search` duplicated with Diagnostics; no image cue. Proposal: icon → `image`. |
| Settings | toggle button (aria-pressed) in nav-utility | always enabled; aria-pressed when workspace==='settings'; navigate('settings') → '/' | apps/arc-science/web/src/main.jsx:56 | `sliders` glyph optically oversized (x 1..23 vs 3..21). Proposal: tighten geometry (findings). |
| Diagnostics | toggle button (aria-pressed) in nav-utility | always enabled; aria-pressed when workspace==='diagnostics'; pushState to '/diagnostics' (App.test.jsx:212); popstate restores it (main.jsx:44-48) | apps/arc-science/web/src/main.jsx:56 | Icon `scan-search` duplicated with BioArt. Proposal: icon → `activity`. |
| Download notice | live region `<p role=status\|alert>`, not interactive | hidden until a window `arc-download` CustomEvent arrives from the native shell; role=status + .status tone on success, role=alert + .alert tone on failure; auto-hidden after 12 000 ms regardless of tone (line 25); each new event replaces the previous notice (App.test.jsx:404) | apps/arc-science/web/src/main.jsx:17-31 | Failure alerts auto-dismiss; long folder paths cannot wrap. Proposal: dismiss timer only for success; `.download-notice { min-width: 0; overflow-wrap: anywhere; }`. |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| apps/arc-science/web/src/main.jsx:24 | `Saved ${file\|\|'the download'}${folder?' in '+folder:''}` (renders "Saved the download" with no file) | `success ? (file ? \`Saved ${file}${folder ? ' in ' + folder : ''}\` : 'Download saved') : …`; CSS `.download-notice { min-width: 0; overflow-wrap: anywhere; }` |
| apps/arc-science/web/src/main.jsx:24 | `Download failed${file?': '+file:''}. Nothing was saved.` | Keep the text verbatim; only auto-dismiss the success notice: `if (success) timer = setTimeout(() => setNotice(null), 12000);` |
| apps/arc-science/web/src/main.jsx:55 | Desktop session ready | Signed in by the desktop app |
| apps/arc-science/web/src/main.jsx:55 | Use operator token | Use a token instead — plus the reverse control "Use desktop session" |
| apps/arc-science/web/src/main.jsx:55 | Operator token (label) | Keep the label; add `placeholder="Paste token"` to the input |
| apps/arc-science/web/src/main.jsx:55 | Run arc-science token --data ./data for your project; paste token here. | Paste the token from `arc-science token --data ./data` (your project's data folder). — with `.header-note code { font-size: 11px; }` |
| apps/arc-science/web/src/main.jsx:56 | MAIN | WORKSPACES |
| apps/arc-science/web/src/main.jsx:56 | BioArt (`<Icon name="scan-search"/>`) | Keep the label; `<Icon name="image"/>` |
| apps/arc-science/web/src/main.jsx:56 | Settings (`<Icon name="sliders"/>`) | Keep the label; tighten the glyph to x 2..22 |
| apps/arc-science/web/src/main.jsx:56 | Diagnostics (`<Icon name="scan-search"/>`) | Keep the label; `<Icon name="activity"/>` |
| apps/arc-science/web/src/main.jsx:56 | Workspaces (aria-label on `<nav>`) | Keep; align the eyebrow to it |
| apps/arc-science/web/src/http.js:28 | `detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail \|\| '');` | `detail = Array.isArray(data.detail) ? data.detail.map(d => (d && d.msg) ? d.msg : JSON.stringify(d)).join('; ') : typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail \|\| '');` |
| apps/arc-science/web/src/http.js:29 | `Request failed (${response.status})${detail ? ': ' + detail : ''}` | Same message, plus `'. Check the operator token in the header.'` when response.status === 401 |
| apps/arc-science/web/src/http.js:40 | Operator token is required for protected requests. | Operator token is missing. Paste it in the header first. |

#### Keep as is

- "Nothing was saved." in the download-failure notice (main.jsx:24) — a factual commitment about the failed download; keep verbatim.
- The exact command `arc-science token --data ./data` in the header note (main.jsx:55).
- The operator token lives only in React state: never written to localStorage or sessionStorage (asserted App.test.jsx:62, 273, 290).
- A native desktop session sends no Authorization header (http.js:15; App.test.jsx:234); any caller-supplied Authorization header is stripped (http.js:13).
- Protected requests are restricted to local `/api` paths (http.js:19-23); the developer guard "Protected requests must use local /api paths." stays.
- The manual fallback from native session to a typed token must remain available (App.test.jsx:224-238); adding a reverse control must not remove it.
- Nav labels and order Research, Memory, Molecules, BioArt, Prose, Settings, Diagnostics (asserted App.test.jsx:196); nav accessible name "Workspaces"; `aria-pressed` on the current workspace (App.test.jsx:195).
- Diagnostics is served at `/diagnostics`, every other workspace at `/`, and browser history restores the workspace (main.jsx:34-53; App.test.jsx:212, 217-219).
- All workspaces stay mounted so credentials, goal and selection survive switching (main.jsx:58-65).
- Download notices replace each other; success uses role=status, failure role=alert (main.jsx:30; App.test.jsx:397-405).
- The HTTP status number in `Request failed (N)` (asserted App.test.jsx:259) and the service's `detail` text must remain visible.
- Icon geometry is Lucide retrieved via Supericons, credited in THIRD_PARTY_NOTICES.md (icons.jsx:2); any added glyph must be sourced and credited the same way.
- Icons stay aria-hidden and focusable=false with text labels beside them (icons.jsx:4); labels, not icons, carry meaning.

### 2.2 Research

Files: `apps/arc-science/web/src/ResearchWorkspace.jsx`, `ResearchToken.test.jsx`, `styles.css`.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Use example | button (ghost, sm) | always enabled | ResearchWorkspace.jsx:170 | Overwrites any existing draft without confirmation; adjacent note says "Adds". Proposal: note "Replaces the draft with a sample question. It does not start a mission." |
| Create and start | button (primary) | disabled when busy; disabled when locked (no token or authExpired — unlock card adjacent explains); disabled when goal is blank — no adjacent reason; enabled when token present, not expired, goal non-empty, not busy | ResearchWorkspace.jsx:173 | Empty-goal disabled state has no reason next to it; errors it raises appear in the results pane (:190). Proposal: field note under the goal when blank "Enter a research goal to enable Create and start."; render the :190 alert directly under this button when the failed action was start. |
| Execution settings | details/summary | collapsed by default | ResearchWorkspace.jsx:177 | Both consent checkboxes are inside; summary shows no state. Proposal: `Execution settings · {mode==='demo'?'offline fixture':'live models'} · {egress?'data may leave this machine':'nothing leaves this machine'}` |
| Round limit | input#rounds type=number min=1 max=12 | always enabled; default 5; no in-page validation; typed out-of-range values are sent (:146) | ResearchWorkspace.jsx:178 | Proposal: clamp on change `setRounds(Math.min(12, Math.max(1, Number(e.target.value)\|\|1)))`. |
| Measurement JSON | textarea#points | always enabled; parsed only on Create and start (:146); parse failure shown as raw SyntaxError in the results alert | ResearchWorkspace.jsx:181 | Error is neither adjacent nor friendly. Proposal: under the field "Measurement JSON is not valid JSON: {message}". |
| Load missions | button (secondary) | disabled when busy or locked; enabled otherwise; no loading text while busy | ResearchWorkspace.jsx:186 | No loading text. Proposal: `<p role="status" className="muted">Working…</p>` next to the action row while busy. |
| Verify and recompute | button (primary) | hidden until a mission is selected; disabled when busy or locked; no loading text | ResearchWorkspace.jsx:194 | Name differs from the report it produces ("Replay verification"). Proposal: "Replay and verify". |
| Export replay capsule | button (secondary) | hidden until a mission is selected; disabled when busy, locked, or mission.release.eligible_for_human_review is false; unlocks when the release decision becomes "Eligible for human review" | ResearchWorkspace.jsx:194 | No adjacent reason; the Release decision ledger sits further down. Proposal: muted line "Export opens when the release decision is Eligible for human review."; label "Export replay archive (.zip)". |
| Download authenticated PNG | link (download) | hidden until the artifact blob has loaded; replaced by the "Download withheld…" note unless release.eligible_for_human_review | ResearchWorkspace.jsx:44 | 'authenticated' undefined for the reader. Proposal: "Download PNG". |
| Reconciliation | details/summary | collapsed by default; shows only the last 12 assessments | ResearchWorkspace.jsx:202 | Truncation unstated. Proposal: "Reconciliation (last 12 assessments)". |
| Event history | details/summary | collapsed by default; shows only the last 15 events, newest first | ResearchWorkspace.jsx:204 | Truncation unstated. Proposal: "Event history (last 15 events)". |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| ResearchWorkspace.jsx:6 (TOKEN_HELP; rendered at :174 via lockCopy) | Run arc-science token --data ./data from this project, or use the token file produced by the local service, then paste the token in the header. | Paste an operator token in the header field. To get one, run `arc-science token --data ./data` in the project folder, or open the token file the local service writes. |
| ResearchWorkspace.jsx:7 (LOCKED_MESSAGE) | [TOKEN_HELP] Draft text stays in this window. | [TOKEN_HELP] Your draft stays in this window. |
| ResearchWorkspace.jsx:8 (AUTH_RECOVERY; rendered at :190 and inside lockCopy at :174) | Operator session is locked or expired. Enter a current operator token and retry; your unsent text stays here. | Alert: "Operator session is locked or expired. Enter a current operator token in the header and retry. Your draft stays in this window." Unlock card (expired): title plus TOKEN_HELP only, not AUTH_RECOVERY again. |
| ResearchWorkspace.jsx:16 | {check.name with _→space} · {check.state with first _→space} — {check.reason} | Use `.replace(/_/g,' ')` for both name and state. |
| ResearchWorkspace.jsx:17 | Blocked by: {release.blocking_reasons.join(', ')}. | Blocked by: {reasons.map(r=>r.replace(/_/g,' ')).join(', ')}. |
| ResearchWorkspace.jsx:24 (heading) / :194 (button) | Replay verification: {…} / Verify and recompute | Keep the heading; button "Replay and verify"; export "Export replay archive (.zip)" |
| ResearchWorkspace.jsx:25 | Integrity: {outcome} · Evidence graph: {outcome} | Integrity check: {outcome} · Evidence links: {outcome} |
| ResearchWorkspace.jsx:26 | Recomputed: {report.reproduced ?? 'unreported'} computations · {report.artifacts_reproduced ?? 'unreported'} artifacts. | Recomputed: {n ?? 'not reported'} computations · {n ?? 'not reported'} artifacts. |
| ResearchWorkspace.jsx:28 | {report.failures.length} verification failures. Inspect the details before relying on this replay. | {n} verification {n===1?'failure':'failures'}. Open Verification details before relying on this replay. |
| ResearchWorkspace.jsx:44 | Download authenticated PNG | Download PNG |
| ResearchWorkspace.jsx:44 | Download withheld until the release decision is eligible; inline inspection stays available. | Download opens when the release decision is 'Eligible for human review'. You can still inspect the image here. |
| ResearchWorkspace.jsx:44 | Artifact unavailable: {friendlyError(e)} | Artifact could not be loaded: {error} |
| ResearchWorkspace.jsx:44 | Check your token, then retry or select the mission again. | Retry, or select the mission again. |
| ResearchWorkspace.jsx:44 | Loading authenticated artifact… | Loading image… |
| ResearchWorkspace.jsx:44 (figcaption) | {source_observation_id} · {digest.slice(0,12)}… · preset {preset\|\|'default'}{' · repair of '+…}{' · superseded by a repair'} | {observation} · digest {digest12}… · render preset: {preset\|\|'default'} · repairs {repair12}… · replaced by a later repair |
| ResearchWorkspace.jsx:50 | Arc Science service is offline or unreachable. Check the local service, then retry; your draft stays here. | Arc Science service is offline or unreachable. Start the local service, then retry. Your draft stays in this window. |
| ResearchWorkspace.jsx:51 (friendlyError default branch) | {error.message} (raw passthrough, including SyntaxError from :146) | Parse errors: "Measurement JSON is not valid JSON: {message}". Other server errors: "The request failed ({status}). Retry; your draft stays in this window." |
| ResearchWorkspace.jsx:60 | Claim scope (h2) | Keep; add muted line: "For each requested claim: what the evidence supports so far, what is still uncertain, and the next test that would tell the branches apart." |
| ResearchWorkspace.jsx:61 | Derived at round {scope.basis_round}; provisional support is exploratory, never validation. | Worked out at round {n}. 'Provisionally supported' is exploratory, not validation. |
| ResearchWorkspace.jsx:66 (dt) | Evidence-supported scope | What the evidence supports |
| ResearchWorkspace.jsx:66 | Scope: {branch.scope_qualifier}. | Holds for: {scope_qualifier}. |
| ResearchWorkspace.jsx:66 | No supported scope; the requested claim stands only as a hypothesis. | Nothing supported yet; the requested claim remains a hypothesis. |
| ResearchWorkspace.jsx:67 | None recorded by either role; provisional support still needs independent data. | Neither model role recorded any; provisional support still needs independent data. |
| ResearchWorkspace.jsx:68 (dt) | Next discriminating test | Next test that would tell the branches apart |
| ResearchWorkspace.jsx:71 | The claim scope is derived when the mission stops; none yet. | Claim scope is worked out when the mission stops. Nothing yet. |
| ResearchWorkspace.jsx:77 (h2) | Declared changes | Changes declared by the operator |
| ResearchWorkspace.jsx:77 (li) | {change.kind} at round {change.round} · declared … · derived … · obligations: … — {change.note} | Line 1 "{kind}, round {round}"; line 2 "Declared effect: {declared} · Server-derived effect: {derived}"; line 3 "Required checks: {check state}, …"; line 4 (muted) "{note}" |
| ResearchWorkspace.jsx:77 | No declared change. | No changes declared. |
| ResearchWorkspace.jsx:84 (li) | Cycle {cycle} · round {round} · preset {preset} · addressed {…\|\|'—'} → {outcome} — {reason} | Cycle {n} (round {r}, render preset {p}): fixed {list\|\|'nothing'}. Review verdict: {outcome}. {reason} |
| ResearchWorkspace.jsx:84 | No repair cycle. | No repair cycles. |
| ResearchWorkspace.jsx:162 (lockTitle, no token) | Local unlock required | Operator token required (test anchor ResearchToken.test.jsx:178 changes) |
| ResearchWorkspace.jsx:163 (lockCopy when authExpired) | [AUTH_RECOVERY] [TOKEN_HELP] | Enter a current operator token in the header and retry. To get one, run `arc-science token --data ./data` in the project folder, or open the token file the local service writes. Your draft stays in this window. |
| ResearchWorkspace.jsx:166 | RESEARCH / DEVELOPMENT | RESEARCH |
| ResearchWorkspace.jsx:170 | Adds a sample question to the draft. It will not start a mission. | Replaces the draft with a sample question. It does not start a mission. |
| ResearchWorkspace.jsx:174 | Offline mode uses scripted roles with real numerical computation. | mode==='demo': "Offline fixture: the model roles are scripted; the numerical fits are computed for real." mode==='live': "Live models: nothing is sent until you tick the consent box in Execution settings." |
| ResearchWorkspace.jsx:178 (label) | Execution | Model source |
| ResearchWorkspace.jsx:178 (option demo) | Offline validation fixture | Offline fixture (no model calls) |
| ResearchWorkspace.jsx:178 (option live) | Configured live models | Live models set up in the local service |
| ResearchWorkspace.jsx:178 (label) | Round limit | Round limit (1–12) |
| ResearchWorkspace.jsx:179 | Permit sending this mission's data to configured models. | Permit sending this mission's goal and data to the configured models (the text leaves this machine). |
| ResearchWorkspace.jsx:180 | Require configured visual review of each new fit image. | Require configured visual review: a vision model checks every new fit plot. |
| ResearchWorkspace.jsx:181 | 8-2000 numeric x/y points. Leave empty for public-source exploration in live mode. | Paste {"x":[…],"y":[…]} with 8–2000 numeric points. Leave empty and live mode will look for public data instead. |
| ResearchWorkspace.jsx:187 (locked) | Unlock to load saved missions. | Enter an operator token to load saved missions. |
| ResearchWorkspace.jsx:187 (unlocked) | Load missions with your operator token. | Press Load missions to list your saved missions. |
| ResearchWorkspace.jsx:187 (row) | {row.status} · {row.goal} | {row.status.replace(/_/g,' ')} · {row.goal} |
| ResearchWorkspace.jsx:191 | No mission selected. | No mission selected. Create one above or load a saved mission. |
| ResearchWorkspace.jsx:192 | Decision frontier | Mission overview |
| ResearchWorkspace.jsx:192 (status-label) | {state.status} | {state.status.replace(/_/g,' ')} |
| ResearchWorkspace.jsx:193 | Round {state.round} · {state.actions_used} actions · {state.model_calls_used} model-role calls · data: {state.data_origin} | Round {round} · {actions} tool actions · {calls} model calls · data source: {origin} |
| ResearchWorkspace.jsx:194 | Verify and recompute | Replay and verify |
| ResearchWorkspace.jsx:194 | Export replay capsule | Export replay archive (.zip) |
| ResearchWorkspace.jsx:194 | Resume (declares an analysis change) | Resume (recorded as an analysis change) |
| ResearchWorkspace.jsx:195 | {state.stop_reason} | Stop reason: {stop_reason} |
| ResearchWorkspace.jsx:197 | Falsifier: {branch.falsifier} | Would be refuted by: {falsifier} |
| ResearchWorkspace.jsx:198 | Visual artifacts / No visual artifacts in this mission. | Figures / No figures in this mission. |
| ResearchWorkspace.jsx:202 (summary) | Reconciliation | Reconciliation (last 12 assessments) |
| ResearchWorkspace.jsx:204 (summary) | Event history | Event history (last 15 events) |

#### Keep as is

- Eligible means ready for a human reviewer, not validated. (:15)
- Scientific validity is not established by replay verification. (:27; test anchor)
- "provisional support is exploratory, never validation" (:61), "the requested claim stands only as a hypothesis" (:66) and "provisional support still needs independent data" (:67).
- Egress consent (allow_egress, :179): the mission's goal and data are sent to the configured models only when this box is ticked; unchecked by default and reset on every token change (:104). Any rewording keeps "the text leaves this machine" in meaning and the phrase "Permit sending" (test regex).
- Vision consent (vision_review, :180): a configured visual review of every new fit image; keep the phrase "Require configured visual review" (test regex).
- 8–2000 numeric x/y points (:181) and the empty-field behaviour in live mode.
- Download of artifacts is withheld until release.eligible_for_human_review; inline inspection stays available (:44).
- Resuming a paused mission is recorded as a declared analysis change (:194).
- Offline/demo mode: model roles are scripted, numerical computation is real (:174).
- Unsent draft text stays in this window across lock, expiry and offline states (:7, :8, :50).
- `arc-science token --data ./data` and "token file" produced by the local service (:6; test anchors).
- "Operator session is locked or expired" (:8; alert test anchor); "Local unlock required" / "Operator token expired" (:162; status test anchors — change only with the tests).
- Provenance facts in artifact captions: source_observation_id, 12-char digest prefix, preset, repair_of, superseded-by-repair (:44).
- Recomputed counts, integrity/evidence-graph outcomes and failure counts from the verification report (:24-28); "N computations" and "N artifacts" are test anchors.
- Release check names, states and reasons; blocking reasons (:16-17).
- Round numbers, actions_used, model_calls_used, data_origin (:193); branch created_round and parents (:197).
- Claim scope structure: requested claim → evidence-supported scope + scope_qualifier → uncertainties (reason, role, detail) → next tests (role, test) (:65-68).
- Change records: kind, round, declared_effects, derived_effects, required checks and their states, note (:77); repair cycles: cycle, round, preset, addressed, outcome, reason (:84).
- Test-anchored control names: Load missions, Create and start, Verify and recompute, Export replay capsule, Cancel, Go to token field; test-anchored texts: Execution settings, Verification details, Reconciliation, Execution evidence, Event history, Selected mission: {id}, Research goal, Measurement JSON, Claim scope (region), "Artifact from {id}", "{status} · {goal}", "{id} · {tool} · {status}", "[{round}] {kind}: {detail}".
- Never add claims of human authorship, detector evasion, novelty or production readiness anywhere on this surface.

### 2.3 Memory

Files: `apps/arc-science/web/src/MemoryWorkspace.jsx`, `MemoryWorkspace.test.jsx`. No icons are rendered; no CSS lives in these files (classes to check in the stylesheet: .muted, .field-note, .eyebrow, .status-label, .unlock-card, .mission-choice[aria-pressed], .formrow).

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Expand / Collapse | button (HeroUI ghost) | hidden until record.text.length > 280; always enabled (not gated by busy or locked) | apps/arc-science/web/src/MemoryWorkspace.jsx:27 | Identical accessible name on every long card. Proposal: aria-label `Show full text of record {record.seq}` / `Show less of record {record.seq}`. |
| Remove from retrieval | button (HeroUI secondary) | one per record card; disabled while busy; NOT disabled when locked/authExpired (every other action uses busy \|\| locked); clicking then throws AUTH_RECOVERY into the alert at the top of the column | apps/arc-science/web/src/MemoryWorkspace.jsx:29 | Inconsistent locked state; failure copy far from the card. Proposal: `isDisabled={busy \|\| locked}`; aria-label `Remove record {record.seq} from retrieval`. |
| Use operator token / Go to token field | button (HeroUI secondary sm) inside unlock card role=status | hidden until locked (!token \|\| authExpired); "Use operator token" when token === NATIVE_SESSION (clears token), else "Go to token field"; focuses #operator-token in the app header via setTimeout; no feedback if absent | apps/arc-science/web/src/MemoryWorkspace.jsx:118 | Silent no-op if the header field is not rendered. Proposal: when `document.getElementById('operator-token')` is null set the alert "Token field not found. Open the header to enter an operator token." |
| Search memory | textarea #mem-query (rows=2) | enabled while locked (draft preserved by design; tests :114, :137, :141); disabled while busy; no placeholder | apps/arc-science/web/src/MemoryWorkspace.jsx:120 | Empty textarea gives no hint that lexical mode needs literal keywords. Proposal: `placeholder="Keywords to find in captured sessions"`. |
| Retrieval | select #mem-mode | default 'lexical'; disabled while busy; options individually disabled when not in health.retrieval_modes; before /health loads, availableModes defaults to ['lexical'] so Semantic/Hybrid already read "(unavailable)"; if a chosen mode disappears after a health refresh the select keeps a disabled option selected and Search goes disabled | apps/arc-science/web/src/MemoryWorkspace.jsx:122 | Label unclear; availability stated three ways (option suffix, :127 note, :128 note). Proposal: label "Search mode"; keep option suffixes; keep only one note. |
| Search scope | select #mem-scope | default 'all'; disabled while busy; option "Selected session" disabled until a session is opened, with no reason shown | apps/arc-science/web/src/MemoryWorkspace.jsx:130 | Proposal: option text "Selected session (open a session first)" while disabled. |
| Search | button (HeroUI primary) | disabled when busy \|\| locked \|\| query blank \|\| mode not available \|\| (scope 'selected' and no session); no adjacent reason except the unlock card for the locked case | apps/arc-science/web/src/MemoryWorkspace.jsx:134 | Disabled with no reason when scope is 'selected' and no session is open. Proposal: pair with the option text above. |
| {session_id} · N records · epochs a–b | button (HeroUI ghost, aria-pressed) per session | hidden until sessions loaded; disabled when busy \|\| locked; aria-pressed when it is the open session; opens the default range 0–199 | apps/arc-science/web/src/MemoryWorkspace.jsx:145 | Long single-line label; pluralisation. Proposal: `{s.session_id} · {s.record_count} record{s.record_count === 1 ? '' : 's'} · compaction epochs {s.min_epoch}–{s.max_epoch}`. |
| Load record range | submit button (HeroUI secondary) | disabled when busy \|\| locked; validation error (:84) and server 409 text land in the alert at :149, above the `<details>`, not beside this button | apps/arc-science/web/src/MemoryWorkspace.jsx:178 | Error copy not adjacent. Proposal: repeat the alert text directly under this button: "Range not loaded: {error}". |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| apps/arc-science/web/src/MemoryWorkspace.jsx:8 (TOKEN_HELP) | Run arc-science token --data ./data from this project, or use the token file produced by the local service, then paste the token in the header. | Paste an operator token into the header field. Get one by running `arc-science token --data ./data` in this project, or from the token file the local service writes. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:9 (LOCKED_MESSAGE) | TOKEN_HELP + ' Draft text stays in this window.' | TOKEN_HELP + ' Your unsent search stays here.' |
| apps/arc-science/web/src/MemoryWorkspace.jsx:10 (AUTH_RECOVERY) | Operator session is locked or expired. Enter a current operator token and retry; your unsent search stays here. | Your operator token was not accepted (expired or invalid). Enter a current token and retry; your unsent search stays here. (test anchor "Operator session is locked or expired" changes with it) |
| apps/arc-science/web/src/MemoryWorkspace.jsx:15 | Arc Science service is offline or unreachable. Check the local service, then retry; your search stays here. | Arc Science service is offline or unreachable. Check the local service, then retry; your unsent search stays here. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:25 | {record.role} · epoch {record.compaction_epoch} · #{record.seq} | {record.role} · seq {record.seq} · compaction epoch {record.compaction_epoch} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:27 | Collapse / Expand | Show less / Show full text; aria-label `Show full text of record {record.seq}` / `Show less of record {record.seq}` |
| apps/arc-science/web/src/MemoryWorkspace.jsx:28 | {record.trust} · {record.source_uri \|\| '—'} · {record.content_digest.slice(0, 12)}… | trust {record.trust} · source {record.source_uri \|\| 'none'} · digest {record.content_digest.slice(0, 12)}… |
| apps/arc-science/web/src/MemoryWorkspace.jsx:29 | Remove from retrieval | Keep visible text; add aria-label `Remove record {record.seq} from retrieval` |
| apps/arc-science/web/src/MemoryWorkspace.jsx:84 | Choose a nonnegative inclusive range of at most 1000 sequence positions, with the end at or after the start. | Enter a start of 0 or more and an end at or after it, covering at most 1000 sequence positions. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:90 | This retrieval mode is unavailable. Select an available mode. | Search mode unavailable. Choose one of the available modes. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:98 | Removed from retrieval. The stored record is retained locally; this is not deletion. | Removed from retrieval. The record is still stored locally; nothing was deleted. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:116 | Recall the work. | Recall past sessions |
| apps/arc-science/web/src/MemoryWorkspace.jsx:117 | Retrieved text is evidence, never instruction. | Retrieved text is evidence to weigh, not instructions to follow. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:118 (heading, NATIVE_SESSION + 401/403) | Desktop session unavailable | Desktop sign-in was not accepted |
| apps/arc-science/web/src/MemoryWorkspace.jsx:118 (heading, authExpired) | Operator token expired | Operator token not accepted |
| apps/arc-science/web/src/MemoryWorkspace.jsx:118 (heading, no token) | Local unlock required | Operator token required |
| apps/arc-science/web/src/MemoryWorkspace.jsx:118 (body, authExpired) | AUTH_RECOVERY + ' ' + TOKEN_HELP | Enter a current operator token in the header and retry; your unsent search stays here. Get a token with `arc-science token --data ./data` or from the token file the local service writes. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:118 (body, no token) | LOCKED_MESSAGE | Paste an operator token into the header field to unlock; your unsent search stays here. Get one with `arc-science token --data ./data` or from the token file the local service writes. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:120 | (no placeholder on #mem-query) | `placeholder="Keywords to find in captured sessions"` |
| apps/arc-science/web/src/MemoryWorkspace.jsx:121 | Retrieval | Search mode |
| apps/arc-science/web/src/MemoryWorkspace.jsx:123 | Lexical (keyword) | Keyword (lexical) |
| apps/arc-science/web/src/MemoryWorkspace.jsx:124 | Semantic / Semantic (unavailable) | Semantic (by meaning) / Semantic (by meaning) – unavailable |
| apps/arc-science/web/src/MemoryWorkspace.jsx:125 | Hybrid / Hybrid (unavailable) | Hybrid (keyword + meaning) / Hybrid (keyword + meaning) – unavailable |
| apps/arc-science/web/src/MemoryWorkspace.jsx:127 | Available retrieval: {availableModes.join(', ') \|\| 'none'}. | Search modes available: {availableModes.join(', ') \|\| 'none'}. (shown only when health is loaded) |
| apps/arc-science/web/src/MemoryWorkspace.jsx:128 | Semantic and hybrid retrieval are unavailable without a configured embedder. Lexical search matches keywords. | Semantic and hybrid search need an embedding model; none is reported as configured. Keyword search is available. (rendered only after /health) |
| apps/arc-science/web/src/MemoryWorkspace.jsx:131 | Selected session{session ? ': ' + session : ''} | Selected session{session ? ': ' + session : ' (open a session first)'} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:137 | Worker {health.protocol} · SQLite {health.sqlite} | Memory service {health.protocol} · SQLite {health.sqlite} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:138 | Capture: {health.capture.status} · {health.capture.pending} pending | Session capture: {health.capture.status} · {health.capture.pending} records waiting to be written |
| apps/arc-science/web/src/MemoryWorkspace.jsx:139 | {health.capture.last_error} | Last capture error: {health.capture.last_error} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:140 | Some mission records may be missing. Refresh sessions to check recovery. | Some mission records may be missing. Select Load sessions again to check whether capture recovered. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:141 | Mission capture is not configured. | Session capture is not configured; new mission records are not being saved. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:144 (unlocked) | Load sessions with your operator token. | Select Load sessions to list captured sessions. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:145 | {s.session_id} · {s.record_count} records · epochs {s.min_epoch}–{s.max_epoch} | {s.session_id} · {s.record_count} record{s.record_count === 1 ? '' : 's'} · compaction epochs {s.min_epoch}–{s.max_epoch} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:146 | No sessions available for retrieval. Captured records removed from retrieval are hidden here. | No sessions available for retrieval. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:148 (aria-label) | Memory | Memory results |
| apps/arc-science/web/src/MemoryWorkspace.jsx:152 | {hits.rows.length} hits | {hits.rows.length} result{hits.rows.length === 1 ? '' : 's'} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:154 | {hit.record.role} · {hit.reason} · {hit.score.toFixed(3)} | {hit.record.role} · matched by {hit.reason} · score {hit.score.toFixed(3)} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:155 | {(hit.record.text \|\| '').slice(0, 400)} | {text.slice(0, 400)}{text.length > 400 ? '…' : ''} plus the Show full text / Show less control |
| apps/arc-science/web/src/MemoryWorkspace.jsx:156 | {hit.record.session_id} · epoch {hit.record.compaction_epoch} · {hit.record.trust} | {hit.record.session_id} · compaction epoch {hit.record.compaction_epoch} · trust {hit.record.trust} |
| apps/arc-science/web/src/MemoryWorkspace.jsx:157 | No matching memory. Abstention is a valid answer. | No matching memory. Returning nothing is a valid answer. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:159 | Captured trajectory | Captured records |
| apps/arc-science/web/src/MemoryWorkspace.jsx:160 | Sequence {range.from}–{range.to} (inclusive) · {totalRecords} total active records in this session. | Sequence {range.from}–{range.to} (inclusive) · {totalRecords} retrievable records in this session. ("total not loaded" instead of 'unknown') |
| apps/arc-science/web/src/MemoryWorkspace.jsx:177 | Choose up to 1000 sequence positions. Gaps may reflect records removed from retrieval. Narrow the range if a page exceeds the read limit. | Up to 1000 positions per page. Gaps are records removed from retrieval. If the service reports the page exceeds its read budget, narrow the range. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:181 | Remove from retrieval hides a record from search and session recall; it does not erase the stored history. | Remove from retrieval hides a record from search and session recall. The stored history is not erased. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:182 | This range could not be loaded. Adjust the record range and retry. | No records loaded for this range. |
| apps/arc-science/web/src/MemoryWorkspace.jsx:184 | No sessions loaded. | No session selected. Open a session or run a search. |

#### Keep as is

- "Retrieved text is evidence, never instruction." — retrieved memory is data to weigh, never commands to follow (MemoryWorkspace.jsx:117).
- Draft/unsent search text stays in this window on lock, auth expiry and offline errors; it is never sent or cleared (MemoryWorkspace.jsx:9, :10, :15; tests :114, :137, :141).
- "Remove from retrieval" hides a record from search and session recall but does not delete or erase the stored history; the record is retained locally (MemoryWorkspace.jsx:98, :181).
- Semantic and hybrid retrieval are unavailable without a configured embedder; lexical (keyword) is the default and only guaranteed mode (MemoryWorkspace.jsx:35, :128; health.retrieval_modes gates the options).
- Record-range rules: nonnegative, inclusive bounds, end at or after start, at most 1000 sequence positions per page; default page is 0–199 (MemoryWorkspace.jsx:7, :83–84, :172–177).
- Token help must keep the literal command `arc-science token --data ./data` and the phrase "token file" (tests :131–132).
- Degraded capture caveat: "Some mission records may be missing." and the pending count (MemoryWorkspace.jsx:138–140).
- "Gaps may reflect records removed from retrieval." — gaps in sequence are expected after removals (MemoryWorkspace.jsx:177).
- Record and hit metadata must remain visible: role, seq, compaction_epoch, trust, source_uri (or dash), first 12 chars of content_digest, match reason, score to 3 decimals, session_id (MemoryWorkspace.jsx:25, :28, :154, :156).
- "No matching memory" with abstention/empty result explicitly allowed (MemoryWorkspace.jsx:157).
- Loaded count and total active-record count are shown separately (MemoryWorkspace.jsx:159–160; test :157).
- Raw "Request failed (401)"/(403) text is never shown; auth expiry copy is distinct from offline copy (MemoryWorkspace.jsx:14–15; tests :140, :152–153).
- Server error `detail` text (e.g. "read budget… narrower sequence range") is surfaced to the user unchanged (MemoryWorkspace.jsx:16; test :204).
- Test-pinned strings (change only with MemoryWorkspace.test.jsx): 'Load sessions', 'Search', 'Retrieval', 'Search memory', 'Search scope', 'Remove from retrieval', 'Previous records', 'Next records', 'Record range', 'From sequence (inclusive)', 'To sequence (inclusive)', 'Load record range', 'Go to token field', 'Local unlock required', 'Operator token expired', 'Operator session is locked or expired', 'arc-science token --data ./data', 'token file', 'Arc Science service is offline or unreachable', /Available retrieval: lexical/, /Semantic and hybrid retrieval are unavailable/, /Capture: degraded · 2 pending/, /Capture: ready/, /Removed from retrieval/, /No matching memory/, 'N loaded', /N total active records/, 'Captured trajectory', /Search · lexical · private-session/, /Search · lexical · all sessions/, 'at most 1000', /private-session · 1 records/.

### 2.4 Molecules

Files: `apps/arc-science/web/src/MolecularWorkspace.jsx`, `MolecularRenderPanel.jsx`, `MolecularViewer.jsx`, `MolecularRenderPanel.test.jsx`, `MolecularViewer.test.jsx`. Not read: the CSS (classes inspector, figure-workspace, viewer-controls, muted, field-note, receipt-metadata), `renderEvents.js` (STAGE_LABELS) and `http.js`.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Load renders / Refresh renders | button (HeroUI secondary) | disabled when !token \|\| busy; enabled once a token is present; label switches to "Refresh renders" after the first successful load (jobs !== null) | MolecularRenderPanel.jsx:123 | Its success is what unlocks the chain fields and Render structure; nothing near those fields says so. Proposal: rename "Load renderer and saved renders"; note "Choose Load renders first" inside the chain fieldset. |
| Coordinate file | file input (accept .cif,.mmcif,.pdb, aria-required) | locked while busy or no token (fieldset :126); on change the file is kept for submit; if size <= max_source_bytes the text is read and shown in the viewer at once; oversize files are silently not shown until submit reports the limit | MolecularRenderPanel.jsx:127 | An oversize or wrong-type file gives no feedback until Render structure is pressed. Proposal: adjacent note on change "This file is {size} bytes; the limit is {N} bytes." / "Choose a .cif, .mmcif or .pdb file." |
| Antibody chains | text input (required, placeholder "A, B") | locked while busy or until capabilities.configured is true (fieldset :133); stays locked when the renderer is unavailable | MolecularRenderPanel.jsx:134 | Locked before Load renders with no adjacent reason (only hint is the note at :124). Proposal: inside the fieldset "Unlocks once Load renders reports the local renderer is configured." |
| Antigen chains | text input (required, placeholder "C") | same fieldset lock as Antibody chains | MolecularRenderPanel.jsx:135 | Same locked state without reason. Proposal: same note. |
| Render as a declared change of {id8}… (same coordinates; the earlier render is kept) | checkbox | hidden until the selected job is completed and carries settings; unchecking clears the declared effects | MolecularRenderPanel.jsx:149 | Does not say the same coordinate file must be chosen again for Render structure to enable. Proposal: label "…— same coordinates (choose the same file again); the earlier render is kept". |
| Render structure | submit button | disabled when busy, no token, renderer not configured, no file, empty antibody or antigen field, or the selected job is queued/rendering; enabled when all of those hold | MolecularRenderPanel.jsx:154 | Seven disabling conditions, none explained next to the button; after selecting a queued render it greys with no reason. Proposal: adjacent note while disabled "Needs a loaded renderer, a coordinate file, antibody and antigen chains, and no render in progress." |
| View selected render | button (ghost) | hidden until a job is selected; always enabled; no visible effect when the details are already open | MolecularRenderPanel.jsx:158 | No-op when details are already shown. Proposal: hide while showRender is true. |
| Check packages / Probe again | button (secondary, sm) | disabled when !token or softwareBusy; no in-progress text; errors go to the shared alert at :157, outside and above the Packages details | MolecularRenderPanel.jsx:163-168 | Error copy not adjacent; no busy status text. Proposal: inside Packages `<p role="status">Checking packages…</p>` while busy and `<p role="alert">Package check failed: {message}</p>` on error; label "Check again". |
| Close render | button (secondary, sm) | always enabled while the details are open | MolecularRenderPanel.jsx:221 | Closes the details panel, not the render. Proposal: "Close details". |
| Assembly (viewer) | text input | always enabled; each keystroke rebuilds the structure; empty value snaps back to asymmetric_unit | MolecularViewer.jsx:201 | Per-keystroke full re-parse and flashing "The coordinates could not be shown" errors for partial IDs; cannot be cleared; same accessible name as MolecularRenderPanel.jsx:144. Proposal: commit on Enter/blur; label "Viewer assembly (press Enter to apply)". |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| MolecularWorkspace.jsx:71 | Render a complex from your own coordinates with the local pipeline. | Render an antibody–antigen complex from your own coordinates with the local pipeline. |
| MolecularWorkspace.jsx:67 | renderJob.status === 'completed' ? 'render complete' : stageLine(renderJob) \|\| renderJob.status | … : stageLine(renderJob) \|\| 'render ' + renderJob.status (shows "render queued", "render failed") |
| MolecularRenderPanel.jsx:9 | Samples / Seed | Render samples / Random seed |
| MolecularRenderPanel.jsx:12 | Invalid molecular artifact address. | This file is not served by the local molecular API. |
| MolecularRenderPanel.jsx:32 | stages.map(s => STAGE_LABELS[s.stage] \|\| s.stage).join(' → ') | Fallback `s.stage.replace(/_/g, ' ')` |
| MolecularRenderPanel.jsx:73 | 'Status unavailable: ' + reason.message + '. Select the render again to retry.' | Render status could not be fetched: {message}. Select the render again to retry. |
| MolecularRenderPanel.jsx:106 | Enter 1–16 author chains for each partner. | Enter 1–16 chain IDs for the antibody and 1–16 for the antigen. |
| MolecularRenderPanel.jsx:123 | Load renders / Refresh renders | Load renderer and saved renders / Refresh |
| MolecularRenderPanel.jsx:124 | Local renderer ready. | Local renderer configured. |
| MolecularRenderPanel.jsx:124 | Load with your operator token. | Enter your operator token, then choose Load renders. |
| MolecularRenderPanel.jsx:131 | 'PDB or mmCIF, up to ' + N + ' bytes; shown in the viewer at once, rendered only with the local pipeline.' | PDB or mmCIF, up to {N} bytes. Shown in the viewer at once; rendered only by the local pipeline. |
| MolecularRenderPanel.jsx:136 | Author chain IDs, separated by commas. | Chain IDs as written in the file (author IDs), separated by commas. |
| MolecularRenderPanel.jsx:140 | 'default (' + (capabilities?.presets?.default \|\| 'publication_white') + ')' | 'default (' + name.replace(/_/g, ' ') + ')' |
| MolecularRenderPanel.jsx:143 (fallback note) | Panel background, finish and colours are presentation; envelope and stick presets also change the drawn mesh (a change of scientific depiction); never the coordinates or the contacts. | Presets change the panel background, finish and colours (presentation). Envelope and stick presets also change the drawn mesh (scientific depiction). No preset changes the coordinates or the contacts. |
| MolecularRenderPanel.jsx:144 / MolecularViewer.jsx:201 | Assembly (both) | Keep "Assembly" here; rename the viewer input "Viewer assembly (press Enter to apply)" |
| MolecularRenderPanel.jsx:145 | Use asymmetric_unit or an assembly ID recorded in the source. | Use asymmetric_unit (no symmetry operators applied) or an assembly ID listed in the file. |
| MolecularRenderPanel.jsx:149 | Render as a declared change of {id8}… (same coordinates; the earlier render is kept) | Render as a declared change of {id8}… — same coordinates (choose the same file again); the earlier render is kept |
| MolecularRenderPanel.jsx:151 | Declare every effect the new settings have; the server derives the actual effects and refuses a declaration that is narrower than them. | Tick every effect the new settings have. The server derives the actual effects and refuses the render if your declaration is narrower. |
| MolecularRenderPanel.jsx:158 | View selected render | Hide while the details are open, or "Show render details" |
| MolecularRenderPanel.jsx:159 | (live ? 'live' : 'polling') + ' · ' + (stageLine(job) \|\| 'waiting for the pipeline') | 'live updates · ' / 'checking every 1.5 s · ' + stage line or 'waiting for the pipeline' |
| MolecularRenderPanel.jsx:160 | `<h2>Recent renders</h2>` | `<h3>Recent renders</h3>` |
| MolecularRenderPanel.jsx:162 | The catalogue of structural-biology and cheminformatics software the workbench knows, with what a probe observed: presence, never qualification; nothing is installed. | Structural-biology and cheminformatics software the workbench knows about, and what a probe observed. Presence only, not whether a package works. Nothing is installed. |
| MolecularRenderPanel.jsx:168 | Check packages / Probe again | Check packages / Check again |
| MolecularRenderPanel.jsx:169 | `<div … aria-label="Software catalogue">` | `<div role="group" aria-label="Software catalogue">` |
| MolecularRenderPanel.jsx:221 | Close render | Close details |
| MolecularRenderPanel.jsx:222 | 'Declared change of render ' + id8 + '…: declared ' + … + '; derived ' + … + '; checks obliged: ' + … | Change of render {id8}…. Declared: {declared or 'nothing'}. Derived by the server: {derived} (changed: {fields}). Required checks: {checks}. |
| MolecularRenderPanel.jsx:222 | 'Job ' + job.id + ' · ' + contact_pairs + ' residue pairs' | Job {id} · {n} contact residue pairs |
| MolecularRenderPanel.jsx:223 | Rendering does not establish scientific validity, visual acceptance, or publication approval. The surface is a Gaussian atomic envelope; dashed distances indicate proximity, not hydrogen bonds or affinity. | A render does not establish scientific validity, visual acceptance or publication approval. The surface is a Gaussian envelope around the atoms, not a measured surface; dashed lines show proximity only, not hydrogen bonds or affinity. (render without the muted class) |
| MolecularRenderPanel.jsx:226 | This render was cancelled. No completed artifacts are available. | This render was cancelled. No output files are available. |
| MolecularRenderPanel.jsx:229 | The completed job did not include a collage preview. | The completed job has no preview image (collage.png). |
| MolecularRenderPanel.jsx:229 | Loading authenticated collage… | Loading preview… |
| MolecularRenderPanel.jsx:230 | `<h2>Artifacts & provenance</h2>` | `<h3>Output files & provenance</h3>` |
| MolecularRenderPanel.jsx:230 | The manifest records the source, chain selection and render settings. | manifest.json records the source file, chain selection and render settings. |
| MolecularRenderPanel.jsx:233 | Artifact hashes | File hashes (SHA-256) |
| MolecularViewer.jsx:15 | bfactor (option text) | B-factor (keep key bfactor) |
| MolecularViewer.jsx:162-163 | 'Loaded ' + n + ' atoms; ' + k + ' contact residues from the provisional\|verified scene highlighted; coordinates unchanged.' | Loaded {n} atoms. {k} contact residues highlighted from provisional contacts (render still running); coordinates unchanged. / …from verified contacts (render complete); coordinates unchanged. / Loaded {n} atoms. No contacts in the provisional\|verified set; coordinates unchanged. |
| MolecularViewer.jsx:194 | `<div className="viewer" aria-label="Molecular viewer">` | add `role="group"` |
| MolecularViewer.jsx:201 | Assembly | Viewer assembly (press Enter to apply) |
| MolecularViewer.jsx:202 | contacts | Show contacts |
| MolecularViewer.jsx:203 | waters | Show waters |
| MolecularViewer.jsx:204 | spin | Spin |
| MolecularViewer.jsx:206 | Save view | Save view as PNG |

#### Keep as is

- Rendering does not establish scientific validity, visual acceptance, or publication approval (meaning must stay; MolecularRenderPanel.jsx:223).
- The surface is a Gaussian atomic envelope; dashed distances indicate proximity, not hydrogen bonds or affinity (:223).
- Coordinates are shown exactly as uploaded and are never changed by the viewer, a preset or a contact overlay ("coordinates unchanged", "never the coordinates or the contacts", "same coordinates").
- Contacts are provisional while the pipeline still renders and verified once the artifacts are collected; the status line must keep naming which set is highlighted (MolecularViewer.jsx:162-163, MolecularWorkspace.jsx:54-55).
- Author chain IDs (auth_asym_id) are what the pipeline matches; residue identity is "chain:seq[icode]" e.g. "A:100B" (MolecularViewer.jsx:26-30).
- Coordinates are rendered only with the local pipeline / local Blender renderer; no packaged example is served (MolecularRenderPanel.jsx:131, MolecularWorkspace.jsx:14-16).
- Package catalogue reports presence only, never qualification; nothing is installed; an environment seen is not the package (MolecularRenderPanel.jsx:162, :172; server licence_note shown verbatim).
- Declared-change rule: the server derives the actual effects and refuses a declaration narrower than them; the earlier render is kept (:149, :151, :222 change record with declared/derived/changed fields/required checks).
- Limits and units: file up to capabilities.limits.max_source_bytes (fallback 750,000 bytes); .cif/.mmcif/.pdb only; 1–16 chains per partner, antibody and antigen chains disjoint; Contact cutoff in Å (0.1–10, step 0.1); Width in px (640–2400); Samples 1–128; Seed 0–2147483647; Model index zero-based 0–99; Assembly max 64 chars, asymmetric_unit or an assembly ID from the source.
- Provenance facts: Job id, Uploaded source SHA-256, per-asset SHA-256 and byte counts, contact residue-pair count, the manifest recording source, chain selection and render settings.
- Job-state facts: cancelled render has no completed artifacts; interrupted render must be resubmitted as a new job; status updates automatically (events, else polling every 1.5 s) and the details view can be closed while it runs.
- Viewer facts: "Loaded N atoms", WebGL requirement, viewer errors quoted from Mol* messages; Save view exports the current canvas as PNG only.
- Server-supplied text rendered verbatim by :143, :172 and :224 (preset descriptions, catalogue detail/note, job.error) is authored server-side, not in these files.

### 2.5 BioArt

Files: `apps/arc-science/web/src/BioArtWorkspace.jsx`, `BioArtWorkspace.test.jsx`. Not read: CSS, `http.js`, `icons.js`; responsive items are inferred from markup.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Permit NIH network access for the next search or inspection | checkbox (one-use consent → allow_egress:true) | unchecked by default; disabled while busy; auto-unchecked the moment Search, Inspect or a result button is pressed (task() calls clearConsent before the request), regardless of outcome | BioArtWorkspace.jsx:101 | Clearing before the request means a failed request still consumes consent; the L37 error explains this, the checkbox does not. Proposal: keep the label; the L103 rewrite ("…then clears") covers it. |
| Search NIH BioArt | button (primary, icon 'search') | disabled while busy; disabled when token is empty (no adjacent reason); disabled when query is blank | BioArtWorkspace.jsx:102 | Locked without token and no visible reason; label implies a live search that L104 says cannot run here. Proposal: label "Search cached BioArt"; add the token field-note after L107. |
| Open NIH search | link (new tab, rel=noreferrer, href built from query) | always enabled | BioArtWorkspace.jsx:104 | Missing ↗ marker used by the sibling link. Proposal: "Open NIH search ↗". |
| NIH entry ID | numeric text input (inputMode numeric, aria-describedby help, aria-invalid when non-empty and invalid) | enabled; disabled while busy; invalid for '', '0', '-1', '1.5', '1e2', 'BIOART-000018', unsafe integers (test L61) | BioArtWorkspace.jsx:105 | Invalid state has no adjacent error text; only the help line and aria-invalid. Proposal: after L106 `{entryId.trim()!==''&&!validEntryId&&<p role="alert" className="field-note">Enter only the number, for example 18.</p>}`. |
| Inspect entry | button (secondary, no icon) | disabled while busy; disabled when token is empty (no adjacent reason); disabled when entry ID invalid | BioArtWorkspace.jsx:107 | Locked without token and no visible reason; only action button without an icon. Proposal: token note above; optionally an icon for consistency. |
| Result row `{title} · BIOART-000018` | button (ghost) list, one per hit | hidden until a search returns hits; disabled while busy; not gated on token (unlike Search/Inspect) | BioArtWorkspace.jsx:110 | If the token is cleared after a search, rows stay enabled and clicking yields the locked error. Proposal: `isDisabled={busy\|\|!token}`. |
| Format | select | hidden until entry; disabled while busy; options = formats present in any representation; state resets to 'SVG' on inspect (L79) even when the entry has no SVG, leaving the select with no matching option | BioArtWorkspace.jsx:119 | Entry without SVG (or with no representations) leaves a mismatched/empty select and a disabled "Fetch verified SVG" with no explanation. Proposal: on inspect `setFormat(formatOrder.find(f=>data.representations.some(i=>f in i.files))\|\|'SVG')`; render `{formats.length===0&&<p className="field-note">This entry lists no downloadable files.</p>}` after L119. |
| Representation | select | hidden until entry; disabled while busy; 'Automatic' default; per-group options disabled with ' · format unavailable' when the group lacks the chosen format; changing it clears receipt, import record and fetch consent | BioArtWorkspace.jsx:120 | Term undefined; competes with 'group'/'variant'. Proposal: label "Variant". |
| Fetch verified {format} | button (primary, icon 'cloud-download') | hidden until entry; disabled while busy; disabled when the chosen format is not in formats (no adjacent reason); not gated on token (error appears after click instead) | BioArtWorkspace.jsx:122 | Confusing locked state when the format is unavailable; label claims verification before it happens. Proposal: `Fetch and verify {format}`; the Format note covers the locked state. |
| Import verified SVG / `${format} import unavailable` | button (primary, icon 'import') | hidden until receipt; disabled while busy; disabled and relabelled when !receipt.import_eligible (non-SVG, or an unsupported SVG); success renders "Imported asset …" | BioArtWorkspace.jsx:131 | For an unsupported SVG the label gives no reason; receipt.limitation (the reason) is rendered in the notes block above, not adjacent. Proposal: label `Import unavailable · ${receipt.format==='SVG'?'this SVG is not supported':'SVG only'}`; move `{receipt.limitation&&<p>{receipt.limitation}</p>}` directly under the actions row. |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| BioArtWorkspace.jsx:25 (sanitizeBioArtDetail fragment) | an operator-supplied browser snapshot | a browser page snapshot, which this app cannot provide; use Open NIH search and inspect by entry ID |
| BioArtWorkspace.jsx:36-37 | No cached BioArt source is available yet. Permit NIH network access for ${target}, then try again. Consent is used once and clears after the request. | `No cached BioArt ${recovery==='fetch'?'file':'metadata'} is available yet. Permit NIH network access for ${target}, then try again. Consent is used once and clears after the request.` (update test L129 or keep) |
| BioArtWorkspace.jsx:40-41 (backend passthrough, e.g. "BioArt schema drift: …") | {sanitized detail} | Before the passthrough: `if (/schema drift/i.test(status.detail)) return 'NIH returned metadata in an unexpected shape, so this entry could not be read. Try again later or inspect it by entry ID.'` (update test L107) |
| BioArtWorkspace.jsx:58 | This verified source is download-only; no browser preview is permitted. | This file is download-only; the local service does not provide a browser preview for it. |
| BioArtWorkspace.jsx:59 | Loading the authenticated preview… | Loading preview… |
| BioArtWorkspace.jsx:98 | Source vectors. | NIH BioArt illustrations. |
| BioArtWorkspace.jsx:99 | Recorded metadata first; a live NIH request only with consent. | Find NIH BioArt illustrations from the local cache, or from NIH with your consent. |
| BioArtWorkspace.jsx:102 | Search NIH BioArt | Search cached BioArt (update tests L88, L106, L127, L147, L150) |
| BioArtWorkspace.jsx:103 | Consent covers one action. Cache hits stay offline. | Consent covers one search or inspection, then clears. Entries already in the local cache never contact NIH. |
| BioArtWorkspace.jsx:104 | NIH’s live search currently requires browser rendering. Open NIH search to find an entry ID, then inspect it here. | NIH’s live search needs browser rendering, which this app cannot do. Open NIH search to find an entry ID, then enter it below. |
| BioArtWorkspace.jsx:104 (link) | Open NIH search | Open NIH search ↗ (test L99 uses the exact name; update it, or drop the arrow from L115) |
| BioArtWorkspace.jsx:106 | Enter the positive whole-number ID. For BIOART-000018, enter 18. | Enter only the number. For BIOART-000018, enter 18. |
| BioArtWorkspace.jsx:108 | BioArt request in progress… | Keep the text; also render it after the actions row at L131 and after the Fetch button at L122 |
| BioArtWorkspace.jsx:110 | No matching entries in the returned metadata. | No entries match this query in the cached metadata. (update test L111) |
| BioArtWorkspace.jsx:115 | `<h1>{entry.title}</h1>` | `<h2>{entry.title}</h2>` |
| BioArtWorkspace.jsx:115 (chip) | NIH metadata: {entry.license} | License per NIH: {entry.license} |
| BioArtWorkspace.jsx:115 (chip) | Verified ${receipt.format} · group ${receipt.representation_id} \| Source not yet fetched | Verified ${receipt.format} · variant ${receipt.representation_id} \| File not fetched yet |
| BioArtWorkspace.jsx:120 (label) | Representation | Variant |
| BioArtWorkspace.jsx:120 (option) | Automatic · neutral compatible {format} | Automatic · grey or black-and-white variant with {format} |
| BioArtWorkspace.jsx:120 (option) | {item.caption} · format unavailable | {item.caption} · no {format} file |
| BioArtWorkspace.jsx:122 | Fetch verified {format} | Fetch and verify {format} |
| BioArtWorkspace.jsx:123 | Automatic selection prefers an explicitly grey, grayscale, or black-and-white representation that contains the requested format. | Automatic picks a variant labelled grey, grayscale, or black-and-white that has this format. |
| BioArtWorkspace.jsx:126 | Group {item.group_id} · {formats} | Variant {item.group_id} · {formats} |
| BioArtWorkspace.jsx:127 (aria-label) | Verified receipt | Verified fetch record |
| BioArtWorkspace.jsx:128 | Receipt verified | File fetched and verified |
| BioArtWorkspace.jsx:129 (dt) | Source SHA-256 / Source page SHA-256 / Size / Receipt | File SHA-256 / NIH page SHA-256 / Size / Receipt ID |
| BioArtWorkspace.jsx:130 | Rights metadata has not been independently verified. Review the NIH entry and retained credit before publication. | Reuse rights are recorded from the NIH entry, not independently verified. Review the NIH entry and the retained credit before publication. (and drop the footer L135) |
| BioArtWorkspace.jsx:130 | Scientific validity is not established by metadata parsing, file validation, or visual quality. | File checks and appearance do not establish scientific validity. |
| BioArtWorkspace.jsx:130 | {receipt.limitation} (in the notes block) | Same text, moved directly below the actions row (after L131) |
| BioArtWorkspace.jsx:131 | Download verified source | Download verified file |
| BioArtWorkspace.jsx:131 (disabled) | ${receipt.format} import unavailable | Import unavailable · ${receipt.format==='SVG'?'this SVG is not supported':'SVG only'} |
| BioArtWorkspace.jsx:132 | Imported asset {imported.asset_id} + `<code>{imported.asset_manifest}</code>` | Imported asset {imported.asset_id} then "Manifest: {imported.asset_manifest}" |
| BioArtWorkspace.jsx:135 | Reuse rights are not inferred; the entry's own credit and license are recorded. | Delete; the merged caveat at L130 carries the commitment where it matters. |

#### Keep as is

- One-use NIH consent semantics: checkbox labels "Permit NIH network access for the next search or inspection" and "Permit NIH network access for this fetch" map to allow_egress:true for exactly one request and the checkbox clears when the action starts (tests L29-50, L75-92).
- "Consent is used once and clears after the request" and "Consent covers one action" — commitment must survive any rewording.
- "Cache hits stay offline" — cached entries never trigger a network request even with consent.
- Live NIH search cannot run in this app ("requires browser rendering"); the Open NIH search link (https://bioart.niaid.nih.gov/discover?q=…&sort=relevance, rel=noreferrer, token never in URL) is the sanctioned path (test L94-116).
- "Rights metadata has not been independently verified. Review the NIH entry and retained credit before publication." / "Reuse rights are not inferred; the entry's own credit and license are recorded." — merge, never drop the commitment.
- "Scientific validity is not established by metadata parsing, file validation, or visual quality."
- receipt.limitation must always be rendered when present.
- Preview eligibility caveat: "download-only; no browser preview" when !preview_eligible.
- Automatic-selection rule: prefers an explicitly grey, grayscale, or black-and-white representation that contains the requested format.
- Facts/identifiers: BIOART-000018 zero-padded display, entry ID = positive safe integer (18 for BIOART-000018), SHA-256 of file and of source page, size in bytes, receipt ID, file ID, representation/group ID, license/creator/credit/collection/citation values, imported asset ID and manifest.
- Error hygiene pinned by tests: never show "Request failed", status codes (401/403/409), "Failed to fetch", "--allow-egress", "--search-html"; 401/403 → operator-token message; network failure → local-service message; 409 "Missing or stale cache" → one-use consent recovery.
- Exact strings pinned by BioArtWorkspace.test.jsx (change only with the test): 'NIH entry ID', 'Inspect entry', 'Search NIH BioArt', 'BioArt search query', 'Open NIH search', 'Permit NIH network access for the next search or inspection', 'BioArt is locked. Enter a valid operator token in the header, then try again.', 'Arc Science cannot reach the local BioArt service. Check that the desktop service is running, then retry.', 'No cached BioArt source is available yet', 'Consent is used once and clears after the request', regex /NIH.*search.*browser rendering/, 'BioArt schema drift' passthrough, absence of 'No matching entries in the returned metadata.' after a failed search.
- No localStorage/sessionStorage use; NATIVE_SESSION sentinel sends no Authorization header (tests L48-49, L156-164).

### 2.6 Prose

Files: `apps/arc-science/web/src/ProseWorkspace.jsx`, `ProseWorkspace.test.jsx`. Not read: the CSS behind .research-workspace/.record/.prose-output and `./http` apiFetch; server copy is quoted only as the test file mocks it.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Show rules and detection terms / Reload rules | button (secondary, label toggles once rules are loaded) | disabled when busy or no token; on success fills the detection note (:80), unlocks the detection consent (:81), shows the collapsed Rules details at the bottom of the results (:125) | ProseWorkspace.jsx:67 | The rules panel it reveals is in the far column and collapsed; nothing near the button says where the result went. Proposal: label "Load rules and detection details"; show "Rules loaded — see the list under the results." as the :84 status on success. |
| I consent to sending this text to the prose seat's provider for this one request. | checkbox | enabled by default (does not depend on rules); disabled while busy; auto-unticked when a seat request starts, success or failure (:50); unticked on credential change | ProseWorkspace.jsx:73 | Unticks silently after each send; no adjacent text explains it beyond "for this one request". Proposal: append "only; the box clears after each send." to the label. |
| Show the behaviour / Hide behaviour | button (ghost, small; label toggles) | disabled when busy or no token; Show fetches /behaviour and opens the Behaviour details (:110); Hide clears it without a request (:53) | ProseWorkspace.jsx:76 | Label pair inconsistent. Proposal: "Show behaviour text" / "Hide behaviour text". |
| I consent to sending this text to api.edgeshop.ai for this one request. | checkbox | locked (disabled) until the rules are loaded and detection.enabled is true; disabled while busy; auto-unticked when a detect request starts, success or failure (:45; tests :138, :160); unticked on credential change | ProseWorkspace.jsx:81 | Locked with the only explanation being the third branch of :80, which does not say the box is locked or where the load button is. Proposal: note "Load the rules (‘Show rules and detection terms’, above) to see where the text would be sent; consent unlocks once they are loaded." |
| Detect (sends text) | button (secondary) | disabled when busy, no token, consent unticked, or text.length < 20 (hard-coded; whitespace counts, unlike the trim() used by the other buttons); error alert at :85; consent is still spent | ProseWorkspace.jsx:82 | Stays disabled for short text with no adjacent reason; minimum is a literal 20 while the server reports detection.bounds.min_chars. Proposal: `text.trim().length < (detection?.bounds.min_chars ?? 20)` and " Detect needs at least ${detection.bounds.min_chars} characters." in the :80 note. |
| (error alert) | role=alert live region | shown when the last request threw (e.message); cleared when the next request starts (:36); not shown for aborted requests (:38) | ProseWorkspace.jsx:85 | One alert for six actions, placed after both fieldsets. Proposal: render under the group that failed, prefixed with the action name. |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| ProseWorkspace.jsx:59 | PROSE / CONTROL | PROSE |
| ProseWorkspace.jsx:60 | A rule-based rewrite on this machine that leaves numbers, identifiers, citations, units and code untouched. | Rewrite and diagnose run on this machine. The seat rewrite and third-party detection send the text elsewhere and ask for consent every time. No rewrite changes protected spans (numbers, identifiers, citations, units, code; ‘Show rules’ lists the exact classes). |
| ProseWorkspace.jsx:63 | `${text.length.toLocaleString()} / 20,000 characters.` | `${text.length.toLocaleString()} / ${(20000).toLocaleString()} characters.` |
| ProseWorkspace.jsx:67 | Show rules and detection terms / Reload rules | Load rules and detection details / Reload rules (update ProseWorkspace.test.jsx:127, 155) |
| ProseWorkspace.jsx:69 | Seat rewrite | Seat rewrite (the AI model chosen in Settings) |
| ProseWorkspace.jsx:70 | Sends the text to the prose seat configured in Settings and asks for its edit under the humane-prose behaviour; every protected span must come back byte for byte or nothing is returned. | Sends the text to the AI model chosen in Settings (the ‘prose seat’). The seat edits under fixed instructions, the humane-prose behaviour (‘Show the behaviour’ below). If any protected span does not come back byte for byte, nothing is returned. |
| ProseWorkspace.jsx:73 | I consent to sending this text to the prose seat's provider for this one request. | I consent to sending this text to the prose seat's provider for this one request only; the box clears after each send. |
| ProseWorkspace.jsx:76 | Show the behaviour / Hide behaviour | Show behaviour text / Hide behaviour text (update ProseWorkspace.test.jsx:69, 71) |
| ProseWorkspace.jsx:79 | Third-party detection | Third-party AI-text detection |
| ProseWorkspace.jsx:80 (branch 3) | Load the rules to see where the text would be sent. | Load the rules (‘Show rules and detection terms’, above) to see where the text would be sent; consent unlocks once they are loaded. |
| ProseWorkspace.jsx:80 (branch 1) | Sends the text to ${recipient} (${detectors}); ${min}–${max} characters. | Same, plus " Detect needs at least ${detection.bounds.min_chars} characters." |
| ProseWorkspace.jsx:81 | I consent to sending this text to api.edgeshop.ai for this one request. | `I consent to sending this text to ${detection?.recipient \|\| 'api.edgeshop.ai'} for this one request only; the box clears after each send.` |
| ProseWorkspace.jsx:84 | Prose request in progress… | Rewriting locally… / Diagnosing locally… / Loading rules… / Sending the text to the prose seat… / Sending the text to api.edgeshop.ai… |
| ProseWorkspace.jsx:85 | {error} | Prefixed with the action and rendered under that group: "Rewrite with the prose seat failed: …" / "Detect failed: …" / "Rewrite locally failed: …" |
| ProseWorkspace.jsx:91 | `${edit_categories.join(' · ') \|\| 'No edit category indicated'} · ${protected_count} protected spans` | `… · ${n} protected ${n === 1 ? 'span' : 'spans'}` |
| ProseWorkspace.jsx:93 | Style words | Overused style words |
| ProseWorkspace.jsx:94 | Formulaic frames | Formulaic frames (e.g. ‘it is important to note’) |
| ProseWorkspace.jsx:95 | `${sentences} sentences · mean ${mean_words} words · spread ${spread_words} · ${pct}% within 20% of the mean` | `${sentences} sentences · mean ${mean_words} words · spread ${spread_words} words · ${pct}% of sentences within 20% of the mean length` |
| ProseWorkspace.jsx:97 | Triplets · closing summaries · bullets → `${triplets.count} · ${closing.count} of ${closing.paragraphs} paragraphs · ${bullets.count}` | Three rows: "Lists of three" → `${triplets.count}`; "Paragraphs ending in a summary" → `${closing.count} of ${closing.paragraphs}`; "Bullet points" → `${bullets.count}` |
| ProseWorkspace.jsx:104 | `${status text} · ${protected_count} protected spans preserved · ${provider} ${requested_model} (observed …\|identity requested-only) · behaviour sent in the prompt (no system channel)` | h3 `${status text} · ${n} protected ${n===1?'span':'spans'} preserved`; muted line `Model: ${provider} ${requested_model} — ${observed_model ? 'the provider confirmed ' + observed_model : 'the provider did not report which model answered'}.${instruction_channel==='prompt' ? ' The behaviour text was sent inside the message; this seat takes no separate system instructions.' : ''}` (update ProseWorkspace.test.jsx:64, 98) |
| ProseWorkspace.jsx:110 | Behaviour ${behaviour.version} | Behaviour text (version ${behaviour.version}) |
| ProseWorkspace.jsx:113 | `${sum(edits.count)} edits` … `${protected_count} protected spans (${classes})` | `${n} ${n===1?'edit':'edits'}` and `${p} protected ${p===1?'span':'spans'} (…)` (update ProseWorkspace.test.jsx:114) |
| ProseWorkspace.jsx:115 | `${rule} ×${count}: “${before}” → “${after \|\| '∅'}”` | `${rule} ×${count}: “${before}” → ${after ? '“' + after + '”' : '(removed)'}` |
| ProseWorkspace.jsx:121 (dt) | ${type} | ${type} (raw fields as returned) |
| ProseWorkspace.jsx:126 | `${rule}: ${pattern} → “${replacement \|\| '∅'}”` | `${rule}: ${pattern} → ${replacement ? '“' + replacement + '”' : '(removed)'}` |

#### Keep as is

- Consent labels verbatim in commitment: "I consent to sending this text to the prose seat's provider for this one request." (jsx:73) and "I consent to sending this text to api.edgeshop.ai for this one request." (jsx:81); any rewording keeps "this text", the named recipient, and "this one request".
- "(sends text)" suffix on both egress buttons (jsx:75, 82).
- Consent is spent on every request whatever its outcome and the box unticks (jsx:44-46, 50; tests :68, :138, :160); allow_egress is true only when the box was ticked (jsx:46, 51).
- Detection note names the recipient, the detector list and the min–max character bounds from the server (jsx:80), and "Detection is switched off on this service." when disabled.
- Server refusal "The text would leave this machine for …" (consent_required, test:23, 36) and the evasion/impersonation refusal reason shown in the alert (test:88).
- Server caveats rendered per record: "not a human-authorship claim" (test:21, 39, 90); "establishes neither AI nor human authorship and has no bearing on any release decision" (test:26); "Not an authorship estimate, and not a prediction of what any detector would say" (test:33).
- Protection guarantee: "every protected span must come back byte for byte or nothing is returned" (jsx:70) and protected classes numbers, identifiers, citations, units, code (jsx:60), with protected_count and protected_classes shown per result (jsx:91, 104, 113, 127).
- Transport transparency facts (jsx:104): provider, requested model, observed model when reported, the fact that the identity was only requested when not, and that the behaviour went in the prompt when there is no system channel.
- Stale semantics: a result is shown for the text (and instructions) it came from and says so once they change (jsx:54-55, 90, 103).
- Detection receipt: service, returned and missing detector types, raw per-detector fields, Text SHA-256 and Response SHA-256 (jsx:120-122).
- Version identifiers: rules_version, protection_version (jsx:116), behaviour version (jsx:110), diagnostics categories and counts (jsx:91-97).
- "Facts needed from the author:" with the seat's bracketed placeholders (jsx:107).
- Limits: 20,000-character text box (jsx:62-63), 2,000-character instructions (jsx:72), 20-character detect minimum (jsx:82).
- Header commitment that neither result bears on a release decision and nothing here is an authorship or validity claim (jsx:5-8, test:26) — no string may be changed to claim human authorship, detector evasion, novelty or production readiness.

### 2.7 Settings

Files: `apps/arc-science/web/src/SettingsWorkspace.jsx`, `SettingsWorkspace.css`, `SettingsWorkspace.test.jsx`.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Load settings / Reload | button | enabled: token present and not busy; disabled: busy or no operator token (locked card at :207 explains); label "Load settings" before first load, "Reload" after | SettingsWorkspace.jsx:204 | Reload overwrites the draft with the loaded file; unsaved edits are lost with no adjacent warning (only the 409 card mentions it). Proposal: `{dirty ? 'Reload (discards unsaved edits)' : 'Reload'}`. |
| Save | button | enabled: loaded, unsaved edits, writable, no seat issues; disabled: busy \| no edits \| read only \| any seat issue; reasons live elsewhere (status line :194/:201, validation box :216) | SettingsWorkspace.jsx:205 | Disabled with no adjacent reason. Proposal: adjacent line "Save is off until the seat issues under Research Models are fixed." or "Read only: the supervisor cannot write this file." |
| {Role} provider | select (x5) | enabled unless read only; changing it resets effort to the first allowed level when the current one is unsupported | SettingsWorkspace.jsx:223 | "-" is the empty option. Proposal: option text "None". |
| {Role} effort | select (x5) | enabled unless read only; locked at 'medium' when provider/auth has no effort control (Gemini CLI, OpenClaw API); aria-invalid + red border when the stored level is unsupported; extra "{level} (unsupported)" option shown; note under it (:237) always visible | SettingsWorkspace.jsx:234 | Locked select shows 'medium' though it means provider default; acceptable once :95 is reworded; note redundant when the select already lists only accepted levels. |
| {Role} credential | text input (x5) | enabled: auth = API credential and not read only; disabled: auth = CLI login (no adjacent reason; placeholder still shows the role key) | SettingsWorkspace.jsx:248 | Confusing locked state. Proposal: placeholder "not used with CLI login" while disabled; "file name" otherwise. |
| Research Models / Connections / Rendering / Viewer / Advanced | details/summary toggle (x5) | Research Models open by default; others collapsed until clicked; '+'/'-' glyph via CSS ::before; native marker hidden | SettingsWorkspace.jsx:312 | No :focus-visible rule in this stylesheet; global styles not read, so keyboard focus visibility is unverified. Proposal: `.settings-section > summary:focus-visible { outline: 2px solid #315d7c; outline-offset: 2px; }`. |
| Probe {provider} | button (one per CLI transport) | hidden until CLI transports exist; disabled until consent is ticked or while busy; result written into "Last probe"; failure shown in the sidebar as "Settings Request Failed" | SettingsWorkspace.jsx:342 | Raw provider key in label; error copy not adjacent. Proposal: "Probe Anthropic"; failure text under the button "Probe Anthropic did not complete. Your draft was kept." |
| List MCP tools | button | enabled once settings are loaded (the !snapshot guard is never true inside this branch); disabled while busy; report appears below after success; failure goes to the sidebar | SettingsWorkspace.jsx:259 | Launches each enabled server locally without saying so; verb differs from "Check ACP agents". Proposal: "Check MCP servers" with note "Starts each enabled server, asks it to list its tools, and sends no mission data." |
| Check ACP agents | button | same as List MCP tools | SettingsWorkspace.jsx:267 | Proposal: note "Starts each enabled agent, asks it to initialise, and sends no mission data." |
| Arguments ({kind} args {n}) | text input | enabled unless read only; value split on whitespace on every keystroke | SettingsWorkspace.jsx:360 | No format hint; a quoted argument with spaces is impossible. Proposal: placeholder "space-separated". |
| Remove | ghost button (per row) | enabled unless read only; removes the row immediately; undo only by Reload (which discards all edits) | SettingsWorkspace.jsx:365 | Immediate removal, undo discards all other edits. |
| {provider} CLI | text input (x4) | enabled unless read only for anthropic/openai/gemini; openclaw row always disabled and empty with no reason | SettingsWorkspace.jsx:293 | Dead/locked control; readiness :118 can tell the user to configure it. Proposal: `<span class="muted">not applicable</span>` for the OpenClaw CLI cell. |
| isolated | checkbox | enabled unless read only; only in the openclaw row | SettingsWorkspace.jsx:294 | Undefined term. |
| Third-party AI detection may run after request-level consent. | checkbox (prose detection switch) | enabled unless read only; unchecked in fixture | SettingsWorkspace.jsx:297 | Label does not say what ticking does. |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| SettingsWorkspace.jsx:10 | Planner \| Reviewer (QA) \| Falsifier \| Vision \| Prose | Keep the labels; add one defining line to the Research Models summary: "Planner plans, Reviewer (QA) checks, Falsifier tries to disprove, Vision reads images, Prose writes." (confirm with the owner) |
| SettingsWorkspace.jsx:11 | - \| Anthropic \| OpenAI \| Gemini \| OpenClaw | None \| Anthropic \| OpenAI \| Gemini \| OpenClaw |
| SettingsWorkspace.jsx:24-26 | cartoon \| … \| ball_and_stick \| … \| secondary_structure \| bfactor \| … \| asymmetric_unit \| assembly_1 \| assembly_2 \| … | Ball and stick \| Secondary structure \| B-factor \| Asymmetric unit \| Assembly 1 \| Assembly 2 (others capitalised); keep stored values |
| SettingsWorkspace.jsx:36 | Unlock Settings | Unlock settings |
| SettingsWorkspace.jsx:38 | Settings is locked. Add an operator token before loading settings. | Settings are locked. Add an operator token first. |
| SettingsWorkspace.jsx:42 | Session Expired | Session expired |
| SettingsWorkspace.jsx:48 | Supervisor Settings Unavailable | Settings file not configured |
| SettingsWorkspace.jsx:49 | This service was started without a supervisor settings file. Start Arc Science from the native app or configure the service settings path, then reload. | No settings file was given to this service. Start Arc Science from the desktop app, or set the service settings path, then reload. |
| SettingsWorkspace.jsx:54 | Settings Changed Elsewhere | Settings changed elsewhere |
| SettingsWorkspace.jsx:55 | The saved revision is newer than the one you loaded. Your edits are still on screen; reload only after copying anything you want to keep. | A newer revision was saved since you loaded this one. Your edits are still on screen; copy anything you want to keep, then press Reload. |
| SettingsWorkspace.jsx:60 | Settings Need Attention | Settings were rejected |
| SettingsWorkspace.jsx:62 | Settings validation failed. Fix the highlighted values and retry. | Settings were not saved. The supervisor rejected them; see the reason above, fix it and save again. |
| SettingsWorkspace.jsx:66 | Service Unreachable | Service unreachable |
| SettingsWorkspace.jsx:72 | Settings Request Failed | Request failed |
| SettingsWorkspace.jsx:73 | The request did not complete. The current draft was kept. | {action} did not complete. Your draft was kept. (action = Save, Load settings, Probe Anthropic, Check MCP servers, Check ACP agents) |
| SettingsWorkspace.jsx:87 | Select a provider to check transport effort support. | Select a provider to see which effort levels it accepts. |
| SettingsWorkspace.jsx:90 | This provider/auth transport is not available. | providerLabel + ' has no ' + (cli ? 'CLI login' : 'API credential') + ' option.' e.g. "OpenClaw has no CLI login option." |
| SettingsWorkspace.jsx:95 | {Provider} {CLI\|API} has no per-call effort control; medium keeps the provider default. | {Provider} {CLI\|API} has no effort setting; the provider default is used (stored as medium). |
| SettingsWorkspace.jsx:101 | Supported here: {levels}. \| Supported here: {levels}. OpenAI can still refuse a level for a specific model. | Accepted: {levels}. \| Accepted: {levels}. OpenAI may still refuse a level for a specific model. — render only when the seat has no provider, is locked, or is invalid |
| SettingsWorkspace.jsx:110 | {Role}: {effort note} (renders "Planner: Supported here: minimal, low, medium, high.") | {Role}: effort {value} is not accepted for {Provider} {CLI login\|API}. Accepted: {levels}. (test :120) |
| SettingsWorkspace.jsx:118 | incomplete — CLI executable is not configured for this provider. | No CLI command is set for this provider (Advanced > CLI). OpenClaw: "OpenClaw has no CLI login. Choose API credential." |
| SettingsWorkspace.jsx:124 | configured — Configured, but CLI login state is not reported. \| not checked — Load connection state to check this CLI seat. | configured — CLI login state was not reported. \| not running — Differs from the running seat, or the seat is not running. Save, then Reload. |
| SettingsWorkspace.jsx:125 | not signed in — Configured CLI exists, but the provider session is not signed in. | not signed in — The CLI is present but not signed in to this provider. |
| SettingsWorkspace.jsx:126 | not probed — Signed-in CLI detected. Probe only with explicit consent. | not probed — Signed in. Probe from Connections (needs your consent; spends tokens). |
| SettingsWorkspace.jsx:128 | probe failed — Last probe reported at least one failed selector. \| probed — Last probe reached the configured selector. | probe failed — Last probe failed for at least one model/effort pair. \| probe ok — Last probe reached the configured model at the configured effort. |
| SettingsWorkspace.jsx:130 | configured — API credential is configured; no live inference was run. \| not checked — Load connection state to compare this API seat with the running route. | named — Credential file is named; not checked, and no call was made. \| not running — Differs from the running seat, or the seat is not running. Save, then Reload. |
| SettingsWorkspace.jsx:182 | Saved. Applied live: {list}. Stored for later loops: {list}. Restart required for {list}. | Saved. + (applied ? ' Applied now: {list}.' : '') + (pending ? ' Takes effect on the next run: {list}.' : '') + (restart ? ' Restart Arc Science to apply: {list}.' : '') |
| SettingsWorkspace.jsx:194 | Revision {12 hex} read only \| … unsaved edits \| … saved | Revision {12 hex} · read only \| · unsaved edits \| · saved (test :190 /Revision aaaaaaaaaaaa/ still matches) |
| SettingsWorkspace.jsx:198 | Settings are edited here and written back through the native supervisor with the revision you loaded. | Saving goes through the Arc Science desktop app (the supervisor) and is refused if the file changed since you loaded it, so nothing is overwritten. |
| SettingsWorkspace.jsx:201 | {path} - supervisor write access is unavailable | {path} · read only: the supervisor cannot write this file |
| SettingsWorkspace.jsx:204 | Load settings \| Reload | Load settings \| Reload (discards unsaved edits) — second form only while there are unsaved edits |
| SettingsWorkspace.jsx:205 | Save | Keep; adjacent line "Save is off until the seat issues under Research Models are fixed." / "Read only: the supervisor cannot write this file." |
| SettingsWorkspace.jsx:208 | Settings request in progress... | Request in progress… |
| SettingsWorkspace.jsx:214 | When the supervisor is unavailable, this page will show the recovery step instead of a raw service error. | (delete) |
| SettingsWorkspace.jsx:215 | Select the provider, model, auth method and reasoning effort for each role. | A seat is one role backed by one provider and model. Select the provider, model, sign-in method and reasoning effort for each seat. |
| SettingsWorkspace.jsx:220 | Seat \| Provider \| Model \| Effort \| Auth \| Credential \| Readiness | Seat \| Provider \| Model \| Effort \| Auth \| Credential file \| Readiness |
| SettingsWorkspace.jsx:248 | placeholder {role} | file name (when API credential) \| not used with CLI login (when disabled) |
| SettingsWorkspace.jsx:252 | Credentials name files written by arc-science credential --name NAME; CLI login uses the provider's own signed-in account. Effort a transport cannot express is refused by the supervisor, not rounded. | Credential: the name of a file created with `arc-science credential --name NAME`; no key is stored here. CLI login uses the account already signed in to that provider's CLI. An effort level the sign-in method cannot express is refused on save, not rounded. |
| SettingsWorkspace.jsx:255 | Review live seats, probe signed-in CLIs and manage consented MCP/ACP tools. | See which seats are running, probe signed-in CLIs, and manage the MCP servers and ACP agents missions may use. |
| SettingsWorkspace.jsx:256 | Load settings to inspect live connection state. | Connection state did not load. Press Reload to retry. |
| SettingsWorkspace.jsx:256 | No live seats are configured, so nothing is connected. | No seats are running, so there is nothing to check. |
| SettingsWorkspace.jsx:257 | MCP servers | MCP servers (Model Context Protocol) |
| SettingsWorkspace.jsx:259 | List MCP tools | Check MCP servers (tests :97, :158) |
| SettingsWorkspace.jsx:261 | SDK {version\|not installed} - consented: {list\|none} | MCP SDK {version\|not installed} · consented: {list\|none} |
| SettingsWorkspace.jsx:262 | {server}: failed - {error} | {server}: failed: {error} |
| SettingsWorkspace.jsx:264 | Only a server with consent is offered to missions, every call still needs mission egress consent, and results are untrusted content. | Missions see only the servers you have consented to. Every call still asks the mission's consent before data leaves this machine. Results are untrusted content. |
| SettingsWorkspace.jsx:265 | ACP agents | ACP agents (Agent Client Protocol) — expansion to be confirmed by the owner |
| SettingsWorkspace.jsx:269 | Protocol {version} - consented: {list\|none} | ACP protocol {version} · consented: {list\|none} |
| SettingsWorkspace.jsx:270 | {agent}: {name\|agent} {version} - auth: {methods} \| {agent}: failed - {error} | {agent}: {name} {version} · auth: {methods} \| {agent}: failed: {error} |
| SettingsWorkspace.jsx:272 | A consented ACP agent is one consultation tool for missions; Arc gives it no file or terminal access. Its reply is untrusted text, never evidence. | A consented ACP agent is one consultation tool for missions. Arc gives it no file or terminal access. Its replies are untrusted text, never evidence. |
| SettingsWorkspace.jsx:277 | Blender preset | Keep label; placeholder "preset name" |
| SettingsWorkspace.jsx:288 | Provider endpoints, OpenClaw isolation and prose diagnostics. | Provider endpoints, OpenClaw options and AI-text detection. |
| SettingsWorkspace.jsx:289 | Provider \| Endpoint \| CLI \| OpenClaw agent | Provider \| Endpoint \| CLI command \| OpenClaw agent |
| SettingsWorkspace.jsx:291 | anthropic \| openai \| gemini \| openclaw | Anthropic \| OpenAI \| Gemini \| OpenClaw (via providerLabel) |
| SettingsWorkspace.jsx:292-293 (aria-labels) | {provider} endpoint \| {provider} CLI | Anthropic endpoint \| Anthropic CLI (via providerLabel) |
| SettingsWorkspace.jsx:294 | isolated | Isolated (own session, no shared state) — meaning to be confirmed by the owner |
| SettingsWorkspace.jsx:294 | - (empty-cell marker) | not applicable |
| SettingsWorkspace.jsx:297 | Third-party AI detection may run after request-level consent. | Allow third-party AI-text detection. Arc asks again before each request, and the text leaves this machine only when you agree. (test :105) |
| SettingsWorkspace.jsx:328 | Seat \| Provider \| Transport \| Model \| Effort | Seat \| Provider \| Auth \| Model \| Effort |
| SettingsWorkspace.jsx:329 | {role} \| {provider} \| … (raw lowercase keys) | Use ROLES/providerLabel: "Planner", "OpenAI" |
| SettingsWorkspace.jsx:332 | CLI logins — CLI \| Version \| Login \| Identity reported \| Last probe | CLI \| Version \| Login \| Reports answering model \| Last probe |
| SettingsWorkspace.jsx:336 | yes \| no: requested-only | yes \| no (only the requested model is known) |
| SettingsWorkspace.jsx:337 | - \| {model}/{effort}: reachable, schema-valid, identity {observed_model} \| …: identity unverified \| …: failed - {error} (joined with '; ') | not run \| {model}/{effort}: ok, answering model {observed_model} \| {model}/{effort}: ok, answering model not reported \| {model}/{effort}: failed: {error} — one line per result |
| SettingsWorkspace.jsx:342 | Probe {provider} (renders "Probe anthropic") | Probe Anthropic (via providerLabel; tests :172, :174) |
| SettingsWorkspace.jsx:344 | A login only reports that a session exists. A probe proves reachability and selector handling, and identity only where the CLI reports it. | Signed in only means a session exists. A probe makes one real call to show that the model and effort are accepted; the answering model is confirmed only when the CLI reports it. |
| SettingsWorkspace.jsx:356-360 (aria-labels) | {kind} name {n} \| mcp transport {n} \| {kind} command {n} \| mcp url {n} \| {kind} args {n} | MCP server {n} name \| MCP server {n} transport \| ACP agent {n} command \| MCP server {n} URL \| MCP server {n} arguments (tests :154-164) |
| SettingsWorkspace.jsx:360 | Arguments | Keep label; placeholder "space-separated" |
| SettingsWorkspace.jsx:363 | enabled | Enabled |
| SettingsWorkspace.jsx:364 | missions may send data to it | Consent: missions may send data to this server (MCP) \| Consent: missions may send data to this agent (ACP) |

#### Keep as is

- "I accept that a probe spends tokens on my account, one call per distinct seat" (:341) — consent term, keep verbatim; a probe makes one real model call per distinct seat (:126, :174).
- Only a server with consent is offered to missions; every call still needs mission egress consent (data leaving this machine); results are untrusted content (:264).
- A consented ACP agent is one consultation tool; Arc gives it no file or terminal access; its reply is untrusted text, never evidence (:272).
- "missions may send data to it" (:364) — per-server/per-agent consent switch, off by default for new rows.
- "Third-party AI detection may run after request-level consent" (:297) — detection is off unless enabled and each request asks again before text is sent to the third party.
- Effort a transport cannot express is refused by the supervisor, not rounded (:252); OpenAI can still refuse a level for a specific model (:101).
- Credentials are file names created with `arc-science credential --name NAME`; nothing on this page holds a key (:252, header comment :8-9).
- Readiness never claims inference works: "no live inference was run", "not probed", "Signed-in CLI detected" (:126, :130, test :133).
- A login only reports that a session exists; identity (answering model) is confirmed only where the CLI reports it; "identity unverified" and "no: requested-only" must keep their meaning (:336, :337, :344).
- On a 409 the saved revision is newer, unsaved edits are kept on screen, and saving is refused rather than overwriting (:55-56, header comment :6-9).
- Save outcome distinguishes applied now vs stored for later vs restart required (:182).
- MCP check: SDK "not installed" fallback and per-tool "(not offered: reason)" facts (:261-262); ACP check: protocol version and auth methods (:269-270).
- Cost-free/data-free nature of MCP/ACP checks (code comment :169) — do not claim they send mission data.

### 2.8 Diagnostics

Files: `apps/arc-science/web/src/DiagnosticsWorkspace.jsx`, `DiagnosticsWorkspace.css`, `DiagnosticsWorkspace.test.jsx`.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Check MCP | button (HeroUI Button, secondary) | disabled when busy or no token; unlocks when token present; loading "Diagnostics request in progress…" in the left aside; error: alert in left aside (:192) + MCP servers card; success: SDK/consented line + table of servers and tools | DiagnosticsWorkspace.jsx:220 | Disabled with no adjacent reason; the MCP card beneath says "Run the MCP check". POST /api/mcp/servers/check contacts consented servers (side effect) — must stay disclosed. Proposal: when !token render under the actions row `<p class="field-note">Needs an operator token (see the unlock note on the left).</p>`. |
| Check ACP | button (HeroUI Button, secondary) | disabled when busy or no token; loading/error/success as Check MCP; success: Protocol/consented line + table of agents | DiagnosticsWorkspace.jsx:221 | Same as Check MCP. POST /api/acp/agents/check initializes consented agents (side effect). Proposal: same field-note (one note covers both). |
| Advanced | native `<details>`/`<summary>` disclosure | hidden until /health succeeds (health non-null and available !== false); collapsed by default; browser default focus ring; contains Version + scientific-validity caveat | DiagnosticsWorkspace.jsx:203-204 | Label does not describe content. Proposal: "Version and limits". |
| Local unlock required (unlock card) | role=status live region (non-interactive) | rendered only when no token | DiagnosticsWorkspace.jsx:186 | Heading undefined; body is the full LOCKED block (this is the right place for the full text). Proposal: heading "Operator token required". |
| error alert | role=alert live region | rendered when `error` set; cleared on next action and on token change (:124) | DiagnosticsWorkspace.jsx:192 | Not adjacent to Check MCP / Check ACP. Proposal: render the same text under the actions row at :222 for kinds mcp/acp. |

No dead controls: every button has an onPress handler and can be enabled.

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| DiagnosticsWorkspace.jsx:6 (LOCKED, full) | Operator session is locked. Run `arc-science token --data <project directory>` locally, or read the project owner-only access.token, then paste it in the shared header. Settings is for provider and connection configuration. | Unlock card and alert: "Operator session is locked. Get a token by running `arc-science token --data <project directory>` locally, or from the project's owner-only access.token file, then paste it in the shared header token field. Settings holds provider and connection configuration, not the token." Cards (:21, :51, :85, :101): "Operator session is locked. Paste a valid operator token in the shared header to retry." |
| DiagnosticsWorkspace.jsx:7 (OFFLINE) | Arc Science service is offline or unreachable. Start the local service, then refresh diagnostics. | Alert: "Arc Science service is offline or unreachable. Start the local service, then select Refresh service." Service card (:143): "Offline or unreachable." |
| DiagnosticsWorkspace.jsx:13 | Connection checks are unavailable in this local service. Check the project settings service, then retry. | Connection checks are unavailable in this local service (settings are not available to it). Start or repair the settings service, then retry. (capabilities path: "Capabilities are unavailable …") |
| DiagnosticsWorkspace.jsx:14 | The connection check could not complete. Review its settings, then retry. | The check could not complete (the service returned an error). Retry; if it persists, review the connection in Settings. |
| DiagnosticsWorkspace.jsx:16 | message.replace(/\s+/g, ' ').trim() (raw passthrough) | Add before the fallback: `if (/JSON\|Unexpected token/.test(message)) return 'The service returned an unreadable response. Refresh and retry.';` |
| DiagnosticsWorkspace.jsx:22 | (verbatim duplicate of :13) | Reuse one constant; card copy "Unavailable in this local service (settings not available). Retry after fixing the settings service." |
| DiagnosticsWorkspace.jsx:46 | Not checked. Load operator capabilities to read configured seats and connectors. | Not checked. Load operator capabilities (button on the left) to see which model seats — planner, reviewer, falsifier, vision — and connectors are configured. (render under the h2 "Operator capabilities") |
| DiagnosticsWorkspace.jsx:50 | Model seats (h2) | Keep; field-note beneath "A seat is one model assigned to a role (planner, reviewer, falsifier, vision)." |
| DiagnosticsWorkspace.jsx:51 | {capabilities.error \|\| (capabilities.locked ? LOCKED : 'Unavailable. Configure model seats in Settings.')} | locked: "Operator session is locked. Paste a valid operator token in the shared header to retry."; unconfigured: "No model seats configured. Set them up in Settings." |
| DiagnosticsWorkspace.jsx:64 | Falsifier | Falsifier (tries to disprove results) |
| DiagnosticsWorkspace.jsx:65 | Auth | Sign-in |
| DiagnosticsWorkspace.jsx:66 | Unavailable. Configure model seats in Settings. | No model seats configured. Set them up in Settings. |
| DiagnosticsWorkspace.jsx:69 | Unavailable. No configured vision seat was reported. | Not configured. The service reported no vision seat. (neutral state, not red) |
| DiagnosticsWorkspace.jsx:71 | MCP | MCP servers |
| DiagnosticsWorkspace.jsx:72 / :76 | {n} configured · {n} consented | Keep the template; field-note under the h2 "Consented = connectors you approved to run." |
| DiagnosticsWorkspace.jsx:73 | SDK: {connectors.mcp.sdk \|\| 'Unavailable'} | Keep "SDK: {sdk}" (test :81); align :89 to it |
| DiagnosticsWorkspace.jsx:75 | ACP | ACP agents |
| DiagnosticsWorkspace.jsx:79 | This summary reports configuration only. Worker health, inference reachability, MCP tools, and ACP agents require their own explicit checks. | Configuration only. Worker health and model reachability are not checked here; MCP tools and ACP agents need the checks below. |
| DiagnosticsWorkspace.jsx:84 | Not checked. Run the MCP check to ask configured consented servers for their tools. | Not checked. Check MCP contacts each consented server and lists its tools. |
| DiagnosticsWorkspace.jsx:85 | LOCKED (full constant) | Operator session is locked. Paste a valid operator token in the shared header to retry. |
| DiagnosticsWorkspace.jsx:89 | SDK {report.sdk \|\| 'Unavailable'} · consented: {list \|\| 'none'} | SDK: {sdk} · consented servers: {list} |
| DiagnosticsWorkspace.jsx:93 | tool.name + ' (not offered)' | Keep; field-note after the table when any tool is not offered: "Not offered = the server lists the tool but Arc Science does not expose it to models." (confirm meaning of `offered`) |
| DiagnosticsWorkspace.jsx:95 | No consented MCP servers were checked. | No consented MCP servers, so nothing was checked. |
| DiagnosticsWorkspace.jsx:100 | Not checked. Run the ACP check to initialize configured consented agents. | Not checked. Check ACP connects to each consented agent (ACP initialize) and reads its name and version. |
| DiagnosticsWorkspace.jsx:101 | LOCKED (full constant) | Operator session is locked. Paste a valid operator token in the shared header to retry. |
| DiagnosticsWorkspace.jsx:105 | Protocol {report.protocol_version \|\| 'Unavailable'} · consented: {list \|\| 'none'} | Protocol version {v} · consented agents: {list} |
| DiagnosticsWorkspace.jsx:111 | No consented ACP agents were checked. | No consented ACP agents, so nothing was checked. |
| DiagnosticsWorkspace.jsx:175 | Locked. Authenticated diagnostics are disabled. | Locked. No operator token, so authenticated checks are disabled. |
| DiagnosticsWorkspace.jsx:177 | Desktop session unavailable. Use an operator token to retry. | Desktop session was rejected by an authenticated check. Paste an operator token in the shared header to retry. |
| DiagnosticsWorkspace.jsx:177 | Locked. The current operator token was rejected by an authenticated check. | Locked. The current operator token was rejected. Paste a new one in the shared header. (test :128 substring kept) |
| DiagnosticsWorkspace.jsx:179 | (Desktop session ready. \| Operator token present.) At least one authenticated diagnostic route is unavailable in this service. | (Desktop session present. \| Operator token present.) At least one authenticated check is unavailable in this service; see the red card. (update test :143) |
| DiagnosticsWorkspace.jsx:180 | Desktop session ready. Authenticated diagnostics have not been loaded yet. | Before any check: "Desktop session ready. Authenticated diagnostics not loaded yet; load capabilities or run a check." After a successful authenticated call: "Desktop session verified by an authenticated check." |
| DiagnosticsWorkspace.jsx:180 | Operator token present. Authenticated diagnostics have not been loaded yet. | Before: "Operator token present, not yet verified. Load capabilities or run a check to verify it." After success: "Operator token accepted by an authenticated check." |
| DiagnosticsWorkspace.jsx:184 | DIAGNOSTICS | Diagnostics |
| DiagnosticsWorkspace.jsx:185 | Public service status is separate from authenticated operator checks. | Service status is public. Operator checks need a token. |
| DiagnosticsWorkspace.jsx:186 | Local unlock required | Operator token required |
| DiagnosticsWorkspace.jsx:191 | Diagnostics request in progress… | Loading capabilities… / Checking MCP servers… / Checking ACP agents… |
| DiagnosticsWorkspace.jsx:195 | Runtime status | Service status |
| DiagnosticsWorkspace.jsx:198 | {health.error \|\| OFFLINE} | Offline or unreachable. (full instruction stays in the alert) |
| DiagnosticsWorkspace.jsx:201 | Deployment | Deployment mode |
| DiagnosticsWorkspace.jsx:204 | Advanced | Version and limits |
| DiagnosticsWorkspace.jsx:208 | Scientific validity, model reachability, worker health, MCP, and ACP are not proven by this public service check. | This public check does not prove scientific validity, model reachability, worker health, MCP or ACP. |
| DiagnosticsWorkspace.jsx:210 | Not checked. Refresh service to read public readiness. | Not checked. Select Refresh service to read the public service status. |
| DiagnosticsWorkspace.jsx:213 | Session | Operator session |
| DiagnosticsWorkspace.jsx:218 | Explicit connection checks | Connection checks (run on demand) |

#### Keep as is

- CLI command verbatim: `arc-science token --data <project directory>` (test :41).
- "owner-only access.token" — the token file is owner-only; keep the permission semantic (test :42).
- "paste it in the shared header" — token goes in the shared header, not Settings (test :43).
- "Operator session is locked" in alert and cards on 401/403 (tests :123, :126).
- "This public check does not prove token validity." verbatim (test :50).
- Public /health check proves none of: scientific validity, model reachability, worker health, MCP, ACP (:208) — keep every item.
- Capabilities summary reports configuration only; it is not worker health, inference/model reachability, MCP tools or ACP agent health (:79).
- Authenticated calls (/api/capabilities, MCP check, ACP check) run only on explicit user action, never on mount (tests :29-51, :53-83).
- Check MCP contacts consented servers and asks for tools; Check ACP initializes consented agents — side effects must stay disclosed (:84, :100).
- "consented" counts and lists mean per-connector user consent; never reword as enabled/active/available.
- Native desktop session (NATIVE_SESSION) sends no Authorization header; copy must not imply an operator token was typed (test :17-26).
- No raw HTTP detail, status codes or JSON in user-facing text (tests :109, :124, :139).
- Settings holds provider and connection configuration and is not the token source (:6).
- Raw server facts shown unchanged: health.status, deployment (e.g. single-trust-domain), version, provider · model pairs, SDK version, protocol version, tool names, agent name · version.
- "offline or unreachable" in the alert after a failed refresh; Service card must drop the stale ready/deployment values (tests :164-166).
- "Connection checks are unavailable in this local service" on 503 for MCP/ACP (test :138).
- "current operator token was rejected" on 401 with a typed token (test :128).
- "Unavailable: " + server error for failed MCP/ACP rows (test :105).
- Never claim the token or session is verified/ready as a result of the public check; only an authenticated call can support that.
- Buttons Load capabilities / Check MCP / Check ACP stay disabled without a token; Refresh service stays enabled (tests :47-49).
- "Not checked" (UNCHECKED, :8) as the unchecked state word.

### 2.9 Native startup

Files: `native/arc-desktop/src/launch.rs`, `main.rs`, `startup.rs`, `README.md`. Surface: inline starting page, failure page, native error dialog, window title, startup log, `--check-startup` console line, download report event.

#### Controls

| Name | Kind | States | Location | Issue |
|---|---|---|---|---|
| Startup progress | progressbar (indeterminate; aria-valuetext = operation; no aria-valuenow) | animating (arc-indeterminate 1.35 s); prefers-reduced-motion: static 38 %-wide segment fixed at translateX(80%); absent on the failure page | launch.rs:320; CSS launch.rs:294 | Under reduced motion the static segment sits at the 80 % position and reads as "80 % done" on a bar that is meant to claim nothing. Proposal: `@media (prefers-reduced-motion:reduce){.progress-track::before{animation:none;width:100%;transform:none;opacity:.35}}`. |
| Startup checks list | list (ul/li, classes bad / muted) | hidden until the Planned event carries a plan (double-click path only; launcher path passes plan = None); item red when !ok, grey when optional | launch.rs:376-392 | No heading or accessible name; optional conveyed by colour only. Proposal: `<p class="muted">Startup checks</p><ul aria-label="Startup checks">` and "{name} (optional): {detail}". |
| Retry | link styled as button (a.button-link, href arc-science://startup/retry) | present only on the failure page; acted on only while recovery_available is true (main.rs:715, :731); click logs, spawns a fresh Arc Science process, closes this window; spawn failure: error dialog | launch.rs:409; handler main.rs:64-73, :516-530, :747-769 | No adjacent note that the window closes and reopens; the modal error dialog must be dismissed before the button can be reached. Proposal: "Retry (reopens Arc Science)". |
| Open redacted startup log | link styled as button (a.button-link.secondary, href arc-science://startup/open-log) | hidden until a log path resolves (LOCALAPPDATA/HOME available, main.rs:340-344); acted on only while recovery_available; opens the file with the OS default handler; failure: dialog "ShellExecuteW failed with code N" | launch.rs:410-412; handler main.rs:770-784, open_owned_path main.rs:379-435 | 'redacted' undefined at point of use; failure text is Win32 jargon. Proposal: label "Open startup log"; failure "Windows could not open {path} (ShellExecuteW returned {code})". |
| Failure alert | section role=alert containing the reason | shown on the failure page only; single `<p class="bad">` — multi-line reasons collapse | launch.rs:406 | Up to 16 KB of stderr collapses into one paragraph. Proposal: first line in `<p class="bad">`, last 12 lines in a `<pre class="muted">`, "Earlier output is in the startup log." |
| Notes list (failure page) | list (ul/li.muted) | hidden unless a plan exists and notes are non-empty; content = init --auto stderr lines (unredacted) or "filled … from discovery" | launch.rs:420-426 | No heading; stderr lines shown without startup::redact. Proposal: `<p class="muted">Noted during setup</p>`; build notes from `crate::startup::redact(...)`. |
| Arc Science could not start | native modal dialog (MessageBoxW, OK only, error icon), owned by the window or unowned when the window failed | Failed: full reason (may include the stderr tail); workbench-load failure: "Cannot load the workbench at …"; retry/open-log failure: the error text; window or WebView creation failure: unowned (hwnd 0), only when launched without arguments (main.rs:827) | launch.rs:453-474; callers main.rs:725, :745, :765, :781, :828 | Repeats the whole reason already on the page behind it and blocks Retry / Open log until dismissed; offers no action itself. Proposal: body "{first line of reason}\n\nRetry and the startup log are in the Arc Science window." |

#### Strings to change

| Location | Current | Proposed |
|---|---|---|
| main.rs:498, main.rs:508 (first operation); main.rs:589 (log) | Configuring native workspace / Startup: configuring native workspace | Preparing the workspace / Startup: preparing the workspace |
| main.rs:613, main.rs:621 | Starting local service | Starting the local service (matches launch.rs:315 and main.rs:114) |
| main.rs:500, main.rs:511 (timeout_note, rendered by launch.rs:332) | Elapsed 5 seconds. 60 seconds per-step configuration timeout. | 5 seconds since launch. Each setup step is allowed 60 seconds. |
| main.rs:615, main.rs:623 (timeout_note) | Elapsed 12 seconds. 30 seconds service readiness timeout. | 12 seconds since launch. The service is allowed 30 seconds to answer. |
| launch.rs:331-336 (template) | Elapsed {elapsed}. {timeout} {note}. | {elapsed} since launch. {note-as-sentence} |
| launch.rs:337-341 (template; not reachable from main.rs today) | Elapsed {elapsed} of {timeout} timeout. | {elapsed} since launch; limit {timeout}. |
| launch.rs:374 | A readiness check failed; starting anyway so the reason is visible. | A startup check failed (marked below). Arc Science will still try to start so the service can show the error. |
| launch.rs:379-390 | {check.name}: {check.detail} (li bad / muted) | Precede with `<p class="muted">Startup checks</p>`; optional checks as "{name} (optional): {detail}" |
| launch.rs:393-396 | Workspace `<code>{path}</code>` | Workspace: `<code>{path}</code>` |
| launch.rs:406 (and dialog launch.rs:463, log main.rs:736) | {reason} (may be message + up to 16 KB redacted stderr) | `<p class="bad">{first line}</p><pre class="muted" style="white-space:pre-wrap;font-size:13px;margin:8px 0">{last 12 lines}</pre><p class="muted">Earlier output is in the startup log.</p>` |
| launch.rs:409 | Retry | Retry (reopens Arc Science) |
| launch.rs:411 | Open redacted startup log | Open startup log |
| launch.rs:415-419 | Configuration: `<code>{workspace}\arc-science.toml</code>`. Edit it or delete it to discover the runtime again. Supervisor: `<code>{exe}</code>`. | Configuration file: `<code>{toml}</code>`. Delete it and Arc Science will look for Python and its components again on the next start, or edit it by hand. Startup helper: `<code>{exe}</code>`. |
| launch.rs:420-426 | {note} (ul without heading; unredacted init stderr) | Precede with `<p class="muted">Noted during setup</p>`; notes built from `crate::startup::redact(l.trim_start_matches("discovery: "))` |
| launch.rs:232-241 | filled {fields} from discovery | Detected and filled in: {fields} |
| launch.rs:429-432 | Startup log: `<code>{path}</code>` | Startup log (secrets removed): `<code>{path}</code>` |
| launch.rs:87-90 | The native supervisor {arc-science-native.exe} was not found beside Arc Science.exe, in the development layout, or on PATH. Build it with `cargo build --release` in native/arc-science or set ARC_DESKTOP_SUPERVISOR. | Arc Science needs its startup helper, arc-science-native.exe, and could not find it next to Arc Science.exe, in native/arc-science/target/release, or on PATH. Build it with `cargo build --release` in native/arc-science, or point ARC_DESKTOP_SUPERVISOR at it. |
| launch.rs:106-108 | Neither ARC_DESKTOP_PROJECT nor the local application data directory is available | Cannot choose a workspace folder: ARC_DESKTOP_PROJECT is not set and the local application data folder (LOCALAPPDATA) is not available. |
| launch.rs:137 | Cannot run the supervisor {path}: {e} | Cannot run the startup helper {path}: {e} |
| launch.rs:154-165 | {exe-name} {args...} failed ({status}): {last stderr line \| no detail} | The startup helper failed during `{subcommand}` ({status}): {redact(last line)} |
| launch.rs:170 | The supervisor did not answer within 60 seconds | The startup helper did not answer within 60 seconds |
| launch.rs:173 | Cannot wait for the supervisor: {e} | Cannot wait for the startup helper: {e} |
| launch.rs:245 (with startup.rs:31-69) | (LocalUrl parse errors naming ARC_DESKTOP_URL) | `.map_err(\|e\| format!("The startup plan's URL is invalid: {e}"))` |
| launch.rs:399, launch.rs:435 | `<html>` | `<html lang="en">` |
| main.rs:374 | Arc Science startup log (redacted). No raw secrets or shell commands are recorded. | Arc Science startup log. Credential-like values are replaced with [redacted]. |
| main.rs:415 | ShellExecuteW failed with code {result} | Windows could not open {path} (ShellExecuteW returned {result}) |
| main.rs:460-467 (console, --check-startup) | Arc Science readiness verified; service owned (shutdown requested on exit) \| service reused (left running) | Arc Science is ready. The service was started by this check and is shut down on exit. \| Arc Science is ready. An existing service answered and is left running. |
| main.rs:736 (log) | Startup failed: {reason} | Startup: failure shown in window |
| launch.rs:463 / main.rs:742-745 (dialog body) | {reason} | {first line of reason}\n\nRetry and the startup log are in the Arc Science window. |
| startup.rs:439 | Service exited before readiness: {status} | The service exited before it was ready ({status}) |
| startup.rs:461 | Service exited during readiness: {status} | The service exited while being checked ({status}) |
| README.md:37 | or under `Windows Kitsin` | or under `Windows Kits` |

#### Keep as is

- Supervisor search order and remedies (launch.rs:88): beside Arc Science.exe, the development layout native/arc-science/target/release, then PATH; remedy `cargo build --release` in native/arc-science or ARC_DESKTOP_SUPERVISOR.
- An explicit ARC_DESKTOP_SUPERVISOR that is not a file is refused, never silently replaced (launch.rs:75-79; README.md:19-20).
- Timeout facts: 60 seconds per supervisor step (launch.rs:15, :170); service readiness timeout = ARC_DESKTOP_TIMEOUT, default 30 s, integer 1–300 (startup.rs:171-176).
- Redaction commitment: bearer values, name=value secrets and long opaque tokens are replaced with [redacted] in the startup log and in shown stderr tails (startup.rs:264-316; main.rs:350, :374).
- The native session secret is never put in the URL, page state, storage or logs (README.md:100); nothing on this surface may print it.
- Deleting arc-science.toml makes the next start re-detect Python and components; editing it by hand is the alternative (launch.rs:416; README.md:9-10).
- Retry spawns a fresh Arc Science process and closes the current window; a failed spawn is reported (main.rs:437-448, :747-769).
- Foreign-listener refusal: readiness requires HTTP 200 and x-arc-science-service: arc-science-v1; another listener is refused, not reused (startup.rs:374-377; README.md:86-89 — this marker is compatibility, not authentication).
- A failed startup check does not stop startup; Arc Science still tries so the service can report the error (launch.rs:371-375).
- The starting page's progress bar is indeterminate and must never show a percentage, aria-valuenow, or the word "ready" (tests launch.rs:530-539); reduced motion keeps the animation off.
- Failure copy must keep: "Service exited before readiness: {status}", "Service readiness timed out after {n} seconds", "Cannot start service executable …", and the appended redacted stderr tail (startup.rs:396-465).
- ARC_DESKTOP_* validation contracts and variable names (startup.rs:31-215; README.md:69-76): loopback numeric IP without userinfo, port 1–65535, ARG_COUNT 0–64, batch scripts rejected, legacy ARC_DESKTOP_SERVE value only.
- Dialog caption and page h1 both read "Arc Science could not start" (launch.rs:406, :463); a double-click failure is never silent (main.rs:825-829).
- --check-startup prints whether the service was started by the check (shut down on exit) or an existing one was reused (left running) (main.rs:460-467; README.md:80-82).
- Workspace location: ARC_DESKTOP_PROJECT or %LOCALAPPDATA%\ArcScience\workspace (~/.arc-science/workspace elsewhere); never beside the executable (launch.rs:94-121).
- Startup log location: %LOCALAPPDATA%\ArcScience\startup.log (main.rs:340-344); it is reset on every launch (main.rs:359-377).
- Download report contract: window event 'arc-download' with detail {file, folder, success} (main.rs:790-794; README.md:113-116).

## 3. Terms that need a definition at the point of use

- operator token → the secret produced by `arc-science token --data ./data` (or the token file the local service writes) that the header field sends with every protected `/api` request.
- desktop session / native session → the desktop app has already signed this window in, so no token is typed and no Authorization header is sent.
- "Local unlock" → an operator token is required; nothing else is being unlocked.
- seat → one role (planner, reviewer, falsifier, vision, prose) backed by one provider and one model.
- Falsifier (seat) → the role that tries to disprove results (inferred from the name; confirm with the owner).
- falsifier (branch) → the observation that would refute a branch's hypothesis.
- claim scope → for each requested claim, what the evidence supports so far, what is still uncertain, and the next test that would tell the branches apart.
- release decision / "Eligible for human review" → the ledger status saying a mission is ready for a human reviewer; it is not validation.
- replay verification / replay capsule → re-running the mission's recorded computations and artifacts to check integrity; the exported archive of that record.
- evidence graph → the links between observations, assessments and claims that replay checks for consistency.
- declared change → a change the operator declares when resuming a mission or re-rendering; the server derives the actual effects and refuses a narrower declaration.
- repair cycle → one round of figure repair after a visual review; "addressed" lists what it fixed.
- render preset → a named set of presentation settings (background, finish, colours; envelope and stick presets also change the drawn mesh).
- reconciliation → the model roles' assessments of each branch (last 12 shown).
- decision frontier → the current mission overview (status, round, actions, model calls, data source).
- offline fixture / demo mode → the model roles are scripted; the numerical computation is real.
- egress / consent → text leaving this machine for a configured model or a third party; every send needs a ticked box, which clears after one request.
- search mode: keyword (lexical) / semantic / hybrid → literal keyword match; match by meaning using an embedding model; both combined.
- embedder → the embedding model semantic and hybrid search need.
- compaction epoch / seq → the numbered pass in which memory records were compacted; the record's position within a session.
- trust → the recorded origin class of a memory record (e.g. model_output).
- session capture / pending → the background worker that writes mission records to memory; pending counts records not yet written.
- remove from retrieval → hides a record from search and recall; the stored history is not erased.
- abstention → returning no result, which is a valid answer.
- read budget → the server's limit on how much one record-range page may read.
- author chain ID (auth_asym_id) → the chain identifier as written in the coordinate file.
- asymmetric_unit / assembly → the coordinates as deposited, with no symmetry operators applied; a named biological assembly listed in the file.
- Gaussian atomic envelope → the rendered surface is a smoothed envelope around the atoms, not a measured surface.
- provisional vs verified contacts → contacts computed while the render is still running vs those collected once the pipeline finished.
- presentation / scientific depiction / analysis (declared effects) → appearance only (width, samples, seed); the drawn mesh, chains, assembly, model; the contact cutoff.
- collage → the preview image (collage.png) a completed render produces.
- artifact → an output file of a render or a mission.
- manifest → manifest.json recording the source file, chain selection and render settings.
- package probe → a check that reports whether a package is present, not whether it works; nothing is installed.
- receipt (BioArt) → the hashed record of a fetched file: file SHA-256, NIH page SHA-256, size, receipt ID.
- representation / group / variant → one file set of an NIH entry (for example a grey or a colour version) with its formats.
- neutral compatible → a variant labelled grey, grayscale or black-and-white that has the requested format.
- cache hit → an entry already in the local cache; it never contacts NIH.
- prose seat → the AI model chosen in Settings for prose rewrites.
- humane-prose behaviour → the fixed instruction text the seat edits under (shown by "Show the behaviour").
- protected span → a run of text (number, identifier, citation, unit, code) that must come back byte for byte.
- identity requested-only → the provider did not report which model answered.
- system channel → a separate system-instruction slot; when a seat has none, the behaviour text goes inside the message.
- third-party detection → an AI-text classifier at api.edgeshop.ai; its estimate is neither an authorship claim nor a release input.
- supervisor / startup helper → the desktop-app component (arc-science-native.exe) that writes settings and starts the service.
- revision → the settings-file version loaded; saving is refused if the file changed since.
- transport / auth → the sign-in method: API credential file or CLI login (OAuth).
- selector → one model/effort pair a probe tries.
- identity reported → whether the CLI reports which model answered.
- consented (connectors) → MCP servers or ACP agents the operator approved for missions.
- MCP / ACP → Model Context Protocol servers that offer tools; Agent Client Protocol agents used as consultation tools (ACP expansion to be confirmed by the owner).
- isolated (OpenClaw) → own session, no shared state (meaning to be confirmed by the owner).
- request-level consent → each request asks again before text is sent.
- deployment mode → the service's raw deployment identifier, e.g. single-trust-domain.
- startup plan / startup checks → the JSON the startup helper returns with the service URL and the results of its checks.
- discovery → the startup helper looking for Python and components; the results fill arc-science.toml.
- redacted → credential-like values replaced with [redacted].

## 4. Icon set

All nine glyphs in `icons.jsx` are Lucide geometry in a 24-unit viewBox rendered at 16 px with stroke 2, round caps and joins, fill none, currentColor, aria-hidden and focusable=false; stroke weight and rendering are uniform.

| Navigation item | Current icon (icons.jsx) | Reads as |
|---|---|---|
| Research | `search` | acceptable; one of three magnifiers in the nav |
| Memory | `database` | correct |
| Molecules | `atom` | correct |
| BioArt | `scan-search` | a magnifier; no image/art cue for an NIH image library |
| Prose | `pen-line` | correct (writing/editing) |
| Settings | `sliders` | correct, but optically larger than its neighbours |
| Diagnostics | `scan-search` | duplicates BioArt |

Other glyphs in use: `shield-check` (icons.jsx:7; possibly the BioArt receipt glyph, not confirmed); BioArt action buttons use `search`, `cloud-download`, `download` and `import`.

Inconsistencies:

- `scan-search` is used for both BioArt and Diagnostics; with `search` on Research, three of the seven nav glyphs are magnifiers, so the utility icons do not read as distinct.
- `sliders` tick lines run x=1..23 while every other glyph sits inside x=3..21 (`database` y=2..22), so Settings renders ~1.3 px wider per side at 16 px and reads heavier.
- BioArt: "Inspect entry" is the only action button without an icon; "Open NIH search" lacks the ↗ marker its sibling "Open NIH source ↗" carries.
- Any added glyph must be retrieved via Supericons and credited in THIRD_PARTY_NOTICES.md as the existing ones are (icons.jsx:2).

Proposed geometry (Lucide family, 24-unit viewBox, stroke 2, round caps/joins, fill none; quoted from Lucide, not from any file read — verify against upstream before adding):

- Settings — Lucide `sliders-vertical`, current upstream extents: keep the six vertical lines and replace the three tick lines with `<line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/>` so the glyph spans x 2..22.
- Prose — Lucide `pen-line` (unchanged): `<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>`.
- Diagnostics — Lucide `activity`: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`. Smaller alternative: reuse the existing `shield-check` for Diagnostics only, after checking it is not already the BioArt receipt glyph.
- BioArt (consequential) — Lucide `image`: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`.
