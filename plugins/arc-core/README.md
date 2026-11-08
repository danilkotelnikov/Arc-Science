# Arc core

Arc core provides the shared MCP server and core tools for Arc Kit.
It exposes six deterministic tools for shelf search, claim recording, gate checks, toolpack loading and shared memory.

## Tools

- `shelf.search` queries the local reference shelf and returns cards with identifier, name, domain, license and status.
- `claim.record` stores a claim in the claim graph and checks source identifiers under rule R006.
- `gate.check` normalizes the candidate hash and checks test results and prose findings.
- `toolpack.load` loads a named Workshop toolpack and checks folder scope for the inspect pack under rule R009.
- `memory.retain` checks the project, date and source tags before storing a memory note.
- `memory.recall` reads matching notes from the memory store within a token budget.

## Verification

Run the test suite from the repository root:

```powershell
node --test plugins/arc-core/test/core.test.mjs
```
