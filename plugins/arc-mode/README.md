# Arc Mode

Adds the Advanced page to Settings, with the Arc Harness mode switch, the list of what the mode contains, and the measured results.

The switch is off by default. While it is on, the written rules go into every system prompt of this app. The hooks and skills in the list run in Claude Code, so the switch does not change them.

To install it, copy this folder to `~/.arc/local-plugins/arc-mode`. Add a `file:` dependency and a bundle line to each profile, as `arc-hoh` has. Do not run `lean-profile apply` for this: it keeps only its own list, and a profile can hold more.

The full policy is in docs/policy.md.
