# A review checklist

Status: Partly. The repository holds the automatic checks listed below, and the plugin `arc-hoh` enforces the cycle for agent tasks. The review checklist for a change to this kit is a method that we ask for. The repository holds no review records.

This page describes a checklist for a change. Its point is that the person who writes a change does not certify it.

## The checklist

1. **Plan.** Write a small plan with a clear boundary. Say what the change does, what it does not do, and what evidence will show it works.
2. **Build, with tests.** Write the checks before the code. Then write the code until the checks pass.
3. **Freeze.** Stop editing. The candidate is now one fixed state. Note exactly which files and which commit it is.
4. **Independent review.** A different reviewer looks at the frozen candidate. The reviewer reads the code and runs read-only commands. The reviewer does not edit or fix.
5. **Evidence before acceptance.** A review finding counts only when it comes with evidence: a line, a command and its output.
   The change is accepted only when every question on a short list is answered yes. Two examples are "all checks pass" and "no personal data in the diff".
   Agreement between reviewers does not replace a check.

If a check fails, start again from the plan or the build. Do not patch the frozen candidate in place.

## The same cycle inside the app

The plugin `arc-hoh` puts this cycle into the app for an agent's task. Its full policy is in `plugins/arc-hoh/docs/policy.md`.

- The agent records a proposal with `hoh_propose` before it builds. `hoh_freeze` refuses a goal that has no proposal.
- `hoh_freeze` fixes the files by their hashes.
- A reviewer that did not build the work calls `hoh_gate`. The agent that froze the candidate may not call it. The gate compares the agent ids that the runtime reports.
- The gate accepts only when the files still match the freeze and every check exits 0 with an output excerpt. Every probe must pass, and no blocking or major finding may be open. Missing evidence counts as unmet.
- Each step goes into a hash-chained ledger. `hoh_verify_ledger` names the first bad entry when the chain breaks.
- From the fourth cycle on, the gate blocks. The agent stops and asks the user.

The Trace tab in the right sidebar shows the ledger. The gate checks the evidence it receives, and a caller can still report a false exit code, so read the excerpts.

## The automatic checks in the repository

- Every build patch counts the places it changed and stops on a wrong count. A patch cannot half apply.
- Two scans read the same archive with different code, so a mistake in one shows in the other.
- A positive control runs the scans on the original archive. A scan that reads nothing fails there.
- The privacy scan runs before anything is published. Run it yourself with `npm run scan`.
- CI runs the syntax check, the rename map check, the icon color test, the two plugin tests, the privacy scan self-test and the privacy scan on every push. The file is `.github/workflows/ci.yml`. Run the first four yourself with `npm test`.

## Evidence levels

A page that shows a number or a picture says where it came from. Measured means a test or a tool produced it on this build. Published means a source outside the project says so.
Planned means it does not exist yet. A page never claims more than the project has. That is why every wiki page starts with a Status line.

## What you can do

When you send a change, say which checks you ran and show their output. A reviewer can run them again on the frozen state.
