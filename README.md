# Arc Science · development

Arc Science is an evidence-bound research workbench under development in the existing Vedix repository. It combines a molecular figure workspace with bounded research missions: competing hypotheses, permitted computations, independent role reviews and reproducible evidence.

This is a development checkpoint. The Windows-native port and native memory are
implemented; the molecular workbench now connects local coordinate files to the
existing Blender renderer. See [local rendering setup](docs/arc-science/molecular-workbench-2026-09-18.md),
[Windows port boundaries](docs/arc-science/windows-native-port-2026-09-18.md), and
[native memory qualification](docs/arc-science/native-session-memory-qualification-2026-09-16.md).
The Linux renderer executor uses a
private process-group watchdog and kernel parent-liveness pipe; deterministic tests
cover repeated native cancellation and cleanup after a successful renderer leader
exit. Independent code review approved this boundary with no remaining findings.
Historical qualification for Linux, live BioArt, macOS, and the inherited root suite
remains separately scoped. See the retained
[containment verification](docs/arc-science/renderer-containment-verification-2026-09-09.md)
and the retained [earlier record](docs/arc-science/bioart-setup-verification-2026-09-08.md).

The application is in [apps/arc-science](apps/arc-science). Vedix's plugin code, identifiers, installers and history are preserved; use the [original Vedix installation guide](docs/legacy/VEDIX_README.md) for those plugins. The repository slug has not been renamed.

Development follows [Harness-of-Harness](docs/hoh/index.md), with separate plans,
implementation and independent evaluation. The current
[release-candidate evidence](docs/hoh/2026-09-18-qualification.md) covers the native
Windows launcher, memory reliability, interactive browser flows and scientific audit.

## Windows desktop

Build once, then start `native\arc-desktop\target\release\Arc Science.exe` by
double-clicking it:

```powershell
.\scripts\start-arc-science.ps1 -Build
```

The executable configures itself. It finds the native supervisor beside it or in the
build layout, keeps its workspace under `%LOCALAPPDATA%\ArcScience\workspace`,
discovers Python 3.11+ and the `arc_science` package on first use (and completes an
older configuration that predates discovery), opens its window at once with the
readiness checks, and loads the workbench when the local service answers. If the
service cannot start, the window and a native dialog show the reason, including the
supervisor's last lines. Python application dependencies and Rust are installed by
you; nothing installs packages. The launcher script remains for `-Build`,
`-ProjectPath`, `-Python`, `-BlenderPython` and headless `-CheckStartup`.
See [desktop lifecycle and configuration](native/arc-desktop/README.md).

## Run locally

Python 3.12 is the tested application runtime. The committed UI is already compiled; Node is only needed when rebuilding it.

```bash
cd apps/arc-science
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install .
arc-science serve --data ./data
```

Open [the local workbench](http://127.0.0.1:8080/). In another activated terminal, run `arc-science token --data ./data` and enter that operator token in BioArt or Research. Both workspaces share it in page memory; it is not written to browser storage. Use a fresh data directory for 0.6.0. Historical capsules need their matching verifier. [Migration notes](apps/arc-science/docs/migration-0.6.md) describe this increment and its limits.

## Native configuration and launch

The optional Rust CLI configures and supervises the existing Python worker; it is
not a GUI or scientific rewrite. With Rust 1.90.0 installed, from the repository root:

```bash
cargo +1.90.0 build --release --locked --manifest-path native/arc-science/Cargo.toml
mkdir arc-project
native/arc-science/target/release/arc-science-native --project arc-project \
  init --python "$PWD/apps/arc-science/.venv/bin/python"
```

The selected interpreter must already contain Arc Science. Initialization writes
the path without executing it or installing dependencies, and never overwrites an
existing configuration. Then run:

```bash
native/arc-science/target/release/arc-science-native --project arc-project doctor
native/arc-science/target/release/arc-science-native --project arc-project worker -- --help
native/arc-science/target/release/arc-science-native --project arc-project serve
```

Linux native tests/build and module help are checked; this does not qualify the
scientific worker. Windows BioArt now has a native path with the weaker filesystem
and deadline guarantees documented in the Windows port record. Live NIH transfer
and macOS execution remain separate qualification gates. The supervisor is noninteractive (stdin EOF), with no
shell, PTY, or automatic install. See [native setup and lifecycle limits](native/arc-science/README.md).

## NIH BioArt assets

Use an existing project directory and install the application's `vector` extra in
your selected Python environment for SVG validation/import. Fetch defaults to SVG
and prefers an explicitly neutral-labelled representation that provides that
format. An explicit `--representation` remains authoritative; original bytes are
never recolored. From the installed application's environment:

```bash
arc-science bioart inspect 18 --project ./arc-project --allow-egress
arc-science bioart fetch 18 --project ./arc-project --allow-egress
```

After native initialization, the equivalent first-class command uses the selected
project and its configured interpreter/cache:

```bash
native/arc-science/target/release/arc-science-native --project arc-project \
  bioart fetch 18 --allow-egress
```

The HeroUI workbench now exposes the same evidence-bound path. Open BioArt, enter
the local operator token, search the fresh cache, and inspect an entry before
fetching it. Each live search, inspection, or file request requires the visible
NIH network checkbox. The permission is consumed by that one action and reset.
Cache hits do not start a network process. A cache miss with consent runs the
existing BioArt CLI from its trusted installed package in a sanitized environment
and supervised process group, then reopens and verifies the resulting cache entry
before returning it to the browser. Identical concurrent misses share one cache
population; an unrelated live miss is rejected instead of queued.

The result includes the selected file/group IDs, source and receipt paths, credit,
license and byte hash. Use `bioart verify RECEIPT` before `bioart import RECEIPT
--project ./arc-project` to import an eligible SVG. Omit `--allow-egress` for
verified fresh-cache access only. AI/EPS are archive-only, and PNG is preview-only.
Automation currently accepts exact Public Domain entries, not every license in
the collection. Live entry 18 SVG transfer, receipt verification and original download
were exercised on Windows. That NIH SVG remains download-only under the strict import
validator; broad NIH vector import and browser-rendered keyword search remain unqualified.
See [provider behavior](apps/arc-science/docs/bioart.md) and the separate
[access/setup research](docs/arc-science/bioart-setup-research-2026-09-08.md).

## Molecular workspace

The viewer is Mol* (MIT), mounted headless on one canvas and loaded as its own chunk the first time a structure is shown. A chosen coordinate file is drawn at once from the browser's own copy, before any render exists and without a request; a saved render supplies its coordinates through the authenticated `source` route. Representation, colouring, background, quality, assembly, waters, contacts and spin are the viewer's settings, with defaults from the operator's settings file. While the local pipeline runs, its stages are read from the outputs it writes (contacts computed, rendering, composing, checking, verifying) and streamed to the workbench as server-sent events fetched with the token in a header (never a native EventSource); the pipeline's residue contacts are overlaid the moment the scene exists, and polling stands in when the stream is unavailable. What the viewer shows is geometry, never validation.

The workspace opens empty, on the operator's own renders; no example collage is
packaged (the frozen 1DQJ / HyHEL-63 example was removed on 2026-09-19). The
authenticated **Render your structure locally** form accepts coordinate files and
author chains, tracks a bounded render job, and shows its white collage with
provenance downloads (contacts CSV at minimum heavy-atom distance ≤4 Å — a geometric
criterion that establishes neither hydrogen bonds nor affinity; a Gaussian atomic
envelope, not a solvent-excluded surface). Set the server's Blender runtime as described in [local rendering setup](docs/arc-science/molecular-workbench-2026-09-18.md).

To render your own authorized coordinates, install `'.[structure]'` in the app environment and prepare a **separate** Blender Python runtime using [the rendering setup](apps/arc-science/docs/vector-rendering.md) and [the historical Blender lock](apps/arc-science/requirements-blender.lock). Then:

```bash
arc-science molecule-render source.cif --antibody A,B --antigen C \
  --assembly 1 --output ./new-candidate \
  --blender-python /path/to/blender-env/bin/python
```

Defaults are a 1400 px white collage, 96 samples and seed 23. The output directory must not already exist. Reproduction requires the specified renderer environment; this migration does not claim a new Blender qualification.

The local pipeline renders under a named preset from a registry of nineteen: the panel background of the composed figure, world strength, material finish, partner colours, envelope tightness and stick radius. The rendered views keep their transparent film and the figure its white canvas under every preset. A preset changes presentation only — never the coordinates, the chain selection or the cutoff — and the style it applied is written beside the scene, bounded again by the worker, checked against its receipt and recorded in the manifest, so a render replays under the preset it was made with. Two style keys (envelope isovalue, stick radius) change the drawn mesh, so a preset change between them is derived as a change of scientific depiction as well as presentation. The operator's default preset comes from the settings file; a name the registry does not know falls back to the registry default and the capabilities say so.

The software catalogue names about a hundred structural-biology and cheminformatics packages by category, licence and home, and probes each the way its presence can be observed from this workstation: an isolated import in the service's interpreter, an executable on PATH or at a known install folder, a conda environment or executable inside the WSL bench, or the Claude Science daemon's own status. A probe reports presence only for an import or an executable it observed; an environment or a daemon seen is reported as indirect evidence, never as the package. Nothing is qualified and nothing is installed; probes run under the same boundary as the CLI seats (allowlisted environment, private directory, bounded output, contained tree) and a re-probe is an explicit POST; licence names are as recorded and are to be confirmed at the project home.

## Research and limits

Research preserves goal, execution mode, round limit, explicit egress and visual-review consent, saved missions, start/cancel/resume, numerical verification and replay-capsule export. Artifact inspection/download remains authenticated. Switching workspaces retains the current goal, token and mission.

Prose offers a humane-prose behaviour and three controlled operations. The behaviour (`arc-humane-prose-2`, the packaged `humane-prose.md`, also installed as the `humane-prose` Claude Code skill) is derived from the research digest at `docs/prose/humane-prose-2026-09-20.md`: professional writers' seven edit categories (specificity first, then redundant exposition, clichés, purple prose, structure, word choice, tense), the style words and frames that rose in scientific abstracts after 2022, uniform rhythm, and reader trust. It preserves every fact, number, citation and qualification, keeps the author's voice, adds nothing the author did not say, and declines to promise what any AI-text detector will say, because the studies show detectors disagree by orders of magnitude on the same human pages and move in opposite directions under the same edit. Local diagnostics count those observations (style words per thousand words, formulaic frames, sentence-length spread, repeated openings, triplets, closing summaries) and say beside every result that they are not an authorship estimate. A seat rewrite sends the text, with per-request consent, to the prose seat configured in Settings under the behaviour (a system prompt on Claude Code, Gemini CLI and the HTTP transports; on Codex CLI, which has no system channel, the behaviour leads the prompt and the result says `instruction_channel: "prompt"`), refuses locally any recognised explicit instruction for detector evasion or impersonation (named detector products, AI-text detectors with an evasion or score verb, "undetectable", "reads as human-written", hiding traces of machine generation, imitating a named person) before any seat, consent or lock is involved — a paraphrase the pattern misses meets only the behaviour's own refusal, which is a prompt, and a product name refuses even an innocent instruction, the refusal naming the phrase —, and returns nothing unless every protected span comes back byte for byte and the seat hands over its provenance; the audit keeps a keyed hash of the text, never the text. Prose also offers two older operations. The local rewrite applies a fixed, visible rule table (formulaic openers, `in order to`, `utilize` and the like) only outside protected spans — code, math, quotations, links, citations, numbers with units, statistics, identifiers, residues, sequences, chemistry, dates, versions, paths — and refuses the whole edit if any protected span would change; the result is a rule-based edit, never a human-authorship claim, and establishes neither semantic equivalence nor scientific validity. Detection reproduces the request of the text2go `ai-humanizer-mcp-server` reference client to `api.edgeshop.ai` (Copyleaks and Hemingway) and needs `allow_egress: true` on every request because the text leaves the machine; `ARC_PROSE_DETECTION=off` disables it entirely; the audit keeps a keyed hash of the text, never the text; the score is a third-party estimate that establishes neither AI nor human authorship and has no bearing on any release decision. The live response shape of that endpoint is unverified from this workstation and is normalised from the reference client's types.

Offline mode uses a scripted planner and real numerical analysis; it is not live-model or biological evidence. Live mode requires configured server-side providers, exact model IDs and credentials. The Settings workspace configures each seat (planner, reviewer, falsifier, vision, prose) with its own provider, model, reasoning effort and authentication: an API credential stored by `arc-science credential --name NAME`, or the operator's own CLI login (Claude Code, Codex, Gemini CLI) run tool-less in a private directory under a scrubbed environment. Seats may mix transports; the routing is bound to a mission at its first start and a resume with different seats is refused. Effort is mapped per transport and refused where a transport cannot express it; a Codex seat's model identity is recorded as requested-only because the CLI does not report it, and the claim scope never counts such a seat as an independent reviewer. The Connections table shows each CLI's login state without spending, and a probe (one consented call per distinct seat) proves reachability and schema validity, not inference quality. MCP servers (official `mcp` SDK, stdio or streamable HTTP) and ACP agents (newline JSON-RPC over stdio) named in the settings become mission tools only when the entry carries consent: an MCP tool whose input schema the closed catalogue can represent is offered as `mcp_<server>_<tool>`, an agent as one `acp_<name>_consult`; every call still needs the mission's egress consent, sessions live for one mission in a private directory, Arc grants an agent no permission and serves it no file or terminal, and every result is an observation of untrusted content, never evidence. The Settings workspace lists each server's tools and each agent's `initialize` answer without sending mission data. Visual review also requires a configured vision provider; missing or failed qualification is not a passing badge. A review that finds only presentation problems triggers at most two figure-repair cycles (re-render under a spacious or large-text preset, then a fresh review of the new candidate); anything else waits for a human, and the release ledger records every cycle. [Provider configuration](apps/arc-science/docs/source-readme-0.4.md#direct-model-and-vision-configuration) documents the retained environment settings; substitute a fresh 0.6 data directory.

HoH's fixed roles, single writer, frozen candidates and independent QA are the foundation. Self-evolving harness proposals, broader scientific composition and Lean proof obligations remain separate development requirements. Reproducibility, model agreement and attractive figures do not establish scientific validity or publication authorization.

The React/HeroUI 3 UI is built and tested through DOM interactions and served artifact bytes. On 18 September 2026 the local browser displayed the molecular workbench, authenticated renderer readiness, restored job history and a newly generated collage. [Current qualification](docs/arc-science/molecular-workbench-qualification-2026-09-18.md) distinguishes these checks from historical illustration acceptance and untested workflows.

## Develop and test

```bash
cd apps/arc-science
python -m pip install '.[test,vector]'
cd web
npm ci
npm test
npm run build
cd ..
python -m pytest -q -rs
python -m pip wheel --no-deps . --wheel-dir dist
```

`npm run build` copies compiled files into the Python package. Path-scoped CI runs the app tests, real frontend DOM tests and production build. Native Blender integration tests skip unless an explicit runtime is supplied; ordinary CI does not call live models or paid services.

[Application migration and public inclusion policy](apps/arc-science/docs/migration-0.6.md) · [Legacy Vedix guide](docs/legacy/VEDIX_README.md)
