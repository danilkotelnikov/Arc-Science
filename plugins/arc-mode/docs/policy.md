# Arc Mode

Adds the Advanced page to Settings, with the Arc Harness mode switch, the list of what the mode contains, and the measured results.

## Purpose

Arc Mode lets you turn the written rules on or off in this app. It also shows what is installed and what has been measured, so a claim about the harness can be checked on one page.

## Policy

- The switch is off by default, and a missing or broken state file reads as off.
- While the switch is on, `shared/rules/common.md` goes into every system prompt of this app.
- The hooks and skills in the list run in Claude Code. The plugin reads their list and never writes their settings.
- A number shows only with its benchmark, model, date and sample size. Anything else shows as not measured.
- Private results sit in their own part and never count as an open benchmark.
- The page shows no estimated gain.

## Data

| File | Use |
|---|---|
| `~/.arc/arc-mode/mode.json` | Holds the switch. The plugin reads and writes it. |
| `~/.claude/settings.json` | Read only. Only hook names, events and home-relative paths leave the host. |
| `~/.claude/skills` | Read only. Gives the skill names. |
| `~/arc-harness/shared/rules/common.md` | Read only. Gives the written rules. |
| `~/arc-harness/bench/results.jsonl` | Read only. Gives the private bench rows. |
| `~/arc-harness/bench/baseline.json` | Read only. Gives the private work log rows. |
| `~/arc-harness/bench/open-results.jsonl` | Read only. Gives the rows of the open benchmarks. |

`ARC_HOME`, `CLAUDE_CONFIG_DIR` and `ARC_HARNESS` move these folders.

## Failure behaviour

A file that cannot be read gives an empty list or a "Not measured" row. A row with a missing field stays out, and the page says how many rows were left out. A failed save shows an error, and the switch keeps its old position.
