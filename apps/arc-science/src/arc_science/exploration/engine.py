"""Model-led branch expansion; deterministic limits and evidence binding.

The loop constrains actions and acceptance, not the order of scientific reasoning.
All built-in tools are pure/read-only. Resume may retry an interrupted read-only
call, so external metered or mutating services must not be inserted unmediated.
"""
from __future__ import annotations
import asyncio
import time
from .models import (MissionRequest, MissionState, Branch, Proposal, Reconciliation,
                     Observation, Assessed, Event, ModelRecord, VisionRecord, RepairCycle, VisualReport, UnboundCall,
                     WITHHOLDS, operator_directives)
from .tools import synthetic_data, execute_numeric, CATALOG, TOOL_VERSION
from .artifacts import artifact_for_observation
from .claim_scope import derive_claim_scope
from .repair import POLICY_DIGEST as REPAIR_POLICY_DIGEST, repair_plan, with_outcome
from .vision import VISUAL_PROMPT_VERSION, current_artifacts, required_visual_reason, visual_context, validate_report
from .catalog import (BIORENDER_CATALOG, BUILTIN_CATALOG, PUBLIC_CATALOG, TrustedPublicTools,
                      trusted_replay, trusted_version, validate_arguments, validate_catalog)
from .evidence import validate_evidence
from .spend import spent, tally
from ..contracts import digest

# The vision_required cause of each reason required_visual_reason can return: a review that
# found problems is recorded as such, never as a coverage gap.
VISUAL_CAUSES = {
    'Required visual review has no generated fit artifacts to inspect.': 'no_artifacts',
    'Required visual review contains blocking findings; human input is required.': 'blocking_findings',
    'Required visual review reported issues or uncertainty; human input is required.': 'not_adequate',
    'Required visual review is missing exact coverage for one or more generated artifacts.': 'coverage',
    'Required visual review did not return an accepted artifact-bound report.': 'record_not_accepted',
}

# Stops that over_budget itself makes; every other non-error stop checks the budgets first.
BUDGET_STOPS = ('token_limit', 'cost_limit', 'time_limit', 'budget_unmeasurable')


def plan_digest(record):
    """What an operator decision binds to: the committed planner record of its round."""
    return digest(record)


def operator_decisions(state):
    """Every recorded operator decision in order, with the change that carries it."""
    return [{'change_id': c.id, 'at': c.at, **d.model_dump(mode='json')}
            for c in state.changes if c.kind == 'decision' for d in c.decisions]

def asks_for_more(decisions, round_number):
    """Whether this round's decisions refuse a stopping plan. The latest decision on a target
    stands. A proposal decision answers the plan itself: pursue accepts it, anything else asks
    again. Without one, a request_test on a branch, or a pursue on a branch parked or dropped in
    an earlier round, asks for work the plan does not propose."""
    now=[d for d in decisions if d['round']==round_number]
    proposal=next((d['directive'] for d in reversed(now) if d['target']=='proposal'),None)
    if proposal:return proposal!='pursue'
    before={d['target_id']:d['directive'] for d in decisions if d['target']=='branch' and d['round']<round_number}
    latest={d['target_id']:d['directive'] for d in now if d['target']=='branch'}
    return any(v=='request_test' or (v=='pursue' and before.get(k) in WITHHOLDS) for k,v in latest.items())


class MissionCancelled(RuntimeError): pass

class ProposalRejected(ValueError):
    """A plan the engine refused; the message is the engine's own and safe to show."""


def initialize(request: MissionRequest) -> MissionState:
    points=request.points or (synthetic_data(request.seed) if request.mode=='demo' else ())
    origin='user_supplied' if request.points else ('synthetic_fixture' if request.mode=='demo' else 'none')
    return MissionState(request_digest=digest(request), data_origin=origin, points=points,
                        dataset_digest=digest([p.model_dump(mode='json') for p in points]))

async def explore(request: MissionRequest, agent, *, initial=None, emit=None, cancelled=None, extra_tools=None, log=None, clock=None):
    # clock() -> minutes the mission has run, across resumes; the service reads it from the
    # timeline. Without one, only this run is timed.
    # log('started', operation=..., ...) -> op and log('finished', op, outcome=..., ...) write the
    # operational timeline; the engine's state, reservations and commit order do not depend on it.
    log=log or (lambda phase,op=None,**fields:None)
    began=time.monotonic()
    clock=clock or (lambda:(time.monotonic()-began)/60)
    state=initial or initialize(request)
    if getattr(agent,'requires_egress',False) and not request.allow_egress:
        raise ValueError('Live model agents require explicit mission egress consent')
    extra_tools=extra_tools or {}
    trusted_public=isinstance(extra_tools,TrustedPublicTools)
    trusted_external={**PUBLIC_CATALOG,**BIORENDER_CATALOG}
    execution_policy={};claim_policy={}
    for name,(spec,_) in extra_tools.items():
        if name in trusted_external and not (trusted_public and spec==trusted_external[name]):
            raise ValueError(f'Extra tool {name} collides with a trusted runtime adapter')
        if name in BUILTIN_CATALOG and name not in trusted_external:
            raise ValueError(f'Extra tool {name} collides with a trusted built-in')
        policy=spec.get('execution','external_connector')
        if policy not in {'external_connector','local_pure'}:
            raise ValueError(f'Extra tool {name} has an unsupported execution policy')
        execution_policy[name]='external_connector' if name in trusted_external else policy
        claim_policy[name]=name in trusted_external or spec.get('claim_eligible',True) is not False
    extra_catalog=validate_catalog({name:value[0] for name,value in extra_tools.items()})
    runtime_catalog={**(CATALOG if state.points else {}),**extra_catalog}
    if state.request_digest!=digest(request): raise ValueError('The mission contract changed')
    if state.dataset_digest!=digest([p.model_dump(mode='json') for p in state.points]):
        raise ValueError('Frozen dataset changed')
    validate_evidence(state)
    if state.status in {'completed','budget_exhausted','needs_input','cancelled'}: return state
    if state.claim_scope is not None:
        # A resumed mission may change its evidence; the old scope no longer applies.
        state=MissionState.model_validate({**state.model_dump(),'claim_scope':None})
    def check_cancel():
        if cancelled and cancelled(): raise MissionCancelled('Cancelled; late results discarded')
    def change(**updates):
        nonlocal state
        state=MissionState.model_validate({**state.model_dump(),**updates})
    def event(kind,detail):
        change(events=state.events+(Event(kind=kind,round=state.round,detail=detail[:1200]),))
    def commit():
        check_cancel()
        if emit: emit(state)
    def stop(status,code,reason,**facts):
        # code is an error_codes.STOP_CODES key; facts are the variable parts of reason.
        # The last step's spend is checked before any other terminal transition.
        if status!='error' and code not in BUDGET_STOPS and (over:=over_budget()) is not None:return over
        op=log('started',operation='stop',role='engine',round=state.round,detail=reason[:300])
        # Every stop states what the evidence supports so far; the scope is derived,
        # never authored, and a resumed mission derives it again at its next stop.
        if status in ('completed','budget_exhausted','needs_input'):
            scope=derive_claim_scope(state)
            change(claim_scope=scope)
            event('claim_scope_derived',', '.join(f'{k}: {v}' for k,v in scope.counts.items()))
        change(status=status,stop_reason=reason,stop_code=code,stop_facts=facts);event('mission_stopped',reason);commit()
        log('finished',op,outcome=status)
        return state
    def identity(role):
        return agent.model_for(role) if hasattr(agent, "model_for") else agent.model
    def provenance(role):
        # Transports that record per-call evidence hand it over exactly once per record;
        # a live transport that has none for this call fails closed.
        if not hasattr(agent, 'take_provenance'): return None
        record=agent.take_provenance(role)
        if record is None: raise ValueError('Missing transport provenance for '+role)
        return record
    def unbound(role):
        # The transport record of a call whose answer was rejected or failed, taken so its
        # usage still counts; None when the transport kept nothing (a cut-off call).
        return agent.take_provenance(role) if hasattr(agent,'take_provenance') else None
    def unbound_call(role,transport):
        failed=transport.get('outcome')=='failed'
        return UnboundCall(role=role,round=state.round,outcome='failed' if failed else 'rejected',transport=transport)
    def context(reviewing=None,planning=False):
        # A vision seat sees earlier rounds plus exactly the batch it reviews, and no
        # same-round report: a repair is reviewed with fresh eyes as a new candidate.
        artifacts=state.artifacts if reviewing is None else tuple(a for a in state.artifacts if a.round<state.round)+reviewing
        reports=state.visual_reports if reviewing is None else tuple(r for r in state.visual_reports if r.round<state.round)
        # Earlier work the operator attached goes to the planner and reviewers only, and only
        # when there is some, so contexts recorded without it keep their shape. A prior
        # mission's claim statuses are earlier model agreement: the planner reads them, the two
        # reviewers do not, so their support stays independent of that verdict.
        items=[i.model_dump(mode='json') for i in request.context_items if planning or i.kind!='mission'] if reviewing is None else []
        earlier={'mission_context':items} if items else {}
        # Every operator directive so far goes to the planner as operator input, never to the reviewers.
        directives=operator_directives(operator_decisions(state)) if planning else []
        if directives:earlier['operator_directives']=directives
        return {**earlier,'goal':request.goal,'round':state.round,'data_origin':state.data_origin,
                'dataset':{'digest':state.dataset_digest,'n':len(state.points)},
                'branches':[b.model_dump(mode='json') for b in state.branches],
                'observations':[o.model_dump(mode='json') for o in state.observations],
                'assessments':[a.model_dump(mode='json') for a in state.assessments],
                'artifacts':[a.manifest() for a in artifacts],
                'visual_reports':[r.manifest() for r in reports],
                'tools':runtime_catalog,
                'remaining':{'rounds':request.max_rounds-state.round,'actions':request.max_actions-state.actions_used},
                'rule':'All results remain exploratory. Never fabricate evidence. Preserve contradictory assessments.'}
    def calls_left(phase,needed):
        return {'phase':phase,'needed':needed,'max_model_calls':request.max_model_calls,'model_calls_used':state.model_calls_used}
    def reserve_calls(number):
        if state.model_calls_used+number>request.max_model_calls: return False
        change(model_calls_used=state.model_calls_used+number);commit()
        return True
    def over_budget():
        # ponytail: checked before each model step (one planner call, two concurrent reviewer
        # calls or one vision call), so a budget is overshot by at most one step's usage;
        # reserve worst-case tokens per step if exact caps matter.
        if request.max_tokens is None and request.max_cost_usd is None and request.max_minutes is None:return None
        used=spent(state);measured=len(tally(state)[0])
        if request.max_tokens is not None:
            if not used['measured']:
                return stop('needs_input','budget_unmeasurable','A model call answered without reporting usable token usage, so the token budget cannot be enforced.',
                            kind='tokens',limit=request.max_tokens,calls=used['calls'],measured_calls=measured)
            tokens=used['input_tokens']+used['output_tokens']
            if tokens>=request.max_tokens:
                return stop('budget_exhausted','token_limit','Token budget reached; remaining alternatives are unresolved.',
                            kind='tokens',spent=tokens,limit=request.max_tokens)
        if request.max_cost_usd is not None:
            if used['cost_usd'] is None:
                return stop('needs_input','budget_unmeasurable','A model call answered without reporting its cost, so the cost budget cannot be enforced.',
                            kind='cost_usd',limit=request.max_cost_usd,calls=used['calls'],measured_calls=measured)
            if used['cost_usd']>=request.max_cost_usd:
                return stop('budget_exhausted','cost_limit','Cost budget reached; remaining alternatives are unresolved.',
                            kind='cost_usd',spent=used['cost_usd'],limit=request.max_cost_usd)
        if request.max_minutes is not None:
            minutes=clock()
            if minutes>=request.max_minutes:
                return stop('budget_exhausted','time_limit','Time budget reached; remaining alternatives are unresolved.',
                            kind='minutes',spent=round(minutes,3),limit=request.max_minutes)
        return None
    # A start or resume clears the previous stop's code; the next stop records its own.
    change(status='running',stop_code='',stop_facts={});commit()
    while state.round < request.max_rounds:
        check_cancel()
        committed_plan=next((record for record in state.model_records
                             if record.role=='planner' and record.round==state.round),None)
        if state.actions_used>=request.max_actions and committed_plan is None:
            return stop('budget_exhausted','action_limit','Action limit reached; untested alternatives remain unresolved.',
                        max_actions=request.max_actions,actions_used=state.actions_used)
        if over_budget() is not None:return state
        op=None;called=False
        try:
            if committed_plan is None:
                if not reserve_calls(1): return stop('budget_exhausted','call_limit','Model-call limit reached.',**calls_left('plan',1))
                planning_context=context(planning=True)
                op=log('started',operation='plan',role='planner',round=state.round,model_requested=identity('planner'))
                called=True
                raw=await asyncio.wait_for(agent.propose(planning_context),timeout=90)
                plan=Proposal.model_validate(raw)
            else:
                planning_context=committed_plan.input_context
                plan=Proposal.model_validate(committed_plan.payload)
                log('finished',log('started',operation='plan',role='planner',round=state.round,model_requested=committed_plan.model,
                                   detail='Planner record for this round reused; no call was made.'),outcome='reused')
            ids={b.id for b in state.branches};branches=list(state.branches)
            for idea in plan.branches:
                if idea.id in ids:
                    old=next(b for b in branches if b.id==idea.id)
                    if old.model_dump(exclude={'created_round'})!=idea.model_dump():
                        raise ProposalRejected('A prior hypothesis cannot be silently rewritten')
                    continue
                if idea.id in idea.parents or not set(idea.parents)<=ids: raise ProposalRejected('Unbound or cyclic parent')
                if len(branches)>=request.max_branches: raise ProposalRejected('Branch budget exceeded')
                # A measurable falsifier must name a tool this mission can actually run.
                if idea.falsifier_test and idea.falsifier_test.tool not in runtime_catalog:
                    raise ProposalRejected('Branch '+idea.id+": the falsifier test names a tool the mission's action catalogue "
                                           'does not offer (offered: '+(', '.join(sorted(runtime_catalog)) or 'none')+')')
                branches.append(Branch(**idea.model_dump(),created_round=state.round));ids.add(idea.id)
            if len({a.id for a in plan.actions})!=len(plan.actions): raise ProposalRejected('Duplicate actions')
            if any(a.branch_id not in ids for a in plan.actions): raise ProposalRejected('Unknown branch')
            # An action ID names one request for the whole mission: a withheld action never ran,
            # so only earlier plans, not observations, show its identity is taken.
            earlier={a.id:a for r in state.model_records if r.role=='planner' and r.round<state.round
                     for a in Proposal.model_validate(r.payload).actions}
            reused=next((a.id for a in plan.actions if a.id in earlier and earlier[a.id]!=a),None)
        except Exception as why:
            if op:log('finished',op,outcome='error',detail='Planning failed validation or provider execution.')
            # Accounting never depends on the optional timeline logger.
            transport=unbound('planner') if called else None
            if transport is not None:change(unbound_calls=state.unbound_calls+(unbound_call('planner',transport),))
            # Only the engine's own refusals are quoted; provider and schema errors may carry model text.
            reason=' Rejected: '+str(why)+'.' if isinstance(why,ProposalRejected) else ''
            return stop('error','planning_failed','Planning failed validation or provider execution. No synthetic fallback was used.'+reason,
                        rejected=isinstance(why,ProposalRejected))
        if reused:
            # Refused before the plan is committed, so the record stays verifiable and a
            # resume asks the planner again.
            if op:log('finished',op,outcome='error',detail='An action ID was reused with different inputs.')
            transport=unbound('planner') if called else None
            if transport is not None:change(unbound_calls=state.unbound_calls+(unbound_call('planner',transport),))
            return stop('error','action_reused','An action ID was reused with different inputs.',action_id=reused)
        records=state.model_records
        if committed_plan is None:
            transport=provenance('planner');log('finished',op,outcome='ok',transport=transport)
            records=records+(ModelRecord(role='planner',round=state.round,model=identity('planner'),
                    context_digest=digest(planning_context),input_context=planning_context,payload=plan.model_dump(mode='json'),
                    transport=transport),)
        change(branches=tuple(branches),model_records=records)
        event('plan_committed',plan.reason or 'Bounded exploratory actions proposed.')
        # Gate each_round: nothing runs and nothing stops until the operator has decided on this round's plan.
        if request.gate=='each_round' and not any(c.kind=='decision' and c.round==state.round for c in state.changes):
            committed=next(r for r in state.model_records if r.role=='planner' and r.round==state.round)
            return stop('paused','awaiting_decision',f"The plan for round {state.round} waits for the operator's decision.",
                        round=state.round,plan_digest=plan_digest(committed))
        decisions=operator_decisions(state)
        if (plan.stop or not plan.actions) and asks_for_more(decisions,state.round):
            # The operator refused a plan that would end the mission, or asked for work it does not
            # propose: the round closes and the planner is asked again with the directives.
            event('round_closed','The operator asked for more work than this plan proposes; the planner is asked again.')
            change(round=state.round+1);commit()
            continue
        if plan.stop:
            if not state.observations: return stop('needs_input','no_observations',plan.reason or 'More evidence or tools are required.')
            if request.vision_review:
                reason=required_visual_reason(state.artifacts,state.visual_reports,state.vision_records)
                if reason:return stop('needs_input','vision_required',reason,cause=VISUAL_CAUSES.get(reason,'incomplete'))
            return stop('completed','plan_stop',plan.reason or 'Exploratory planning stopped; human review is still required.')
        if not plan.actions: return stop('needs_input','no_actions','No executable actions proposed; additional data or tools are required.')
        # Operator decisions withhold work, never evidence: the latest directive on a branch
        # stands across rounds, and a proposal directive covers its own round's plan.
        standing={d['target_id']:d for d in decisions if d['target']=='branch'}
        proposal=next((d for d in reversed(decisions) if d['target']=='proposal' and d['round']==state.round),None)
        actions=[];withheld=[]
        for a in plan.actions:
            # Already ran (its identity was checked against the earlier plans before commit).
            if any(o.id==a.id for o in state.observations):continue
            why=proposal if proposal and proposal['directive'] in WITHHOLDS else standing.get(a.branch_id)
            if why and why['directive'] in WITHHOLDS:withheld.append((a,why));continue
            actions.append(a)
        for a,why in withheld:
            if not any(e.kind=='action_withheld' and e.round==state.round and e.detail.startswith(a.id+':') for e in state.events):
                event('action_withheld',f"{a.id}: branch {a.branch_id}; {why['directive']} by decision {why['change_id']}")
        if withheld and not actions and not any(o.round==state.round for o in state.observations):
            # Nothing of this plan runs: the round closes with no tool run and no review call.
            event('round_closed','Every action of this plan was withheld by the operator; no tool ran and no review was requested.')
            change(round=state.round+1);commit()
            continue
        reserved=max(0,state.actions_used-len(state.observations))
        actions=actions[:request.max_actions-state.actions_used+reserved]
        # Reserve before dispatch; an interrupted attempt is conservatively charged.
        change(actions_used=state.actions_used+max(0,len(actions)-reserved));commit()
        semaphore=asyncio.Semaphore(request.max_parallel)
        async def execute(action):
            async with semaphore:
                check_cancel()
                op=log('started',operation='tool',role='tool',round=state.round,tool=action.tool,action_id=action.id,branch_id=action.branch_id)
                try:
                    validate_arguments(action.tool,action.arguments,runtime_catalog)
                    if action.tool in extra_tools:
                        if execution_policy[action.tool]!='local_pure' and not request.allow_egress:
                            raise ValueError('External tools require explicit mission egress consent')
                        _, function=extra_tools[action.tool]
                        data=await asyncio.wait_for(function(action.arguments),30)
                        version=trusted_version(action.tool) or 'arc-external-snapshot-1'
                    else:
                        data=await asyncio.to_thread(execute_numeric,action.tool,action.arguments,state.points)
                        version=TOOL_VERSION
                    status='ok'
                except Exception:
                    data={'error':'Tool rejected input or execution failed; no scientific conclusion follows.'}
                    status='error'
                    policy=trusted_replay(action.tool)
                    version=TOOL_VERSION if policy=='numerical' else (trusted_version(action.tool) or 'unregistered-1')
                replayable=trusted_replay(action.tool)=='numerical'
                log('finished',op,outcome=status)
                check_cancel()
                return Observation(id=action.id,action=action,tool=action.tool,tool_version=version,
                    branch_id=action.branch_id,round=state.round,status=status,data=data,
                    dataset_digest=state.dataset_digest,request_digest=digest([action.model_dump(mode='json'),state.dataset_digest]),
                    replayable=replayable,claim_eligible=claim_policy.get(action.tool,True))
        observations=await asyncio.gather(*(execute(a) for a in actions))
        change(observations=state.observations+tuple(observations))
        for o in observations: event('observation',o.id+': '+o.status)

        # Render each successful fit once from the complete frozen dataset. Existing
        # source bindings are reused on resume rather than regenerated.
        artifact_sources={artifact.source_observation_id for artifact in state.artifacts}
        try:
            rendered=(artifact_for_observation(state.points,observation) for observation in observations
                      if observation.status=='ok' and observation.tool=='polynomial_fit'
                      and observation.id not in artifact_sources)
            known_digests={artifact.digest for artifact in state.artifacts}
            created_list=[]
            for artifact in rendered:
                if artifact.digest not in known_digests:
                    created_list.append(artifact);known_digests.add(artifact.digest)
            created=tuple(created_list)
            if len(state.artifacts)+len(created)>64:
                raise ValueError('Artifact count exceeds the mission limit')
        except Exception:
            return stop('error','render_failed','Trusted plot rendering failed validation; no visual success was inferred.',phase='render')
        if created:
            change(artifacts=state.artifacts+created)
            for artifact in created:event('artifact_rendered',artifact.digest)
            commit()

        if request.vision_review:
            # Review the current (unsuperseded) images of this round; a review that finds
            # only presentation problems is answered by a repair cycle: the same data is
            # re-rendered under the next preset and reviewed again as a new candidate.
            # Resume is safe: a batch with an accepted record is not reviewed twice, and
            # a repair already rendered is found as the current batch, not rendered again.
            while True:
                batch=tuple(artifact for artifact in current_artifacts(state.artifacts) if artifact.round==state.round)
                if not batch:break
                if len(batch)>8:
                    return stop('needs_input','vision_required','Required visual review exceeds the eight-image review limit.',
                                cause='image_limit',images=len(batch),limit=8)
                batch_digests=tuple(artifact.digest for artifact in batch)
                prior=next((record for record in state.vision_records
                            if record.round==state.round and record.reviewed_digests==batch_digests),None)
                if prior is not None:
                    if prior.status!='accepted':
                        return stop('needs_input','vision_required','A reserved or rejected visual call cannot be repeated automatically; operator input is required.',
                                    cause='not_repeatable',record_status=prior.status)
                    report=next(r for r in state.visual_reports if r.digest==prior.report_digest)
                else:
                    vcontext=visual_context(context(reviewing=batch),batch)
                    candidate=vcontext['candidate_digest']
                    vision_model=getattr(agent,'vision_model',None)
                    if not vision_model or not callable(getattr(agent,'review_visual',None)):
                        return stop('needs_input','vision_required','Required vision review has no configured vision seat.',cause='no_seat')
                    if state.model_calls_used+1>request.max_model_calls:
                        return stop('budget_exhausted','call_limit','Model-call limit reached before required visual review.',**calls_left('visual_review',1))
                    if over_budget() is not None:return state
                    reservation=VisionRecord(candidate_digest=candidate,
                        reviewed_digests=batch_digests,
                        context_digest=digest(vcontext),input_context=vcontext,
                        prompt_version=VISUAL_PROMPT_VERSION,round=state.round,model=vision_model,status='reserved')
                    change(model_calls_used=state.model_calls_used+1,
                           vision_records=state.vision_records+(reservation,))
                    commit()
                    op=log('started',operation='visual_review',role='vision',round=state.round,model_requested=vision_model)
                    try:
                        report=VisualReport.model_validate(await asyncio.wait_for(
                            agent.review_visual(vcontext,batch),timeout=90))
                        validate_report(report,vcontext,batch,vision_model)
                        # The call's usage is bound to its record; a live transport without one fails closed.
                        vtransport=provenance('vision')
                    except Exception:
                        log('finished',op,outcome='error',detail='Missing, failed, malformed or unbound visual review.')
                        rejected=reservation.model_copy(update={'status':'rejected','transport':unbound('vision')})
                        change(vision_records=state.vision_records[:-1]+(rejected,),
                               repairs=with_outcome(state.repairs,batch_digests,'rejected','The fresh review failed or was unbound; no success inferred.'))
                        event('visual_review_rejected','Missing, failed, malformed or unbound visual review; no success inferred.')
                        return stop('needs_input','vision_required','Required visual review failed or lacked exact artifact coverage.',cause='review_failed')
                    log('finished',op,outcome='ok')
                    accepted=reservation.model_copy(update={'status':'accepted','report_digest':report.digest,'transport':vtransport})
                    change(vision_records=state.vision_records[:-1]+(accepted,),
                           visual_reports=state.visual_reports+(report,),
                           repairs=with_outcome(state.repairs,batch_digests,report.verdict))
                    event('visual_review_accepted',report.verdict+': '+candidate)
                    commit()
                preset,why=repair_plan(report,state.repairs,state.round)
                if preset is None:
                    if report.verdict!='adequate':event('visual_repair_blocked',why)
                    break
                # Re-render the whole reviewed batch under the preset: a new candidate with
                # new digests. A render that repeats an existing image proves the preset
                # changed nothing, so the cycle is recorded as blocked instead.
                sources={o.id:o for o in state.observations}
                cycle=dict(cycle=len([c for c in state.repairs if c.round==state.round])+1,round=state.round,
                    policy_digest=REPAIR_POLICY_DIGEST,preset=preset,trigger_report_digest=report.digest,
                    addressed=tuple(sorted({f.category for f in report.findings}))[:32],superseded_digests=batch_digests)
                try:
                    repaired=tuple(artifact_for_observation(state.points,sources[a.source_observation_id],
                                   preset=preset,repair_of=a.digest,round=state.round) for a in batch)
                    if len(state.artifacts)+len(repaired)>64:raise ValueError('Artifact count exceeds the mission limit')
                except Exception:
                    return stop('error','render_failed','Trusted plot rendering failed validation during repair; no visual success was inferred.',phase='repair')
                known={a.digest for a in state.artifacts}
                if any(a.digest in known for a in repaired):
                    change(repairs=state.repairs+(RepairCycle(**cycle,outcome='blocked',
                        reason='The '+preset+' preset rendered an image that already exists; the repair changed nothing.'),))
                    event('visual_repair_blocked','Repeated candidate under preset '+preset)
                    commit();break
                change(artifacts=state.artifacts+repaired,
                       repairs=state.repairs+(RepairCycle(**cycle,artifact_digests=tuple(a.digest for a in repaired)),))
                event('artifact_repaired',f"cycle {cycle['cycle']} ({preset}): "+', '.join(a.digest[:12] for a in repaired))
                commit()
        if over_budget() is not None:return state
        if not reserve_calls(2): return stop('budget_exhausted','call_limit','Insufficient remaining calls for the independent reconciliation roles.',
                                            **calls_left('reconcile',2))
        frozen=context()
        async def review(role):
            op=log('started',operation='reconcile',role=role,round=state.round,model_requested=identity(role))
            try:
                packet=Reconciliation.model_validate(await asyncio.wait_for(agent.assess(role,frozen),timeout=90))
                known={o.id for o in state.observations}
                if any(a.branch_id not in ids or not set(a.evidence_ids)<=known for a in packet.assessments):
                    raise ValueError('Fabricated evidence')
                for a in packet.assessments:
                    referenced=[o for o in state.observations if o.id in a.evidence_ids]
                    if a.position=='support' and not any(o.status=='ok' and o.claim_eligible for o in referenced):
                        raise ValueError('Tool failures and connector content cannot support a hypothesis')
                return role,packet,op
            except Exception: return role,None,op
        # Neither invocation sees the other's current-round answer.
        packets=await asyncio.gather(review('analyst'),review('falsifier'))
        check_cancel()
        assessments=list(state.assessments);records=list(state.model_records);unbound_calls=list(state.unbound_calls)
        for role,packet,op in packets:
            # Every reviewer call hands over its transport record, answer accepted or not;
            # a live transport without one fails closed.
            transport=unbound(role)
            if transport is None and hasattr(agent,'take_provenance'):packet=None
            if packet is None:
                if transport is not None:unbound_calls.append(unbound_call(role,transport))
                log('finished',op,outcome='error',detail='missing, malformed or unbound review')
                event('review_rejected',role+': missing, malformed or unbound review; no success inferred.')
                continue
            log('finished',op,outcome='ok',transport=transport)
            records.append(ModelRecord(role=role,round=state.round,model=identity(role),context_digest=digest(frozen),input_context=frozen,payload=packet.model_dump(mode='json'),transport=transport))
            assessments.extend(Assessed(**a.model_dump(),role=role,round=state.round,model=identity(role)) for a in packet.assessments)
        change(assessments=tuple(assessments),model_records=tuple(records),unbound_calls=tuple(unbound_calls))
        fits=[o for o in state.observations if o.status=='ok' and o.tool=='polynomial_fit']
        focus=min(fits,key=lambda o:(o.data['validation_mse'],o.id)).branch_id if fits else state.focus
        if focus!=state.focus:
            event('focus_changed',f'{state.focus or "unselected"} -> {focus}; exploratory fit error, not scientific confidence.')
            change(focus=focus)
        change(round=state.round+1);commit()
    return stop('budget_exhausted','round_limit','Round limit reached; remaining alternatives are unresolved.',max_rounds=request.max_rounds)
