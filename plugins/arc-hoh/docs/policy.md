# Harness of Harness

Keeps every task honest with a proposal step, a frozen candidate, an independent accept gate and a hash-chained ledger.

## Purpose

Harness of Harness makes the agent plan, test and prove its work in a fixed cycle. No agent accepts its own output. An independent reviewer calls a deterministic gate, and the gate writes each verdict to a tamper-evident ledger.

## Policy

- Every system prompt carries the operating contract. It covers the shared-memory rules, the Propose, Probe and Compose method, and a ten-step cycle.
- Use the cycle for any task with more than three steps. Smaller tasks skip it.
- The agent records a proposal before it builds. The freeze tool refuses a goal that has no proposal.
- The reviewer calls the accept gate. The agent that froze the candidate may not call it. The gate compares the agent ids that the runtime reports.
- The gate accepts only when a proposal and a freeze exist and the files still match the freeze.
- The gate also needs every check to exit 0 with an output excerpt, every probe to pass, and the preservation list to hold.
- The gate also needs every requirement verified and no blocking or major finding open.
- Missing evidence counts as unmet. A skipped check never turns into a pass.
- Cycle 4 or later is blocked. The agent stops and asks the user.
- Each verdict goes to the ledger and to shared memory.

## Workflow

1. Recall notes from shared memory.
2. Write a plan of at most seven steps. Give each step one acceptance check.
3. Call hoh_propose with the goal, hypothesis, boundary, checks and probes.
4. Record the plan in shared memory.
5. Build the change test-first.
6. Call hoh_freeze with the absolute paths of the files.
7. Start a fresh subagent that did not build the work.
8. Let the reviewer run the checks and the probes.
9. Let the reviewer call hoh_gate with the evidence.
10. Weigh each finding against evidence. Fix the real ones and freeze again.
11. Record the evidence in shared memory.
12. Read the record back.
13. Accept the work only when hoh_gate returns accepted.
14. After the third cycle, stop and ask the user.

## Settings

- ARC_HOH_BRIEF set to 0 switches off the shared-memory brief in the prompt.
- ARC_HOH_RETAIN set to 0 stops the gate from writing verdicts to shared memory.
- Both opt-outs also work under their original names, DSH_HOH_BRIEF and DSH_HOH_RETAIN.
- ARC_HOME moves the ledger folder. The default is the .arc folder in your home folder. An existing ledger in the original data folder stays in use until .arc has its own, so an upgrade keeps the chain.
- Fixed limits: three cycles, files up to 20 MB, six brief notes of 220 characters, a brief refresh every 20 minutes.

## Data it reads and writes

- Reads the files that hoh_freeze names. They must be regular files with absolute paths.
- Reads notes from shared memory through the local gateway on loopback port 7424.
- Writes the ledger to hoh/ledger.jsonl in the data folder. Each line holds the hash of the line before it.
- Writes each gate verdict to shared memory through the same gateway. Secret-shaped text is redacted first.

## Failure behavior

- When shared memory does not answer, the brief stays empty and the gate still returns its verdict.
- When the files change after the freeze, the gate returns unmet.
- When the runtime reports no agent ids, the gate cannot prove independence and returns unmet.
- When the ledger chain breaks, hoh_verify_ledger names the first bad entry.
- The gate checks the evidence it receives. A caller can still report a false exit code, so read the excerpts.

## How to verify

1. Check that `plugins/arc-hoh` is in the profile folder and that the Trace tab shows in the right sidebar.
2. Start a session and ask the agent to call hoh_verify_ledger.
3. Check that the answer reads Ledger intact with an entry count.
4. In the plugin source folder, run node --test test/hoh.test.mjs and check that every test passes.
