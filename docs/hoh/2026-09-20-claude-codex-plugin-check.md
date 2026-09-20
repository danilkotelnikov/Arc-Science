# Claude↔Codex plugin inspection

Date: 20 September 2026. Scope: local, read-only inspection of the Claude Code plugin surface on this Windows host. No Codex inference or authentication probe was performed by this inspection.

`claude plugin list` reported `codex@openai-codex`, version `1.0.4`, user scope, enabled. Its installed manifest at `C:/Users/danil/.claude/plugins/cache/openai-codex/codex/1.0.4/.claude-plugin/plugin.json` names OpenAI's `codex` plugin and describes reviewing code or delegating tasks from Claude Code. Inspected command definitions in the same plugin's `commands/` directory include `setup.md`, `review.md`, `adversarial-review.md`, `rescue.md`, `status.md` and `result.md`.

- `/codex:setup` checks whether the local Codex CLI is ready. It can ask about installation if Codex is missing; that conditional choice is not itself proof of a working account.
- `/codex:review --wait` and `/codex:adversarial-review --wait <focus>` review local git state through the plugin. Their command files say they are review-only, forward output verbatim and use `--wait` to skip the plugin's foreground/background question.
- `/codex:rescue --fresh <bounded task>` invokes the `codex:codex-rescue` agent and a Codex companion task. Its command file says `--fresh` avoids the resume-candidate question. Assign disjoint ownership if the task edits files.

This inspection verifies **installed command definitions only**. It does not prove that Claude account credit, Codex CLI authentication, Codex model selection or the plugin transport works today. Re-run `claude plugin list`, inspect the current command files, and use `/codex:setup` before pairing. A prior Claude Opus/Sonnet request in this project returned `Credit balance is too low`, and a native Codex explorer attempt selected an unsupported `gpt-5.3-codex-spark` model for this ChatGPT account. If either account or transport is blocked, record the blockage and continue only with independently available local work; do not fabricate a review.
