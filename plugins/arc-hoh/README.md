# Harness of Harness

Keeps every task honest with a proposal step, a frozen candidate, an independent accept gate and a hash-chained ledger.

Harness of Harness makes the agent plan, test and prove its work in a fixed cycle. No agent accepts its own output. An independent reviewer calls a deterministic gate, and the gate writes each verdict to a tamper-evident ledger.

The Trace tab in the right sidebar shows the ledger, newest first, with the chain check, and the memory brief the agent reads. It only reads. It asks for new data every 5 seconds while it is open.

The full policy is in docs/policy.md. It covers the rules, the workflow, the settings, the data the plugin reads and writes, the failure behavior and the steps that verify it.
