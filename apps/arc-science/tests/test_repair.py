"""Consecutive figure-repair cycles: presentation findings are re-rendered and
reviewed again as new candidates; everything else stays where a human has to look."""
import asyncio
import io
import json
import zipfile

import pytest

from arc_science.contracts import digest
from arc_science.exploration import release, repair
from arc_science.exploration.agents import DemoAgent, DemoVisionAgent
from arc_science.exploration.capsule import export_capsule, verify_capsule
from arc_science.exploration.engine import explore
from arc_science.exploration.evidence import validate_evidence
from arc_science.exploration.models import MissionRequest, VisualFinding, VisualReport
from arc_science.exploration.vision import VISUAL_PROMPT_VERSION, current_artifacts


def report(context, artifacts, verdict, findings=()):
    return VisualReport(candidate_digest=context['candidate_digest'],
                        reviewed_digests=tuple(a.digest for a in artifacts), verdict=verdict, findings=findings,
                        model='fixture-vision', round=context['round'], prompt_version=VISUAL_PROMPT_VERSION,
                        context_digest=digest(context), input_context=context)


def finding(artifact, category, severity='minor'):
    return VisualFinding(artifact_digest=artifact.digest, severity=severity, category=category, detail='Fixture finding.')


class Scripted(DemoAgent):
    """A vision seat that plays a fixed list of (verdict, category) per call; the
    scripted planner stops after the first round."""
    vision_model = 'fixture-vision'

    def __init__(self, *script):
        self.script = list(script)
        self.calls = []

    async def propose(self, context):
        if context['round'] == 0:
            return await super().propose(context)
        return {'branches': [], 'actions': [], 'stop': True, 'reason': 'Fixture stops after one round.'}

    async def review_visual(self, context, artifacts):
        self.calls.append(tuple((a.preset, a.digest) for a in artifacts))
        verdict, category = self.script.pop(0)
        if verdict == 'error':
            raise RuntimeError('reviewer failed')
        findings = tuple(finding(a, category) for a in artifacts) if category else ()
        return report(context, artifacts, verdict, findings)


def run(agent, **updates):
    request = MissionRequest(goal='Inspect the fixture', vision_review=True, **updates)
    return request, asyncio.run(explore(request, agent))


def test_a_presentation_finding_is_repaired_once_and_the_fresh_review_completes_the_mission():
    agent = Scripted(('issues', 'legibility'), ('adequate', None))
    request, state = run(agent)
    assert state.status == 'completed'
    originals = [a for a in state.artifacts if a.repair_of is None]
    repaired = [a for a in state.artifacts if a.repair_of]
    assert len(originals) == 1 and len(repaired) == 1
    assert repaired[0].preset == 'spacious' and repaired[0].repair_of == originals[0].digest
    assert repaired[0].digest != originals[0].digest and repaired[0].round == originals[0].round
    assert current_artifacts(state.artifacts) == (repaired[0],)
    # The repaired batch was reviewed as a new candidate with fresh eyes: two calls, two records.
    assert agent.calls == [(('default', originals[0].digest),), (('spacious', repaired[0].digest),)]
    assert [r.candidate_digest for r in state.vision_records] == [r.candidate_digest for r in state.visual_reports]
    assert len({r.candidate_digest for r in state.visual_reports}) == 2
    cycle, = state.repairs
    assert (cycle.cycle, cycle.preset, cycle.outcome, cycle.addressed) == (1, 'spacious', 'adequate', ('legibility',))
    assert cycle.superseded_digests == (originals[0].digest,) and cycle.artifact_digests == (repaired[0].digest,)
    assert cycle.trigger_report_digest == state.visual_reports[0].digest
    kinds = [e.kind for e in state.events]
    assert kinds.index('visual_review_accepted') < kinds.index('artifact_repaired') < kinds.index('visual_review_accepted', kinds.index('artifact_repaired'))
    # The whole state still binds, the capsule reproduces both renders, and the ledger reads only the current image.
    validate_evidence(state)
    verification = verify_capsule(export_capsule(request, state))
    assert verification['integrity'] and verification['artifacts_reproduced'] == 2
    decision = release.evaluate_release(request, state, release.receipt_from_report(verification, state), event_chain_ok=True)
    visual = next(c for c in decision.checks if c.name == 'visual_review')
    assert visual.state == 'satisfied' and 'Repair cycles: 1 (spacious) -> adequate' in visual.reason
    assert visual.evidence_digests == (repaired[0].digest,)
    with zipfile.ZipFile(io.BytesIO(export_capsule(request, state))) as z:
        exported = json.loads(z.read('state.json'))
    assert [a['preset'] for a in exported['artifacts']] == ['default', 'spacious'] and exported['repairs'][0]['outcome'] == 'adequate'


def test_persistent_issues_spend_two_cycles_then_block_for_a_human():
    agent = Scripted(('issues', 'layout'), ('issues', 'labels'), ('issues', 'overlap'))
    request, state = run(agent)
    assert state.status == 'needs_input' and 'visual' in state.stop_reason.lower()
    assert [c.preset for c in state.repairs] == ['spacious', 'large_text']
    assert [c.outcome for c in state.repairs] == ['issues', 'issues']
    assert [a.preset for a in state.artifacts] == ['default', 'spacious', 'large_text']
    assert len(agent.calls) == 3 and len(state.visual_reports) == 3
    blocked = [e for e in state.events if e.kind == 'visual_repair_blocked']
    assert blocked and 'budget of 2 cycles' in blocked[-1].detail
    validate_evidence(state)
    assert release.evaluate_release(request, state, None, event_chain_ok=True).eligible_for_human_review is False


@pytest.mark.parametrize('verdict,category,severity,expected', [
    ('issues', 'fit', 'minor', 'outside presentation (fit)'),
    ('issues', 'legibility', 'blocking', 'blocking finding'),
    ('uncertain', None, 'minor', 'uncertain needs human input'),
])
def test_substance_blocking_and_uncertain_reviews_are_never_repaired(verdict, category, severity, expected):
    class One(Scripted):
        async def review_visual(self, context, artifacts):
            self.calls.append(artifacts)
            findings = tuple(finding(a, category, severity) for a in artifacts) if category else ()
            return report(context, artifacts, verdict, findings)

    agent = One()
    request, state = run(agent)
    assert state.status == 'needs_input'
    assert state.repairs == () and len(state.artifacts) == 1 and len(agent.calls) == 1
    assert any(e.kind == 'visual_repair_blocked' and expected in e.detail for e in state.events)


def test_a_reviewer_error_on_the_repaired_candidate_stays_blocking():
    agent = Scripted(('issues', 'legibility'), ('error', None))
    request, state = run(agent)
    assert state.status == 'needs_input'
    cycle, = state.repairs
    assert cycle.outcome == 'rejected' and 'failed' in cycle.reason
    assert [r.status for r in state.vision_records] == ['accepted', 'rejected']
    validate_evidence(state)
    decision = release.evaluate_release(request, state, None, event_chain_ok=True)
    assert next(c.state for c in decision.checks if c.name == 'visual_review') == 'error'
    # Resuming does not silently retry the rejected call.
    resumed = asyncio.run(explore(request, agent, initial=state.model_copy(update={'status': 'paused'})))
    assert resumed.status == 'needs_input' and len(resumed.vision_records) == 2


def test_a_render_that_repeats_an_existing_image_blocks_the_cycle(monkeypatch):
    from arc_science.exploration import engine

    original = engine.artifact_for_observation

    def same_bytes(points, observation, **kwargs):
        kwargs.pop('preset', None)
        return original(points, observation, **kwargs) if kwargs.get('repair_of') is None else \
            original(points, observation, **{**kwargs, 'preset': 'default'}).model_copy(update={'repair_of': None})

    monkeypatch.setattr(engine, 'artifact_for_observation', same_bytes)
    agent = Scripted(('issues', 'legibility'))
    request, state = run(agent)
    assert state.status == 'needs_input'
    cycle, = state.repairs
    assert cycle.outcome == 'blocked' and 'already exists' in cycle.reason and cycle.artifact_digests == ()
    assert len(state.artifacts) == 1 and len(agent.calls) == 1
    validate_evidence(state)


def test_resume_after_a_repair_render_reviews_it_once_and_never_renders_it_again():
    class Interrupted(RuntimeError):
        pass

    captured = []

    def emit(state):
        captured.append(state)
        if any(e.kind == 'artifact_repaired' for e in state.events) and len(state.vision_records) == 1:
            raise Interrupted()

    agent = Scripted(('issues', 'legibility'), ('adequate', None))
    request = MissionRequest(goal='Inspect the fixture', vision_review=True)
    with pytest.raises(Interrupted):
        asyncio.run(explore(request, agent, emit=emit))
    checkpoint = captured[-1]
    assert len(checkpoint.artifacts) == 2 and checkpoint.repairs[0].outcome == 'pending'
    validate_evidence(checkpoint)
    resumed = asyncio.run(explore(request, agent, initial=checkpoint.model_copy(update={'status': 'paused'})))
    assert resumed.status == 'completed'
    assert len(resumed.artifacts) == 2 and len(resumed.repairs) == 1 and resumed.repairs[0].outcome == 'adequate'
    assert len(agent.calls) == 2 and agent.calls[1][0][0] == 'spacious'


def test_the_demo_vision_seat_is_scripted_and_runs_exactly_one_repair_cycle():
    request, state = run(DemoVisionAgent())
    assert state.status == 'completed'
    assert all(c.outcome == 'adequate' and c.cycle == 1 for c in state.repairs)
    assert {a.preset for a in current_artifacts(state.artifacts)} == {'spacious'}
    assert all(r.model == 'scripted-vision-fixture-v1' for r in state.visual_reports)
    assert all('Scripted fixture verdict' in f.detail for r in state.visual_reports for f in r.findings)
    validate_evidence(state)
    assert verify_capsule(export_capsule(request, state))['reproduction_passed']


def test_repair_plan_is_pure_and_ordered():
    class R:
        def __init__(self, verdict, findings):
            self.verdict, self.findings = verdict, findings

    class F:
        def __init__(self, category, severity='minor'):
            self.category, self.severity = category, severity

    assert repair.repair_plan(R('issues', [F('legibility'), F('ticks')]), (), 0) == ('spacious', '')
    assert repair.repair_plan(R('issues', [F('legibility'), F('coherence')]), (), 0)[0] is None
    assert repair.repair_plan(R('adequate', []), (), 0)[0] is None
    from arc_science.exploration.models import RepairCycle
    one = RepairCycle(cycle=1, round=0, preset='spacious', trigger_report_digest='a' * 64, addressed=('legibility',),
                      superseded_digests=('b' * 64,), artifact_digests=('c' * 64,), outcome='issues')
    assert repair.repair_plan(R('issues', [F('legibility')]), (one,), 0) == ('large_text', '')
    two = one.model_copy(update={'cycle': 2, 'preset': 'large_text', 'superseded_digests': ('c' * 64,), 'artifact_digests': ('d' * 64,)})
    assert 'budget' in repair.repair_plan(R('issues', [F('legibility')]), (one, two), 0)[1]
    assert repair.repair_plan(R('issues', [F('legibility')]), (one, two), 1) == ('spacious', '')
