# Slice 2 — credentials and connections: development record

Date: 21 September 2026. Plan and acceptance: [agentic product specification](2026-09-21-agentic-product-spec.md) §3.3, §4 slice 2 and §5.
Agent: Claude Code (`claude-opus-5`, effort `xhigh`, ultracode orchestration). Nothing here
is a production, novelty or scientific-validity claim.

## Objective, preserve, acceptance

- **Objective.** A credential never crosses the page: the host shows the Windows
  credential prompt and stores the value in the Windows Credential Manager; the
  service reads it by name. Test for API seats with persisted results; Remove; a
  credential goes only to its provider's official origin unless the operator confirms a
  custom one; the per-provider sign-in modes from the specification's contract table
  with unavailable ones visibly blocked; the Anthropic Console profile of the external
  `ant` CLI detected and reported only.
- **Preserve.** The `arc-science credential` file store for browser and non-Windows use;
  scrubbed subprocess environments; nothing secret in page state, URLs, logs, readiness,
  probe records or tests; the probe cooldown and lock; the mission route snapshot.
- **Acceptance** (from the specification): native Store opens the Windows prompt and the
  page never holds the secret; Test records the observed identity or the failure; Remove
  empties the store; browser mode shows the terminal instruction; an unavailable OAuth
  mode is labelled with its official basis.

## Changes

- **Desktop host (Rust).** `credential.rs` (new) and `main.rs`: an IPC handler accepts
  `{kind: store-credential | remove-credential, name, provider}` only from a page whose
  document origin is the service's loopback origin (anything else is refused and logged
  without its body); a name is 1–80 characters of `[A-Za-z0-9._-]`, a provider one of
  the four. Store runs `CredUIPromptForWindowsCredentialsW` (generic credentials, the
  caption `Arc Science — credential <name> for <provider>`, plus `(diagnostic attach is
  on)` when attached), unpacks the answer, writes a generic credential
  `ArcScience/<name>` (user name = provider, blob = the secret as UTF-8, persisted for
  this user on this machine) and wipes every buffer that held the value; Remove calls
  `CredDeleteW`. The page receives `arc-credential` `{kind, name, provider, stored,
  cancelled, error}` through `evaluate_script`; the startup log and stderr carry the
  name and the outcome only. README: the boundary in full.
- **Supervisor (Rust).** `providers.<p>.custom_endpoint_confirmed: bool` (default false;
  older files load).
- **Service (Python).** `credentials.py` (new): `read_credential_manager(name)`
  (`CredReadW` on `ArcScience/<name>`, UTF-8, blob zeroed, `CredFree`), the store order
  file → Credential Manager → legacy environment files; a store that cannot be read is
  reported as such, not as "missing". One `access_grant()` for prose, missions and
  probes in the provider's official header style (`ARC_ANTHROPIC_AUTH` retired: no
  official basis for another token kind). `_endpoint_from_seat` refuses to build an
  Anthropic, OpenAI or Gemini seat whose endpoint origin is not the catalog's official
  origin unless the provider is confirmed, so neither a probe nor a mission sends a
  credential there. `POST /api/providers/{provider}/probe` covers all five seats of a
  provider (an inherited seat under its owner): CLI subjects as before, API subjects
  through the HTTP adapter with a text-only call, one call per distinct subject digest,
  results persisted per transport with `subject` and `subject_digest` so readiness
  matches them (`ready` / `failed` / `stale` for API seats as for CLI seats).
  Readiness facts gain `credential_store`, `endpoint_confirmed`, the state
  `seat.endpoint_unconfirmed`, Anthropic's `console_profile` (`ant auth status`,
  cost-free, cached 30 s, only "detected / profile name"), and `?fresh=1` re-reads the
  CLI login state and the `ant` profile.
- **Web.** Each seat card: for an API credential the name, `Store credential…` and
  `Remove credential` (desktop session only; in a browser the line `Store it from a
  terminal: arc-science credential --name <name> --data <data dir>`), an inline
  confirmation before Remove, `Test seat` behind a per-click consent tick (`One real
  call per distinct seat of <provider>; it spends tokens on your account`), and the
  verification line from readiness (`Last probe <time> · answering model … · identity
  …`, `Probe failed: …`, `Never probed`, or the stale form). For a CLI login: `Signed
  in via <exe> (<method>)` / `Not signed in`, the sign-in instruction and `Re-check`
  (readiness with `fresh`). The Connections section reads from readiness; Settings no
  longer calls `/api/capabilities`. Advanced: the custom-endpoint confirmation appears
  only when the origin differs from the official one, and typing another origin clears
  it. Sign-in methods list the `ant` profile as detected / not detected, "reported only,
  not used". Diagnostics: a `Last probe` column and the CLI login line per seat;
  `Refresh readiness (re-read logins)`. `main.jsx` deduplicates plain and fresh reads.

## Checks (per kind of evidence)

- Mocked: Vitest 13 files, 137 tests; pytest 825 passed / 65 skipped (the reviewer's
  run on the pre-fix tree; the post-fix run is recorded in the commit trailer) —
  including a real Credential Manager round trip under `ArcScience/arc-test-<uuid>`
  written with `CredWriteW` and deleted in `finally`, the store order, the API probe
  through `httpx.MockTransport` in both header styles with the secret absent from the
  persisted record, verified → stale on an effort change, the unconfirmed endpoint
  refusing readiness, probe and mission until confirmed, `fresh=1`, and the `ant` probe
  parsed from fake output; `native/arc-desktop` 39 passed / 2 ignored (message parsing,
  refusal without echo, the target name, the wiped buffer, the JS literal without the
  secret); `native/arc-science` 14 unit + 25 integration; fmt and clippy clean on both.
- Browser service: Playwright 26/26, with the terminal instruction, `Test seat` refused
  without consent, a consented probe of a seat with no stored credential answering
  `No credential named …` with nothing spent, and the custom-endpoint checkbox
  round-tripping through save.
- Native EXE (`Arc Science.exe` SHA-256
  `243718F3581A65BC2E6D21F1DF2793A3A51FC58CB5C405EAFBFD4ED2298E31E0`, 4,603,904 bytes —
  the first desktop rebuild of this increment, copied from `arc-science-desktop.exe`
  under the product name as the launcher does; supervisor
  `B0AD4CA0CD4863A4637AD01FAA643BDE8E5E2C17B618605271E8610FF391A93D`), fresh workspace,
  Playwright over the diagnostic attach (`msedgewebview2.exe <- Arc Science.exe`),
  `.omx/artifacts/slice2-native-20260921/report.json` and captures 01–08:
  - an OpenAI API seat saved with the name `arc-slice2-test` read `Blocked · No
    credential is stored under the name arc-slice2-test`, with `Store credential…` and
    `Remove credential` enabled and `cmdkey /list` showing no `ArcScience/` entry;
  - the credential was then seeded with the same `CredWriteW` call the host makes (a
    TEST value, never a real key) and Reload read `Not tested · Configured; never
    probed` with `Credential arc-slice2-test: stored in the Windows Credential
    Manager`; the page source contained no part of the value;
  - `Test seat` with consent made one real call to `api.openai.com` with that value,
    which the provider refused: `Failed · The last probe failed: Provider HTTP 401`,
    `Probe failed: Provider HTTP 401`, next action `Fix the cause, then test the seat
    again in Settings`; Diagnostics showed the same row with `Last probe` and the
    inherited reviewer and falsifier as `Not tested · uses the planner seat`;
  - `Remove credential` → inline confirmation → the host logged `Credential:
    remove-credential arc-slice2-test removed`, `cmdkey /list` showed nothing and the
    seat returned to `Blocked · No credential is stored`;
  - a Claude Code CLI seat read `Not tested · Configured; never probed` with its login
    line after `Re-check`, and the sign-in list read `CLI login (Claude Code): supported
    · API credential (Console key): supported · Console profile via the external ant
    CLI: detected (default) — reported only, not used · In-app provider OAuth:
    unavailable`, each with its basis;
  - an OpenAI endpoint off the official origin showed the confirmation checkbox and the
    line `Until this is ticked and saved, no probe or mission sends the credential
    there`;
  - `Store credential…` opened the Windows credential prompt (`CredentialUIBroker`,
    window class `Credential Dialog Xaml Host`, title `Безопасность Windows` on this
    Russian-locale machine) with the caption `Arc Science — credential arc-slice2-test
    for openai (diagnostic attach is on)` and the message text
    (`08-screen-windows-credential-prompt.png`, `run1-prompt-blocked/02b-*`); the page
    showed `Waiting for the Windows credential prompt…`.
- **The prompt accepts no automated input.** Its UI Automation tree is empty to an
  ordinary client, simulated keys (`SendKeys`) do not reach it, and the broker cannot be
  terminated by the user's own processes (access denied); it belongs to the Windows
  credential UI, which is the property this boundary relies on. Consequently the
  store path from a typed value to the Credential Manager entry was **not driven by a
  script**: the two halves are verified separately (the prompt opens with the right
  caption; a `CredWriteW` entry is read by the service, tested and observed), and the
  join needs a person: press `Store credential…`, type a key into Password, press OK,
  and watch the seat read `stored in the Windows Credential Manager`. The blocked test
  instance was terminated at the end (the prompt closes with its owner; the supervisor
  and service exited with it and the port was released).
- Two probe calls left this machine during this slice, both from the isolated test
  workspace: the seeded TEST value to `api.openai.com`, refused with 401 (no data
  beyond Arc's fixed probe instruction). The `ant auth status` reading and the CLI
  login reads are local processes.

## Independent review

- Reviewer (separate Claude context; code, suites and a live run of the rebuilt source
  through the real supervisor): **accept**, with eight minor findings — a refused IPC
  reply (`kind: null`) left the page waiting; the endpoint confirmation was not cleared
  when the endpoint changed; the consent copy understated the spend; the caption could
  hit the documented maximum exactly; the "User name is optional" wording is unverified
  against the prompt; a store read failure read as "missing"; the configuration note
  still described `ARC_ANTHROPIC_AUTH`; an unused constant. All but the wording one were
  applied by the orchestrator (the wording stays until a person completes the prompt
  once); the review is in `.omx/artifacts/slice2-native-20260921/`.
- Sol (GPT-5.6): blocked by the Codex usage limit until 25 September.

## Requirement states after this slice

| ID | State | Evidence |
| --- | --- | --- |
| A3 | partly verified | supported modes distinct and labelled with their basis (native `cli-seat`); Test and Remove verified natively; Store verified up to the prompt; the typed path needs a person; OAuth modes shown as unavailable / not in this build |
| J3 | partly verified; live success blocked | the revoked/invalid-credential path is verified (401 from the provider with a TEST value); a genuine sign-in success needs the operator's own key or CLI login and was not attempted; cancellation of the prompt needs a person |
| A2 | extended | API seats now reach `ready`/`failed` through a persisted probe; budgets and fallback policy still open |
| J2 | extended | an unavailable provider path shows the sign-in list with its basis and the next action per seat |

## Remaining gates

- A person completes and cancels the Windows prompt once and the record notes whether
  OK needs a user name.
- A successful probe of a seat with a real key or CLI login (operator's account).
- Grants, receipts and the mission grant preview (slice 3); the Connections table's
  "running route" is still absent (readiness reports seats, not the bound route).
- OpenClaw has no probe of its own beyond the API path.
