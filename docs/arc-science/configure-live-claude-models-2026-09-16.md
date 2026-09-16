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

Two styles are supported; pick one and provide the matching credential.

- **API key (recommended, reliable).** Leave `ARC_ANTHROPIC_AUTH` unset (default
  `x-api-key`). Put an Anthropic **API key** in the seat's token file. This is the
  supported path for a third-party service.
- **OAuth bearer.** Set `ARC_ANTHROPIC_AUTH=oauth`; the adapter then sends
  `Authorization: Bearer <token>`. Caveat, stated plainly: Anthropic **subscription**
  OAuth access tokens are generally scoped to first-party clients (e.g. Claude Code)
  and may be **rejected by the Messages API** for a separately deployed service, and
  OAuth may additionally require an `anthropic-beta` header this adapter does not add.
  Use this only with a token you know the API accepts; otherwise use an API key.

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
