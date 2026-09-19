---
title: Configure live missions to run through Claude Opus 5 / Sonnet 5
date: 2026-09-16
status: Code + config ready; the credential is operator-supplied (one manual step)
---

# Running live missions through Claude

Arc Science's live model seats call a provider's HTTPS endpoint directly (no CLI, no
process exec). This routes the planner, the independent reviewer, and the vision seat
to Claude. **One step is yours:** the credential. It cannot be created in a
non-interactive session and is never stored in this repo.

## Model seats

| Seat | Env | Recommended model |
| --- | --- | --- |
| Planner | `ARC_PROVIDER=anthropic`, `ARC_MODEL` | `claude-opus-5` |
| Reviewer | `ARC_REVIEWER_MODEL` (provider defaults to `ARC_PROVIDER`) | `claude-sonnet-5` |
| Vision (if `vision_review`) | `ARC_VISION_MODEL` | `claude-sonnet-5` |

Endpoint defaults to `https://api.anthropic.com/v1/messages`
(`ARC_PROVIDER_URL` / `ARC_REVIEWER_URL` / `ARC_VISION_URL` to override).

## Authentication

Three routes; pick one.

- **Claude subscription through Claude Code (the OAuth route, added 2026-09-19).**
  Set `ARC_PROVIDER=claude-code` and `ARC_CLAUDE_CODE_EXE` to the absolute path of the
  installed `claude` executable (the launcher does both with `-ClaudeCode claude`). The
  planner and reviewer seats then run each call as `claude -p` with every tool, MCP
  server, hook, plugin, skill and session persistence disabled, in an empty private
  directory, under a scrubbed environment, a 75 s deadline and, on Windows, a
  kill-on-close job object. The CLI performs its own login and refresh; Arc never
  reads or stores the credential. Log in once with `claude login` in a terminal.
  The transport is honest about what it is: `GET /api/capabilities` reports the
  executable, its digest and version, the CLI's own `auth status` (cost-free) and
  `network_sandboxed: false` (the CLI's own transport reaches Anthropic, which is what
  mission egress consent authorizes). `POST /api/providers/claude-code/probe` makes one
  explicit, token-spending minimal call per configured model and reports the observed
  identity or the CLI's error (`auth_expired`, `credit_exhausted`, …). Visual review is
  not available through this transport; give the vision seat an API key.
- **API key (direct HTTPS).** Leave `ARC_ANTHROPIC_AUTH` unset (default `x-api-key`).
  Put an Anthropic **API key** in the seat's token file.
- **Bearer token (direct HTTPS).** Set `ARC_ANTHROPIC_AUTH=bearer` (`oauth` is accepted
  as the older spelling) and the adapter sends `Authorization: Bearer <token>`. Use
  this only with a token Anthropic issued for a third-party service; subscription
  OAuth tokens belong to Claude Code and are not impersonated here.

## The one manual step — supply the credential

Store the token in a file the server reads (never a prompt, never the repo):

```bash
arc-science credential --name planner --data ./data     # then paste the token
arc-science credential --name reviewer --data ./data
arc-science credential --name vision --data ./data       # only if vision_review
```

or point the env token files at existing files: `ARC_MODEL_TOKEN_FILE`,
`ARC_REVIEWER_TOKEN_FILE`, `ARC_VISION_TOKEN_FILE` (planner/reviewer fall back to
`ARC_MODEL_TOKEN_FILE`). Credentials for the planner, reviewer and vision seats stay
separate; reusing one model in multiple roles is recorded accurately and is **not**
independent scientific corroboration.

## Example (subscription through Claude Code)

```powershell
claude login                                   # once, interactive
.\scripts\start-arc-science.ps1 -ClaudeCode claude   # planner claude-opus-5, reviewer claude-sonnet-5
```

or for a plain service: `ARC_PROVIDER=claude-code`, `ARC_CLAUDE_CODE_EXE=C:\…\claude.exe`,
`ARC_MODEL=claude-opus-5`, `ARC_REVIEWER_MODEL=claude-sonnet-5`, then
`arc-science serve --data ./data`. Check `GET /api/capabilities` (`live.transport.logged_in`)
and, when you are ready to spend a few tokens, `POST /api/providers/claude-code/probe`.

## Example (API key)

```bash
export ARC_PROVIDER=anthropic
export ARC_MODEL=claude-opus-5
export ARC_REVIEWER_MODEL=claude-sonnet-5
export ARC_VISION_MODEL=claude-sonnet-5
export ARC_MODEL_TOKEN_FILE=./data/anthropic.key   # your API key, 0600
arc-science serve --data ./data
```

Then create a mission with `mode: "live"` and check `GET /api/capabilities` —
`live.configured` is `true` when the seats and credential are in place. A live run is
still exploratory: model agreement is not scientific validity, and publication stays
disabled.
