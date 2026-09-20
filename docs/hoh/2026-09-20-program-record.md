# Program record — 20 September 2026

Development record and independent evaluation for each loop of the
[program](2026-09-20-program.md). Evaluator: Sol (GPT-5.6, read-only Codex sandbox,
shared working tree). Each row cites what was observed; nothing here is a validity,
novelty or production claim.

## Loop 1 — launch (`c97ddaf`, `577dddf`, `e98fb7d`)

Diagnosis: `Arc Science.exe` read its whole configuration from `ARC_DESKTOP_*`
environment variables that only the PowerShell launcher set, created no window until
the service was healthy, and reported failures on a stderr nobody saw; as a
console-subsystem binary a double-click also opened a terminal tab. With no launcher
it timed out silently.

Changes: the supervisor discovers the runtime (`init --auto`: Python 3.11+ resolved
to `sys.executable`, the package root, sibling components; contained, drained,
deadline-bounded probes), completes an older configuration (`discover --apply`, empty
fields only, `worker.python` never touched), prints a startup plan (`startup-plan`:
URL, serve arguments, readiness checks as JSON) and sets the worker's environment from
`worker.package_path` and `[components]` itself. The desktop is a windowed
application that attaches the parent console when a shell starts it; with no
launcher environment it finds the supervisor (explicit override honoured or refused,
sibling, development layout, PATH) and the workspace under the user's local
application data, opens its window at once with the starting page, runs
configuration and the service start on one thread, loads the workbench when the
health check answers, and shows any failure in the window and an owned native
dialog with the supervisor's redacted stderr tail. Navigation allows the inline
pages only until the workbench loads.

Checks: Rust 30 (supervisor) + 18 (desktop) tests, clippy `-D warnings` and rustfmt
clean; live: bare `Start-Process 'Arc Science.exe'` on the pre-existing workspace →
window in 0.4 s, no console, workbench loaded, clean exit with the port free;
`ARC_DESKTOP_SUPERVISOR` naming a missing file → dialog with that reason; a
configuration naming a missing interpreter → dialog with the supervisor's line; a
headless `--check-startup` from PowerShell → readiness verified, exit 0.

## Evaluation of loop 1 (Sol): changes required → addressed → accept

| Finding | Severity | Resolution |
| --- | --- | --- |
| Self-configuration still ran before the window existed, so a missing supervisor or bad configuration was silent again | high | Configuration and discovery moved to the start thread after the window exists; window creation failure itself shows a dialog |
| Probes were deadline-bounded but not tree- or pipe-safe; then the deadline stopped at leader exit | medium | Probes spawn in a job object / process group, drain stdout concurrently, kill the tree once the leader answered, and collect output under the deadline; a fixture with a stdout-inheriting descendant passes in 0.5 s |
| `discover --apply` replaced a bare `worker.python` | medium | Never touched; documented |
| `data:` navigation allowed at any time | medium | Allowed only until the workbench loads |
| Shown stderr could carry a credential | low | Redaction of bearer values, secret `name=value`/`name: value` pairs and long opaque tokens before display; test |
| Found during the fixes: the executable was a console-subsystem binary | — | Windowed subsystem with parent-console attachment; the launcher waits explicitly |
| `load_url` failure was stderr-only; a README sentence described the old order | low | Same failure page and dialog; README corrected |
