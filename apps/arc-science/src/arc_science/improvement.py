"""Bounded artifact/evidence improvement, with fixed acceptance authority.

Callables are trusted service adapters. Production deployments must isolate the
builder from the evaluator's filesystem, credentials and sealed test data.
"""
from __future__ import annotations
import asyncio
import math
from typing import Awaitable, Callable
from pydantic import Field
from .contracts import Candidate, Decision, Digest, Identifier, Record

class RevisionPlan(Record):
    candidate_digest: Digest
    objective: str = Field(min_length=1, max_length=600)
    targets: tuple[Identifier, ...] = Field(min_length=1, max_length=8)
    preserve: tuple[str, ...] = Field(default=(), max_length=32)

class Iteration(Record):
    candidate_digest: Digest
    decision: Decision
    next_plan: RevisionPlan | None = None

class ImprovementResult(Record):
    candidate: Candidate
    decision: Decision
    history: tuple[Iteration, ...]

class RevisionRejected(ValueError):
    pass

async def improve(initial: Candidate, *,
                  planner: Callable[[Candidate, Decision], Awaitable[RevisionPlan]],
                  builder: Callable[[Candidate, RevisionPlan], Awaitable[Candidate]],
                  evaluator: Callable[[Candidate], Awaitable[Decision]],
                  max_revisions: int = 3, total_timeout: float = 600) -> ImprovementResult:
    """Evaluate, plan a bounded repair, build, and independently evaluate again.

    Source artifacts, project, producer and policy remain fixed within the run.
    A changed source requires a new scientific run, not a cosmetic repair. The
    evaluator must execute the real governor; builder claims cannot grant acceptance.
    """
    if not isinstance(max_revisions,int) or not 0<=max_revisions<=20:
        raise ValueError('Invalid revision budget')
    if not math.isfinite(total_timeout) or total_timeout<=0:
        raise ValueError('Invalid total timeout')
    candidate=Candidate.model_validate_json(initial.model_dump_json())
    protected={(a.name,a.digest) for a in initial.artifacts if a.role=='source'}
    seen={candidate.digest};history=[]
    decision=Decision(eligible=False,status='blocked',reasons=('not_evaluated',))
    try:
        async with asyncio.timeout(total_timeout):
            for iteration in range(max_revisions+1):
                try:
                    response=await evaluator(candidate)
                    decision=Decision.model_validate_json(response.model_dump_json())
                    if decision.eligible != (decision.status=='eligible_for_human_review'):
                        raise ValueError('Inconsistent decision')
                    if decision.eligible and decision.reasons:
                        raise ValueError('Eligible decision has blockers')
                except Exception:
                    decision=Decision(eligible=False,status='blocked',reasons=('evaluation_unavailable',))
                    history.append(Iteration(candidate_digest=candidate.digest,decision=decision))
                    break
                if decision.eligible or iteration==max_revisions:
                    history.append(Iteration(candidate_digest=candidate.digest,decision=decision))
                    break
                plan=await planner(candidate,decision)
                plan=RevisionPlan.model_validate_json(plan.model_dump_json())
                if plan.candidate_digest!=candidate.digest:
                    raise RevisionRejected('Plan does not reference the assessed candidate')
                history.append(Iteration(candidate_digest=candidate.digest,decision=decision,next_plan=plan))
                revised=await builder(candidate,plan)
                revised=Candidate.model_validate_json(revised.model_dump_json())
                if (revised.project_id,revised.policy_digest,revised.producer_id)!=(
                        initial.project_id,initial.policy_digest,initial.producer_id):
                    raise RevisionRejected('Builder changed a fixed run boundary')
                if {(a.name,a.digest) for a in revised.artifacts if a.role=='source'} != protected:
                    raise RevisionRejected('Builder changed protected scientific inputs')
                if revised.digest in seen:
                    raise RevisionRejected('Revision repeats an already assessed candidate')
                candidate=revised;seen.add(candidate.digest)
    except TimeoutError:
        decision=Decision(eligible=False,status='blocked',reasons=('improvement_timeout',))
        history.append(Iteration(candidate_digest=candidate.digest,decision=decision))
    return ImprovementResult(candidate=candidate,decision=decision,history=tuple(history))
