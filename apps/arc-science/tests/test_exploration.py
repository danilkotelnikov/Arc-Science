"""Behavioral acceptance tests for a goal-led, bounded exploration loop."""
import asyncio
import copy
import pytest


def api():
    from arc_science.exploration.models import MissionRequest
    from arc_science.exploration.engine import explore
    from arc_science.exploration.agents import DemoAgent
    return MissionRequest, explore, DemoAgent


def demo(**kw):
    Request, explore, Agent = api()
    return asyncio.run(explore(Request(goal='Compare competing explanations of the response', **kw), Agent()))


def test_goal_alone_produces_multiple_competing_routes_and_real_computations():
    result = demo()
    assert len(result.branches) >= 3
    assert len(result.observations) >= 3
    assert {o.tool for o in result.observations} >= {'polynomial_fit', 'permutation_control'}
    assert result.status == 'completed'
    assert result.publication_eligible is False
    assert result.data_origin == 'synthetic_fixture'


def test_frontier_expands_after_linear_fit_is_challenged():
    result = demo()
    rounds = {b.id: b.created_round for b in result.branches}
    assert rounds['quadratic'] > rounds['linear']
    assert any(r.branch_id == 'linear' and r.position == 'challenge' for r in result.assessments)
    assert any(r.branch_id == 'quadratic' and r.position == 'support' for r in result.assessments)
    assert any(e.kind == 'focus_changed' for e in result.events)


def test_same_seed_has_same_scientific_fingerprint():
    a, b = demo(seed=71), demo(seed=71)
    assert a.scientific_digest == b.scientific_digest
    assert a.dataset_digest == b.dataset_digest


def test_different_input_changes_fingerprint():
    assert demo(seed=71).scientific_digest != demo(seed=72).scientific_digest


def test_action_budget_never_overruns():
    result = demo(max_actions=1)
    assert len(result.observations) == 1
    assert result.actions_used == 1
    assert result.status == 'budget_exhausted'


def test_model_budget_is_reserved_before_dispatch():
    result = demo(max_model_calls=1)
    assert result.model_calls_used == 1
    assert result.status == 'budget_exhausted'
    assert result.publication_eligible is False


def test_reviewers_run_concurrently():
    Request, explore, Agent = api()
    class ConcurrentAgent(Agent):
        active = 0
        peak = 0
        async def assess(self, role, context):
            self.active += 1
            self.peak = max(self.peak, self.active)
            await asyncio.sleep(.015)
            result = await super().assess(role, context)
            self.active -= 1
            return result
    agent = ConcurrentAgent()
    asyncio.run(explore(Request(goal='Explore the fixture'), agent))
    assert agent.peak == 2


def test_fabricated_evidence_cannot_be_committed_as_an_assessment():
    Request, explore, Agent = api()
    class Fabricator(Agent):
        async def assess(self, role, context):
            packet = await super().assess(role, context)
            packet['assessments'][0]['evidence_ids'] = ['nonexistent-result']
            return packet
    result = asyncio.run(explore(Request(goal='Explore the fixture'), Fabricator()))
    assert not result.assessments
    assert any(e.kind == 'review_rejected' for e in result.events)
    assert result.publication_eligible is False


def test_unregistered_shell_tool_is_not_executed():
    Request, explore, Agent = api()
    class ShellAgent(Agent):
        async def propose(self, context):
            packet = await super().propose(context)
            packet['actions'][0]['tool'] = 'shell'
            packet['actions'][0]['arguments'] = {'command': 'echo injected'}
            return packet
    result = asyncio.run(explore(Request(goal='Explore fixture', max_rounds=1), ShellAgent()))
    assert any(o.status == 'error' and o.tool == 'shell' for o in result.observations)
    assert not any(o.status == 'ok' and o.tool == 'shell' for o in result.observations)


def test_provider_failure_never_falls_back_to_synthetic_success():
    Request, explore, Agent = api()
    class Broken(Agent):
        async def propose(self, context):
            raise RuntimeError('secret-token-should-not-be-logged')
    result = asyncio.run(explore(Request(goal='Explore the fixture'), Broken()))
    assert result.status == 'error'
    assert 'secret-token-should-not-be-logged' not in result.model_dump_json()


def test_operational_tool_error_does_not_refute_scientific_hypothesis():
    Request, explore, Agent = api()
    class InvalidTool(Agent):
        async def propose(self, context):
            packet = await super().propose(context)
            packet['actions'][0]['arguments'] = {'degree': 999}
            return packet
    result = asyncio.run(explore(Request(goal='Explore fixture', max_rounds=1), InvalidTool()))
    assert any(o.status == 'error' for o in result.observations)
    assert all(a.position != 'refute' for a in result.assessments)


def test_resume_preserves_committed_observations():
    Request, explore, Agent = api()
    captured = []
    class Interrupted(RuntimeError): pass
    def emit(state):
        captured.append(state)
        if state.round == 1:
            raise Interrupted()
    request = Request(goal='Explore fixture')
    with pytest.raises(Interrupted):
        asyncio.run(explore(request, Agent(), emit=emit))
    previous = captured[-1]
    result = asyncio.run(explore(request, Agent(), initial=previous))
    assert result.status == 'completed'
    assert len({o.id for o in result.observations}) == len(result.observations)
    assert result.scientific_digest == demo().scientific_digest  # digest excludes free-form goal


def test_cancellation_stops_before_any_late_commit():
    Request, explore, Agent = api()
    from arc_science.exploration.engine import MissionCancelled
    async def run():
        with pytest.raises(MissionCancelled):
            await explore(Request(goal='Explore the fixture'), Agent(), cancelled=lambda: True)
    asyncio.run(run())


def test_input_is_frozen_and_live_mode_requires_explicit_egress_permission():
    Request, _, _ = api()
    with pytest.raises(Exception): Request(goal='Research target', mode='live')
    from arc_science.exploration.tools import synthetic_data, execute_numeric
    points = synthetic_data(8)
    before = copy.deepcopy(points)
    execute_numeric('permutation_control', {'permutations': 8}, points)
    assert points == before


def test_pure_fit_reproduces_known_quadratic():
    from arc_science.exploration.models import Point
    from arc_science.exploration.tools import execute_numeric
    points = tuple(Point(x=i/4, y=1+2*(i/4)+3*(i/4)**2) for i in range(32))
    result = execute_numeric('polynomial_fit', {'degree': 2}, points)
    assert result['coefficients'] == pytest.approx([1,2,3], abs=1e-8)
    assert result['validation_mse'] < 1e-14


def test_actual_reviewer_model_identity_is_recorded_separately():
    Request,explore,Agent=api()
    class DifferentModels(Agent):
        def model_for(self,role):return 'planner-model' if role=='planner' else 'reviewer-model'
    state=asyncio.run(explore(Request(goal='Explore fixture'),DifferentModels()))
    assert {r.model for r in state.model_records if r.role!='planner'}=={'reviewer-model'}
    assert all(r.context_digest for r in state.model_records)
