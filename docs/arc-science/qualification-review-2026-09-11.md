# Qualification increment: independent review record

Date: 2026-09-11. Base: `847781fbb4f767cee659e2e4ca8ae9db7d920c79`.
Initial reviewed head: `80ebeee4d151f7f1420e34ef44108f468ed259a7`.
Corrected reviewed head: `ce248cb6cea992647e29cbc2ace5ab04dfdceb2c`.

A separate read-only reviewer inspected the changed diagnostic, status records
and proposal. It checked executable/wheel/lockfile hashes, binary size, runtime
versions and Python JUnit counts, and independently ran the normal installed-wheel
check. It found one Important issue: optimized Python disabled the diagnostic's
assertions and allowed a source interpreter to produce a false installed-wheel
pass. A Minor issue was the missing Python prefix in the reproduction command.

Three real subprocess regressions reproduced false success with `-O`, `-OO` and
`PYTHONOPTIMIZE=1`. The fix rejects optimized host Python unconditionally before
the probe. The unoptimized original run is valid; the optimized false-pass log is
retained only as a failure reproducer. The reproduction command was corrected.

The reviewer also requested that the proposed memory design distinguish removal
from future retrieval from erasure of frozen mission-evidence copies. That policy
is now explicit in the proposal; it is not implemented functionality.

Re-review at `ce248cb` found no remaining Critical or Important issues. The
reviewer reran all four native BioArt cases and the release-to-installed-wheel
smoke successfully and checked the final 583-pass/six-skip suite log. The
qualification increment is ready for local integration. No remote merge or sync
was performed, and the proposal still requires the user's design approval.

Live NIH retrieval, Windows BioArt intake, browser pixels, actual Blender
requalification and native session-memory implementation remain separate gates.
