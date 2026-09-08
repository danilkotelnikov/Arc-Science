import asyncio
import pytest
from conftest import module
from test_core import context


def setup_case():
    c,candidate,*_=context()
    accepted=c.Decision(eligible=True,status='eligible_for_human_review',reasons=())
    rejected=c.Decision(eligible=False,status='blocked',reasons=('overlap',))
    return c,candidate,accepted,rejected


def test_bounded_repair_retests_new_candidate():
    p=module('improvement');c,candidate,accepted,rejected=setup_case();seen=[]
    async def evaluate(value):
        seen.append(value.digest)
        return accepted if len(seen)==2 else rejected
    async def plan(value,decision):
        return p.RevisionPlan(candidate_digest=value.digest,objective='Resolve label overlap.',
              targets=('panel-a',),preserve=('source coordinates','source data'))
    async def build(value,plan):
        return value.model_copy(update={'evidence_digests':('f'*64,)})
    result=asyncio.run(p.improve(candidate,planner=plan,builder=build,evaluator=evaluate,max_revisions=2))
    assert result.decision.eligible and len(seen)==2 and seen[0]!=seen[1]
    assert len(result.history)==2


@pytest.mark.parametrize('mutation',['same','policy','project'])
def test_builder_cannot_relabel_current_candidate_or_cross_boundaries(mutation):
    p=module('improvement');c,candidate,accepted,rejected=setup_case()
    async def evaluate(value):return rejected
    async def plan(value,decision):return p.RevisionPlan(candidate_digest=value.digest,
                   objective='Repair figure.',targets=('panel-a',),preserve=('source data',))
    async def build(value,plan):
        if mutation=='same':return value
        return value.model_copy(update={'policy_digest':'f'*64} if mutation=='policy' else {'project_id':'other'})
    with pytest.raises(p.RevisionRejected):
        asyncio.run(p.improve(candidate,planner=plan,builder=build,evaluator=evaluate,max_revisions=1))


def test_evaluation_failure_stays_blocked_and_stops_revision():
    p=module('improvement');_,candidate,_,_=setup_case()
    async def evaluate(value):raise RuntimeError('token must not leak')
    async def forbidden(*_):pytest.fail('Revision attempted without usable QA evidence')
    result=asyncio.run(p.improve(candidate,planner=forbidden,builder=forbidden,evaluator=evaluate,max_revisions=2))
    assert not result.decision.eligible and result.decision.reasons==('evaluation_unavailable',)
    assert 'token' not in str(result)


def test_revision_budget_exhaustion_never_promotes_last_attempt():
    p=module('improvement');_,candidate,_,rejected=setup_case()
    async def evaluate(value):return rejected
    async def forbidden(*_):pytest.fail('Budget exceeded')
    result=asyncio.run(p.improve(candidate,planner=forbidden,builder=forbidden,evaluator=evaluate,max_revisions=0))
    assert not result.decision.eligible and len(result.history)==1
