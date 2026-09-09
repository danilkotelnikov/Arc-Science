# Renderer containment continuation — 9 September 2026

**Disposition: independently approved and locally qualified for the Linux
executor.** This continuation addresses inherited Important finding I1 without
changing the scientific example, renderer styling, BioArt policy, or user interface.
The final implementation is in commits
`a885dc109bdcd03b336136a1d7a8745783c9f43e`,
`609283540c4e0bf703b576b0a02d757d2da4e6b9`, and
`bb63e45088cf998370b888e887f3d7f04f0dfba7`, based on the reviewed BioArt setup
checkpoint `cda462854ec1c857c174070dc3e98dee8556a767`.

## Review-driven root cause

Native owns Python through a Unix process group or Windows Job Object. The original
Python executor created a separate renderer session. A second native cancellation
could therefore kill Python before Python killed that detached renderer.

An intermediate fix made Python share the outer group when native set an
`ARC_NATIVE_CONTAINMENT` marker. A first independent review rejected that design for
two concrete reasons:

1. after the renderer leader exited successfully, Python could no longer kill its
   still-live descendants before validating outputs; and
2. a process-group leader could spoof the environment marker without proving that an
   outer supervisor actually owned its descendants.

That marker contract and its Rust changes were removed. The final branch has no net
Rust source change from the reviewed base for this finding.

## Final containment contract

The Linux executor now starts an isolated Python watchdog as the leader of a private
renderer process group. Two anonymous pipes make its ownership explicit:

1. The executor retains the only control-pipe writer. The watchdog checks the read
   end before spawning and throughout execution. Abrupt executor death closes the
   writer in the kernel, and EOF makes the watchdog kill its complete process group.
2. The watchdog retains the only status-pipe writer. It launches the renderer in its
   own group without passing either protocol descriptor to the renderer.
3. When the renderer leader exits, the watchdog reaps it, atomically publishes its
   actual signed exit status, then kills its own group. The executor waits for the
   watchdog to exit and accepts only the bounded status protocol before returning.
4. On timeout, cooperative cancellation, invalid protocol, or watchdog failure, the
   executor independently kills the watchdog group and reaps its direct child.
5. Inherited `ARC_NATIVE_CONTAINMENT` values have no effect. Native and standalone
   launches use the same inner ownership mechanism.

This closes the post-render mutation window for trusted renderer descendants that
remain in the owned group. A child that deliberately calls `setsid` or otherwise
escapes that process group is outside this process-group boundary; this is not
cgroup/container isolation.

## Test-first evidence

The process-lifetime regressions use real processes and FIFO sole-writer witnesses,
not mocked death or `/proc` absence.

- Force cancellation: a renderer writes its PID to a FIFO and keeps the only writer
  open while Python is deliberately blocked after OS acquisition. The test sends
  SIGTERM twice through the retained native binary and requires FIFO EOF and native
  exit 130.
- Successful leader exit: a renderer spawns a descendant that ignores SIGTERM,
  redirects stdout/stderr away from the parent, owns the FIFO writer, then the leader
  exits 0. The executor parent stays alive for 60 seconds after `_execute` returns.
  The test observes the return marker and then requires bounded FIFO EOF while that
  parent is still alive, distinguishing watchdog cleanup from eventual parent-exit
  cleanup. The implementation's status-before-return ordering is separately visible
  in the reviewed control path.
- Status-reader loss: the test closes the only status-pipe reader, releases a
  successful renderer leader, and requires watchdog exit plus descendant FIFO EOF.
  This proves an `EPIPE` cannot bypass group teardown.

| Check | Result | Interpretation |
|---|---:|---|
| Double-signal test before any fix | **Failed as expected:** `renderer survived repeated native cancellation` | Reproduced the inherited I1 leak |
| Leader-exit test against the rejected marker design | **1 passed, 1 failed as expected** in 3.52 s; contained-parent failed | Proved the independent review finding before redesign |
| Status-reader-loss test before the final teardown fix | **Failed as expected:** `status publication failure leaked descendant` | Reproduced the second-review EPIPE path |
| Final renderer-lifetime file | **12 passed** in 5.29 s | Covers poll/acquisition/setup cancellation, repeated native cancellation, normal descendant cleanup, status-protocol loss, handler restoration, and direct-child reaping |
| Figure-render suite | **87 passed, 4 skipped** in 7.58 s | Includes bounded logs, timeouts, inherited stdout, checkpoints, and artifact verification; skips require an explicitly configured official Blender Python runtime |
| Complete Arc application suite | **560 passed, 6 skipped** in 47.97 s | All available application tests with `PYTHONPATH=src`; six existing explicit Blender-runtime skips |
| Lifecycle stress loop | **20/20 invocations; 60/60 cases passed** | Repeated double-signal, leader-exit, and status-reader-loss cases |
| Python bytecode compilation and `git diff --check` | Passed | Syntax and whitespace checks |

Two read-only review rounds rejected the intermediate designs before the final
approval. The final reviewer reported no Critical, Important, or Minor code findings
and independently ran the combined lifecycle/figure-render set: **99 passed, 4
explicit Blender-runtime skips**.

The tests used Python 3.12.14 in the project-local environment. The retained native
binary predates the rejected marker change, which is appropriate because the final
design requires no native marker or Rust modification. The native regression is a
real native → Python → watchdog → renderer execution and ran without injecting a
containment marker.

No live NIH, BioRender, model-provider, or Blender request ran in this continuation.
The skipped Blender tests therefore remain an explicit rendering-quality gate rather
than an inferred pass.

## Remaining qualification boundary

The current result is Linux process-lifecycle evidence. The artifact executor already
requires Linux no-follow and descriptor-relative filesystem primitives. It does not
qualify Windows/macOS rendering, an official Blender build, scientific correctness,
or visual publication quality. The inherited root-suite 24-failure maintenance item
is unchanged and separately documented.

The authenticated GitHub connector could read `danilkotelnikov/vedix`, but creating
the `Arc-Science` development ref returned HTTP 403 (`Resource not accessible by
integration`). No remote branch or pull request was created; this remains a local,
unmerged development checkpoint as the user authorized.
