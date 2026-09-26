# Arc Science guide

What each workspace does, what it sends where, and where its limits are. The
[README](../README.md) covers installation.

## Research

Research keeps the goal, execution mode, round limit, explicit egress and visual-review
consent, saved missions, start, cancel and resume, numerical verification and
replay-capsule export. Artifact inspection and download stay authenticated. Switching
workspaces keeps the current goal, token and mission.

Offline mode uses a scripted planner and real numerical analysis; it is not live-model or
biological evidence. Live mode needs configured server-side providers, exact model IDs and
credentials. A live mission shows its route (every destination, data category and
purpose) before it starts; approving it records one grant per destination for that
mission, and every dispatch leaves a receipt. The claim scope narrows each requested
claim to what the evidence supports, lists the remaining uncertainty and proposes the
next discriminating test. The release decision lists every check with its state; a
mission is at most "eligible for human review", never "validated".

Visual review needs a configured vision provider; a missing or failed qualification is
not a passing badge. A review that finds only presentation problems triggers at most two
figure-repair cycles (re-render under a spacious or large-text preset, then a fresh
review of the new candidate); anything else waits for a person, and the release ledger
records every cycle.

Reproducibility, model agreement and attractive figures do not establish scientific
validity or publication authorisation.

## Settings and model seats

Settings configures each seat (planner, reviewer, falsifier, vision, prose) with its own
provider, model, reasoning effort and authentication: an API credential, stored by
`arc-science credential --name NAME` in the private data directory or, from the desktop
app, in the Windows Credential Manager through a native dialog the page never sees; or
the operator's own CLI login (Claude Code, Codex, Gemini CLI) run without tools in a
private directory under a scrubbed environment. Seats may mix transports; the routing is
bound to a mission at its first start, and a resume with different seats is refused.
Effort is mapped per transport and refused where a transport cannot express it. A Codex
seat's model identity is recorded as requested only, because the CLI does not report it,
and the claim scope never counts such a seat as an independent reviewer.

The Connections table shows each CLI's login state without spending anything; a probe
(one consented call per distinct seat) proves reachability and schema validity, not
inference quality. MCP servers (official `mcp` SDK, stdio or streamable HTTP) and ACP
agents named in the settings become mission tools only when the entry carries consent;
every call still needs the mission's egress consent, and every result is an observation
of untrusted content, never evidence.

## Molecules

The viewer is Mol* (MIT), loaded as its own chunk the first time a structure is shown. A
chosen coordinate file is drawn at once from the browser's own copy, before any render
exists and without a request. While the local pipeline runs, its stages are read from the
outputs it writes and streamed to the workbench as server-sent events fetched with the
token in a header; polling stands in when the stream is unavailable. What the viewer
shows is geometry, never validation.

The render form accepts coordinate files and author chains, tracks a bounded render job
and shows its white collage with provenance downloads: contacts at a minimum heavy-atom
distance of at most 4 Å (a geometric criterion that establishes neither hydrogen bonds
nor affinity) and a Gaussian atomic envelope (not a solvent-excluded surface). Renders use
a separate Blender Python runtime; see [local rendering setup](arc-science/molecular-workbench-2026-09-18.md)
and [Blender on Windows](arc-science/blender-rendering-native-windows-2026-09-17.md).

```bash
arc-science molecule-render source.cif --antibody A,B --antigen C \
  --assembly 1 --output ./new-candidate \
  --blender-python /path/to/blender-env/bin/python
```

Defaults are a 1400 px white collage, 96 samples and seed 23. A render preset changes
presentation only, never the coordinates, the chain selection or the cutoff, and is
recorded in the manifest so a render replays under the preset it was made with.

## BioArt

NIH BioArt search, inspection, fetch and import, each live action behind a visible
one-shot network consent. Cache hits start no network process. Fetch defaults to SVG and
prefers an explicitly neutral representation; original bytes are never recoloured.
AI and EPS originals are download-only and never executed or previewed; PNG is preview
only. Automation accepts exact Public Domain entries only; rights are recorded, not
verified by Arc Science.

```bash
arc-science bioart inspect 18 --project ./arc-project --allow-egress
arc-science bioart fetch 18 --project ./arc-project --allow-egress
```

See [provider behaviour](../apps/arc-science/docs/bioart.md).

## Prose

Prose offers a humane-prose behaviour (`arc-humane-prose-2`, derived from the research
digest in [docs/prose](prose/humane-prose-2026-09-20.md)) and two older operations. It
preserves every fact, number, citation and qualification, keeps the author's voice, adds
nothing the author did not say, and refuses requests to evade AI-text detectors or to
impersonate a person. Local diagnostics count style observations and say beside every
result that they are not an authorship estimate. A seat rewrite sends the text, with
per-request consent, to the prose seat; nothing comes back unless every protected span
(code, math, quotations, links, citations, numbers with units, identifiers, sequences,
dates, paths) returns byte for byte. The optional third-party detection needs consent on
every request and can be switched off with `ARC_PROSE_DETECTION=off`; its score
establishes neither AI nor human authorship.

## Memory

Session memory is a native Rust engine (`native/arc-memory`) over captured sessions:
lossless storage and lexical search. Memory never grants tool authority. See
[the design](arc-science/native-session-memory-design-2026-09-16.md).

## Security model

- One service worker owns each private data directory. The data directory, the operator
  token, stored credentials and the prose audit key are restricted to the account that
  runs the service.
- Tokens stay in memory and request headers; they never enter URLs, browser storage,
  prompts, logs or exported artefacts. The desktop session needs no token in the page.
- Credentials never enter the WebView; the desktop shell writes them to the Windows
  Credential Manager from its own dialog.
- Every external call of a mission passes the grant ledger, and every result from a
  model, MCP server or agent is untrusted observation, never permission or evidence.
