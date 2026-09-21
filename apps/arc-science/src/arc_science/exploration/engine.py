"""Model-led branch expansion; deterministic limits and evidence binding.

The loop constrains actions and acceptance, not the order of scientific reasoning.
All built-in tools are pure/read-only. Resume may retry an interrupted read-only
call, so external metered or mutating services must not be inserted unmediated.
"""
from __future__ import annotations
import asyncio
from .models import (MissionRequest, MissionState, Branch, Proposal, Reconciliation,
                     Observation, Assessed, Event, ModelRecord, VisionRecord, RepairCycle, VisualReport)
from .tools import synthetic_data, execute_numeric, CATALOG, TOOL_VERSION
from .artifacts import artifact_for_observation
from .claim_scope import derive_claim_scope
from .repair import POLICY_DIGEST as REPAIR_POLICY_DIGEST, repair_plan, with_outcome
from .vision import VISUAL_PROMPT_VERSION, current_artifacts, required_visual_reason, visual_context, validate_report
from .catalog import (BIORENDER_CATALOG, BUILTIN_CATALOG, PUBLIC_CATALOG, TrustedPublicTools,
                      trusted_replay, trusted_version, validate_arguments, validate_catalog)
from .evidence import validate_evidence
from ..contracts import digest

class MissionCancelled(RuntimeError): pass


def initialize(request: MissionRequest) -> MissionState:
    points=request.points or (synthetic_data(request.seed) if request.mode=='demo' else ())
    origin='user_supplied' if request.points else ('synthetic_fixture' if request.mode=='demo' else 'none')
    return MissionState(request_digest=digest(request), data_origin=origin, points=points,
                        dataset_digest=digest([p.model_dump(mode='json') for p in points]))

async def explore(request: MissionRequest, agent, *, initial=None, emit=None, cancelled=None, extra_tools=None, log=None):
    # log('started', operation=..., ...) -> op and log('finished', op, outcome=..., ...) write the
    # operational timeline; the engine's state, reservations and commit order do not depend on it.
    log=log or (lambda phase,op=None,**fields:None)
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
    def stop(status,reason):
        op=log('started',operation='stop',role='engine',round=state.round,detail=reason[:300])
        # Every stop states what the evidence supports so far; the scope is derived,
        # never authored, and a resumed mission derives it again at its next stop.
        if status in ('completed','budget_exhausted','needs_input'):
            scope=derive_claim_scope(state)
            change(claim_scope=scope)
            event('claim_scope_derived',', '.join(f'{k}: {v}' for k,v in scope.counts.items()))
        change(status=status,stop_reason=reason);event('mission_stopped',reason);commit()
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
    def context(reviewing=None):
        # A vision seat sees earlier rounds plus exactly the batch it reviews, and no
        # same-round report: a repair is reviewed with fresh eyes as a new candidate.
        artifacts=state.artifacts if reviewing is None else tuple(a for a in state.artifacts if a.round<state.round)+reviewing
        reports=state.visual_reports if reviewing is None else tuple(r for r in state.visual_reports if r.round<state.round)
        return {'goal':request.goal,'round':state.round,'data_origin':state.data_origin,
                'dataset':{'digest':state.dataset_digest,'n':len(state.points)},
                'branches':[b.model_dump(mode='json') for b in state.branches],
                'observations':[o.model_dump(mode='json') for o in state.observations],
                'assessments':[a.model_dump(mode='json') for a in state.assessments],
                'artifacts':[a.manifest() for a in artifacts],
                'visual_reports':[r.manifest() for r in reports],
                'tools':runtime_catalog,
                'remaining':{'rounds':request.max_rounds-state.round,'actions':request.max_actions-state.actions_used},
                'rule':'All results remain exploratory. Never fabricate evidence. Preserve contradictory assessments.'}
    def reserve_calls(number):
        if state.model_calls_used+number>request.max_model_calls: return False
        change(model_calls_used=state.model_calls_used+number);commit()
        return True
    change(status='running');commit()
    while state.round < request.max_rounds:
        check_cancel()
        committed_plan=next((record for record in state.model_records
                             if record.role=='planner' and record.round==state.round),None)
        if state.actions_used>=request.max_actions and committed_plan is None:
            return stop('budget_exhausted','Action limit reached; untested alternatives remain unresolved.')
        op=None
        try:
            if committed_plan is None:
                if not reserve_calls(1): return stop('budget_exhausted','Model-call limit reached.')
                planning_context=context()
                op=log('started',operation='plan',role='planner',round=state.round,model_requested=identity('planner'))
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
                        raise ValueError('A prior hypothesis cannot be silently rewritten')
                    continue
                if idea.id in idea.parents or not set(idea.parents)<=ids: raise ValueError('Unbound or cyclic parent')
                if len(branches)>=request.max_branches: raise ValueError('Branch budget exceeded')
                branches.append(Branch(**idea.model_dump(),created_round=state.round));ids.add(idea.id)
            if len({a.id for a in plan.actions})!=len(plan.actions): raise ValueError('Duplicate actions')
            if any(a.branch_id not in ids for a in plan.actions): raise ValueError('Unknown branch')
        except Exception:
            if op:log('finished',op,outcome='error',detail='Planning failed validation or provider execution.')
            return stop('error','Planning failed validation or provider execution. No synthetic fallback was used.')
        records=state.model_records
        if committed_plan is None:
            transport=provenance('planner');log('finished',op,outcome='ok',transport=transport)
            records=records+(ModelRecord(role='planner',round=state.round,model=identity('planner'),
                    context_digest=digest(planning_context),input_context=planning_context,payload=plan.model_dump(mode='json'),
                    transport=transport),)
        change(branches=tuple(branches),model_records=records)
        event('plan_committed',plan.reason or 'Bounded exploratory actions proposed.')
        if plan.stop:
            if not state.observations: return stop('needs_input',plan.reason or 'More evidence or tools are required.')
            if request.vision_review:
                reason=required_visual_reason(state.artifacts,state.visual_reports,state.vision_records)
                if reason:return stop('needs_input',reason)
            return stop('completed',plan.reason or 'Exploratory planning stopped; human review is still required.')
        if not plan.actions: return stop('needs_input','No executable actions proposed; additional data or tools are required.')
        actions=[]
        for a in plan.actions:
            prior=next((o for o in state.observations if o.id==a.id),None)
            if prior:
                if prior.request_digest!=digest([a.model_dump(mode='json'),state.dataset_digest]):
                    return stop('error','An action ID was reused with different inputs.')
                continue
            actions.append(a)
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
            return stop('error','Trusted plot rendering failed validation; no visual success was inferred.')
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
                    return stop('needs_input','Required visual review exceeds the eight-image review limit.')
                batch_digests=tuple(artifact.digest for artifact in batch)
                prior=next((record for record in state.vision_records
                            if record.round==state.round and record.reviewed_digests==batch_digests),None)
                if prior is not None:
                    if prior.status!='accepted':
                        return stop('needs_input','A reserved or rejected visual call cannot be repeated automatically; operator input is required.')
                    report=next(r for r in state.visual_reports if r.digest==prior.report_digest)
                else:
                    vcontext=visual_context(context(reviewing=batch),batch)
                    candidate=vcontext['candidate_digest']
                    vision_model=getattr(agent,'vision_model',None)
                    if not vision_model or not callable(getattr(agent,'review_visual',None)):
                        return stop('needs_input','Required vision review has no configured vision seat.')
                    if state.model_calls_used+1>request.max_model_calls:
                        return stop('budget_exhausted','Model-call limit reached before required visual review.')
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
                    except Exception:
                        log('finished',op,outcome='error',detail='Missing, failed, malformed or unbound visual review.')
                        rejected=reservation.model_copy(update={'status':'rejected'})
                        change(vision_records=state.vision_records[:-1]+(rejected,),
                               repairs=with_outcome(state.repairs,batch_digests,'rejected','The fresh review failed or was unbound; no success inferred.'))
                        event('visual_review_rejected','Missing, failed, malformed or unbound visual review; no success inferred.')
                        return stop('needs_input','Required visual review failed or lacked exact artifact coverage.')
                    log('finished',op,outcome='ok')
                    accepted=reservation.model_copy(update={'status':'accepted','report_digest':report.digest})
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
                    return stop('error','Trusted plot rendering failed validation during repair; no visual success was inferred.')
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
        if not reserve_calls(2): return stop('budget_exhausted','Insufficient remaining calls for the independent reconciliation roles.')
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
        assessments=list(state.assessments);records=list(state.model_records)
        for role,packet,op in packets:
            try:transport=provenance(role) if packet is not None else None
            except ValueError:packet=None
            if packet is None:
                log('finished',op,outcome='error',detail='missing, malformed or unbound review')
                event('review_rejected',role+': missing, malformed or unbound review; no success inferred.')
                continue
            log('finished',op,outcome='ok',transport=transport)
            records.append(ModelRecord(role=role,round=state.round,model=identity(role),context_digest=digest(frozen),input_context=frozen,payload=packet.model_dump(mode='json'),transport=transport))
            assessments.extend(Assessed(**a.model_dump(),role=role,round=state.round,model=identity(role)) for a in packet.assessments)
        change(assessments=tuple(assessments),model_records=tuple(records))
        fits=[o for o in state.observations if o.status=='ok' and o.tool=='polynomial_fit']
        focus=min(fits,key=lambda o:(o.data['validation_mse'],o.id)).branch_id if fits else state.focus
        if focus!=state.focus:
            event('focus_changed',f'{state.focus or "unselected"} -> {focus}; exploratory fit error, not scientific confidence.')
            change(focus=focus)
        change(round=state.round+1);commit()
    return stop('budget_exhausted','Round limit reached; remaining alternatives are unresolved.')
