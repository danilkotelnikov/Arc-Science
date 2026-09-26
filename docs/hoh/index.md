# Arc Science development checkpoint

Arc Science is developed in bounded loops (Harness-of-Harness): a plan, one writer per
file set, a frozen candidate, independent review, then evidence. The gates it is measured
against are the [product gates](specification.md); the research each design choice rests
on is the [research dossier](2026-09-25-research-dossier.md) (work first posted on or after
1 July 2026). Records of earlier loops (18 to 25 September 2026) are in the git history
at commit f31a498.

## Where it stands — 26 September 2026

- **Brand.** The "as" monogram on a continuous-corner tile beside ARC SCIENCE in
  MuseoModerno Black, built from geometry by `scripts/build-logo.py` to the operator's
  production files; the same tile is the favicon and the desktop icon.
- **Interface.** Every workspace of the desktop app (Research, Memory, Molecules, BioArt,
  Prose, Settings, Diagnostics) is on Blockprint over HeroUI v3, in English and Russian,
  set in Kyiv Type Sans, with eight palettes. The Research cockpit shows a mission as
  Overview, Claims, Evidence, Activity, Permissions and Release. The dev-only prototype is
  retired.
- **Repository.** Arc Science only: the Vedix plugin it grew out of lives in its own
  repository. Licensed under CC BY-NC-SA 4.0.

## Next loop, proposed

The interface now shows everything the service records. The next gain is in what the
service can say about a claim, so the proposed next loop is **S6, the validation ladder**:

1. `exploration/validation.py` assigns each claim a rung (L0 asserted, L1 traced, L2
   recomputed, L3 pre-specified, L4 severe, L5 replicated) from persisted evidence only;
   agreement between model seats never raises a rung.
2. Claim cards and the Release tab show the rung and what the next rung needs; release
   requires a minimum rung per claim type.
3. Tests: an agreement-only claim stays at or below L1; a claim whose numbers do not
   resolve to an artifact cannot pass L1.

After it: S8 (visual approvals queue), S9 (LaTeX studio), S11 (lossless memory), S12
(prose style panel), in the order of the approved plan. Two smaller items can ride along:
split HeroUI's stylesheet to the components used (425 KB of CSS today, target 120 KB),
and translate the service's free-text meanings, which still reach the Russian interface
in English.

## Open gates

- Live model providers, live BioRender and NIH transfer are not qualified in this loop.
- macOS and Linux desktop builds are not qualified; the service and its tests run on Linux.
- The Russian copy has been reviewed by agents against a glossary, not yet by a native
  reader in daily use.
- Nothing here is scientific validation of any result the workbench produces.
