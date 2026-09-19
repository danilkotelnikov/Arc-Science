"""Consecutive figure-repair cycles (loop B of the 2026-09-19 program).

A visual review that finds only presentation problems (legibility, layout, labels,
overlap, contrast, legend, ticks, size) is answered by re-rendering the same data
under the next presentation preset and reviewing the result as a new candidate. The
repair never touches the data, the fit or the residuals; it changes canvas, margins
and type size. Anything else — a blocking finding, a finding about substance, an
uncertain reviewer, a reviewer error, a spent budget or a render that repeats an
existing image — ends the cycle with a recorded reason and leaves the mission where
a human has to look.
"""
from __future__ import annotations

from ..contracts import digest
from .models import RepairCycle, VisualReport
from .vision import VISUAL_PROMPT_VERSION

MAX_REPAIRS = 2
PRESET_SEQUENCE = ('spacious', 'large_text')
PRESENTATION = frozenset({'legibility', 'layout', 'labels', 'overlap', 'contrast', 'legend', 'ticks', 'size'})
# The policy a cycle ran under is recorded on the cycle; a mission that already holds
# cycles from another policy, or a review made under another prompt, gets no automatic
# repair — a human decides whether the old evidence still applies.
POLICY = {'version': 'arc-figure-repair-1', 'max_repairs': MAX_REPAIRS, 'presets': list(PRESET_SEQUENCE),
          'presentation': sorted(PRESENTATION), 'prompt_version': VISUAL_PROMPT_VERSION}
POLICY_DIGEST = digest(POLICY)
# Every policy a persisted cycle may cite, keyed by the digest it recorded. Cycles
# written before the digest existed (key None) ran under the same rules as version 1.
POLICIES = {POLICY_DIGEST: POLICY, None: {**POLICY, 'version': 'arc-figure-repair-0-unrecorded'}}


def repair_plan(report: VisualReport, repairs: tuple[RepairCycle, ...], round: int) -> tuple[str | None, str]:
    """The preset for the next cycle, or None with the reason no cycle may run."""
    if report.prompt_version != VISUAL_PROMPT_VERSION:
        return None, 'The review was made under prompt ' + report.prompt_version + ', not the current one; no automatic repair.'
    if any(cycle.policy_digest != POLICY_DIGEST for cycle in repairs):
        return None, 'The repair policy changed after an earlier cycle; no automatic repair.'
    if report.verdict != 'issues':
        return None, 'Only an issues verdict is repairable; ' + report.verdict + ' needs human input.'
    if any(finding.severity == 'blocking' for finding in report.findings):
        return None, 'A blocking finding is never repaired automatically.'
    substance = sorted({finding.category for finding in report.findings if finding.category not in PRESENTATION})
    if substance:
        return None, 'Findings outside presentation (' + ', '.join(substance)[:200] + ') need human input.'
    used = [cycle for cycle in repairs if cycle.round == round]
    if len(used) >= MAX_REPAIRS:
        return None, f'The repair budget of {MAX_REPAIRS} cycles is spent for this round.'
    return PRESET_SEQUENCE[len(used)], ''


def cycle_for(repairs: tuple[RepairCycle, ...], artifact_digests: tuple[str, ...]) -> int | None:
    """Index of the cycle whose rendered batch is exactly these artifacts."""
    for index, cycle in enumerate(repairs):
        if cycle.artifact_digests == artifact_digests:
            return index
    return None


def with_outcome(repairs: tuple[RepairCycle, ...], artifact_digests: tuple[str, ...], outcome: str,
                 reason: str = '') -> tuple[RepairCycle, ...]:
    """Record the fresh review's raw result on the cycle that produced the batch."""
    index = cycle_for(repairs, artifact_digests)
    if index is None:
        return repairs
    updated = repairs[index].model_copy(update={'outcome': outcome, 'reason': reason[:700]})
    return repairs[:index] + (updated,) + repairs[index + 1:]
