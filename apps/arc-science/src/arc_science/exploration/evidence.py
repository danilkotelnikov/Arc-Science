"""Whole-state evidence relationship validation and stable graph projection."""
from __future__ import annotations

from collections import Counter
from types import SimpleNamespace

from ..contracts import canonical, digest
from .catalog import validate_arguments, validate_catalog
from .changes import MISSION_CHANGES, decisions_seal, required_checks
from .claim_scope import DERIVATION_VERSION, derive_claim_scope
from .models import (Assessed, Branch, MissionState, Proposal, Reconciliation, asks_for_more, operator_directives,
                     withholding)
from .repair import POLICIES
from .vision import current_artifacts, validate_report, visual_context


def _unique(values, message):
    if len(values) != len(set(values)):
        raise ValueError(message)


def _validate_branch_graph(branches) -> None:
    ids = [branch.id for branch in branches]
    _unique(ids, "Duplicate branch identity")
    known = set(ids)
    for branch in branches:
        if any(parent not in known for parent in branch.parents):
            raise ValueError("Dangling branch parent reference")
    parents = {branch.id: branch.parents for branch in branches}
    visiting, visited = set(), set()

    def visit(branch_id):
        if branch_id in visiting:
            raise ValueError("Cyclic branch parent reference")
        if branch_id in visited:
            return
        visiting.add(branch_id)
        for parent in parents[branch_id]:
            visit(parent)
        visiting.remove(branch_id)
        visited.add(branch_id)

    for branch_id in sorted(known):
        visit(branch_id)


def _context_index(record, state):
    context = record.input_context
    if not isinstance(context, dict):
        raise ValueError("Recorded model context must be an object")
    expected_dataset = {"digest": state.dataset_digest, "n": len(state.points)}
    if context.get("dataset") != expected_dataset or context.get("data_origin") != state.data_origin:
        raise ValueError("Recorded context dataset binding mismatch")
    branches = context.get("branches", [])
    observations = context.get("observations", [])
    assessments = context.get("assessments", [])
    artifacts = context.get("artifacts", [])
    visual_reports = context.get("visual_reports", [])
    if not all(isinstance(items, list) for items in
               (branches, observations, assessments, artifacts, visual_reports)):
        raise ValueError("Recorded model context has invalid evidence lists")
    try:
        branch_ids = {item["id"] for item in branches}
        observation_status = {item["id"]: item["status"] for item in observations}
    except (KeyError, TypeError):
        raise ValueError("Recorded model context has malformed evidence") from None
    if len(branch_ids) != len(branches) or len(observation_status) != len(observations):
        raise ValueError("Recorded model context has duplicate evidence identities")
    final_branches = {item.id: item.model_dump(mode="json") for item in state.branches}
    final_observations = {item.id: item.model_dump(mode="json") for item in state.observations}
    final_artifacts = {item.digest: item.manifest() for item in state.artifacts}
    limit = record.round if record.role != "planner" else record.round - 1
    for item in branches:
        actual = final_branches.get(item["id"])
        if actual != item:
            raise ValueError("Recorded contextual branch binding mismatch")
        if actual["created_round"] > limit:
            raise ValueError("Recorded contextual branch was not available at invocation")
    for item in observations:
        actual = final_observations.get(item["id"])
        if actual != item:
            raise ValueError("Recorded contextual observation binding mismatch")
        if actual["round"] > limit:
            raise ValueError("Recorded contextual observation was not available at invocation")
    for item in artifacts:
        actual = final_artifacts.get(item.get("digest")) if isinstance(item, dict) else None
        if actual != item:
            raise ValueError("Recorded contextual artifact binding mismatch")
        if actual["round"] > limit:
            raise ValueError("Recorded contextual artifact was not available at invocation")
    report_limit = record.round - 1 if record.role in {"planner", "vision"} else record.round
    for item in visual_reports:
        if not isinstance(item, dict):
            raise ValueError("Recorded contextual visual report binding mismatch")
        actual = next((report.manifest() for report in state.visual_reports
                       if report.candidate_digest == item.get("candidate_digest") and report.round == item.get("round")), None)
        if actual != item:
            raise ValueError("Recorded contextual visual report binding mismatch")
        if actual["round"] > report_limit:
            raise ValueError("Recorded contextual visual report was not available at invocation")
    final_assessments = Counter(canonical(item) for item in state.assessments)
    contextual_assessments = Counter()
    for item in assessments:
        if not isinstance(item, dict) or item.get("round", record.round) >= record.round:
            raise ValueError("Recorded contextual assessment was not available at invocation")
        contextual_assessments[canonical(item)] += 1
    if contextual_assessments - final_assessments:
        raise ValueError("Recorded contextual assessment payload binding mismatch")
    expected_branches = Counter(canonical(item) for item in state.branches if item.created_round <= limit)
    expected_observations = Counter(canonical(item) for item in state.observations if item.round <= limit)
    expected_assessments = Counter(canonical(item) for item in state.assessments if item.round < record.round)
    if record.role == "vision":
        # The reviewed batch is the only same-round image set the seat was shown.
        reviewed = set(getattr(record, "reviewed_digests", ()))
        expected_artifacts = Counter(canonical(item.manifest()) for item in state.artifacts
                                     if item.round < record.round or item.digest in reviewed)
    else:
        expected_artifacts = Counter(canonical(item.manifest()) for item in state.artifacts if item.round <= limit)
    expected_reports = Counter(canonical(item.manifest()) for item in state.visual_reports if item.round <= report_limit)
    if Counter(canonical(item) for item in branches) != expected_branches:
        raise ValueError("Recorded context does not contain the available branches")
    if Counter(canonical(item) for item in observations) != expected_observations:
        raise ValueError("Recorded context does not contain the available observations")
    if contextual_assessments != expected_assessments:
        raise ValueError("Recorded context does not contain the available assessments")
    if Counter(canonical(item) for item in artifacts) != expected_artifacts:
        raise ValueError("Recorded context does not contain the available artifacts")
    if Counter(canonical(item) for item in visual_reports) != expected_reports:
        raise ValueError("Recorded context does not contain the available visual reports")
    return branch_ids, observation_status


# Stops that can leave the latest committed plan with nothing dispatched: the gate, a budget,
# or an operator or service interruption. A stop after dispatch (call_limit before review,
# render_failed, vision_required) leaves the round's observations behind.
UNDISPATCHED = ("", "awaiting_decision", "interrupted", "paused_by_operator", "cancelled", "service_failed",
                "token_limit", "cost_limit", "time_limit", "budget_unmeasurable")
# Of those, the stops that can cut a started dispatch short before any observation is recorded.
# A budget stop is checked only before a dispatch starts or after its observations are recorded.
CUT_OFF = ("", "interrupted", "paused_by_operator", "cancelled", "service_failed")


def _pending(state, round_number):
    """Why the latest committed plan has nothing run yet, or None. 'cut': an interruption (CUT_OFF)
    cut its recorded dispatch short, with exactly the dispatched actions still reserved. 'gate':
    nothing was dispatched or reserved, and the mission stopped after the plan was committed (the
    gate's pause, or a budget stop in its place; declarations and further stops may follow). An
    auto round commits its plan with its dispatch, so a gate stop needs a gated mission: from round
    1 on a gated mission has recorded decisions, and validate_context checks round 0 and the spend
    against the request."""
    if (round_number != state.round or state.stop_code not in UNDISPATCHED
            or any(o.round == round_number for o in state.observations)):
        return None
    kinds = [(e.kind, e.round) for e in state.events]
    if ("plan_committed", round_number) not in kinds:
        return None
    committed = len(kinds) - 1 - kinds[::-1].index(("plan_committed", round_number))
    dispatched = [e.detail for e in state.events if e.kind == "actions_dispatched" and e.round == round_number]
    reserved = state.actions_used - len(state.observations)
    if dispatched:
        return "cut" if state.stop_code in CUT_OFF and reserved == len(dispatched[-1].split(", ")) else None
    if state.stop_code in CUT_OFF and reserved > 0 and not any(e.kind == "actions_dispatched" for e in state.events):
        # A record from before dispatch facts (release c06a4c6): its engine reserved the round's
        # actions and committed before dispatching, so an interruption leaves only the reservation,
        # at most one per action of the plan that has not run.
        # ponytail: indistinguishable from a current record stripped of every dispatch fact and
        # observation; a record version field would tell the two apart.
        record = next((r for r in state.model_records if r.role == "planner" and r.round == round_number), None)
        ran = {o.id for o in state.observations}
        planned = Proposal.model_validate(record.payload).actions if record else ()
        return "cut" if reserved <= sum(a.id not in ran for a in planned) else None
    gated = round_number == 0 or any(change.kind == "decision" for change in state.changes)
    stopped = any(kind == "mission_stopped" for kind, _ in kinds[committed + 1:])
    return "gate" if gated and stopped and state.actions_used == len(state.observations) else None


def _relied_pending(state):
    """The _pending reason the latest plan's record relies on: a stopping or empty plan (the gate
    pauses it like any other), or some action of it neither ran nor was withheld. None when it
    relies on none."""
    record = next((r for r in state.model_records if r.role == "planner" and r.round == state.round), None)
    if record is None:
        return None
    plan = Proposal.model_validate(record.payload)
    withheld = {e.detail.partition(":")[0] for e in state.events if e.kind == "action_withheld" and e.round == state.round}
    ran = {o.id for o in state.observations}
    if plan.actions and not plan.stop and all(a.id in ran or a.id in withheld for a in plan.actions):
        return None
    return _pending(state, state.round)


def _budgets(state):
    """The (rounds, actions) budget each planner context implies: what it was told remained plus
    the rounds and actions used before it. Every planner of one mission implies the same one."""
    budgets = set()
    for record in state.model_records:
        remaining = record.input_context.get("remaining") if record.role == "planner" else None
        if remaining is None:
            continue
        rounds, actions = (remaining.get("rounds"), remaining.get("actions")) if isinstance(remaining, dict) else (None, None)
        if not all(isinstance(v, int) and not isinstance(v, bool) for v in (rounds, actions)):
            raise ValueError("Recorded planner context has malformed remaining rounds and actions")
        budgets.add((rounds + record.round, actions + sum(o.round < record.round for o in state.observations)))
    return budgets


# Stops a stopping or empty plan makes when the operator accepts it (or no operator decides).
PLAN_STOPS = ("plan_stop", "no_observations", "vision_required", "no_actions")


def _replay_decisions(state, planners, decisions):
    """Re-derive what the engine did with each committed plan from the decisions in force when
    it ran, and require the record to say exactly that. A gated round is decided before any of
    its work runs, so those are the decisions of that round and the earlier ones. Returns the
    withheld (round, action id) pairs."""
    plain = [{"change_id": change.id, **decision.model_dump(mode="json")} for change, decision in decisions]
    cited = {}
    for event in state.events:
        if event.kind != "action_withheld":
            continue
        action_id, _, rest = event.detail.partition(": branch ")
        branch_id, _, rest = rest.partition("; ")
        directive, _, change_id = rest.partition(" by decision ")
        if (event.round, action_id) in cited:
            raise ValueError("Withheld action is recorded twice")
        cited[(event.round, action_id)] = (branch_id, directive, change_id)
    withheld = set(cited)
    closed = {event.round for event in state.events if event.kind == "round_closed"}
    ran = {observation.id: observation.round for observation in state.observations}
    for round_number, record in planners.items():
        plan = Proposal.model_validate(record.payload)
        if plan.stop or not plan.actions:
            # Refused, the round closed and the planner was asked again; accepted, it ended there.
            refused, asked = round_number in closed, asks_for_more(plain, round_number)
            if refused != asked and (refused or state.round > round_number or state.stop_code in PLAN_STOPS):
                raise ValueError("Recorded round outcome does not follow from the operator decisions")
            continue
        processed = state.round > round_number or round_number in ran.values()
        for action in plan.actions:
            if ran.get(action.id, round_number) < round_number:
                continue  # it ran in an earlier round, so this plan never dispatched it
            why = withholding(plain, round_number, action.branch_id)
            recorded = cited.pop((round_number, action.id), None)
            if why is None:
                if recorded is not None:
                    raise ValueError("Withheld action does not bind to an operator decision")
                continue
            if ran.get(action.id) == round_number:
                raise ValueError("An action ran although the operator decision in force withheld it")
            if recorded != (action.branch_id, why["directive"], why["change_id"]) and (recorded or processed):
                raise ValueError("Withheld action does not bind to an operator decision")
    if cited:
        raise ValueError("Withheld action does not bind to an operator decision")
    return withheld


def validate_evidence(state: MissionState) -> None:
    """Reject evidence states whose identities, references, or records do not bind."""
    if state.dataset_digest != digest([point.model_dump(mode="json") for point in state.points]):
        raise ValueError("Evidence dataset binding mismatch")
    _validate_branch_graph(state.branches)
    branches = {branch.id for branch in state.branches}
    if state.focus is not None and state.focus not in branches:
        raise ValueError("Invalid focused branch reference")
    observation_ids = [observation.id for observation in state.observations]
    _unique(observation_ids, "Duplicate observation identity")
    observations = {observation.id: observation for observation in state.observations}
    for observation in state.observations:
        if observation.branch_id not in branches:
            raise ValueError("Invalid observation branch reference")
        if (observation.id, observation.branch_id, observation.tool) != (
            observation.action.id, observation.action.branch_id, observation.action.tool
        ):
            raise ValueError("Invalid observation/action identity")
        if (observation.dataset_digest != state.dataset_digest or
                observation.request_digest != digest([observation.action.model_dump(mode="json"), state.dataset_digest])):
            raise ValueError("Invalid observation input binding")

    artifact_digests = [artifact.digest for artifact in state.artifacts]
    _unique(artifact_digests, "Duplicate artifact digest")
    artifact_sources = [artifact.source_observation_id for artifact in current_artifacts(state.artifacts)]
    _unique(artifact_sources, "Duplicate artifact source observation")
    artifacts = {artifact.digest: artifact for artifact in state.artifacts}
    for artifact in state.artifacts:
        source = observations.get(artifact.source_observation_id)
        if (source is None or source.status != "ok" or source.tool != "polynomial_fit" or
                source.digest != artifact.source_observation_digest or source.round != artifact.round):
            raise ValueError("Invalid artifact source observation binding")
    # A repair supersedes one earlier image of the same source under a different preset.
    _unique([artifact.repair_of for artifact in state.artifacts if artifact.repair_of], "Duplicate artifact repair")
    for artifact in state.artifacts:
        if artifact.repair_of is None:
            continue
        superseded = artifacts.get(artifact.repair_of)
        if (superseded is None or superseded.source_observation_id != artifact.source_observation_id or
                superseded.round != artifact.round or superseded.preset == artifact.preset or
                artifact_digests.index(superseded.digest) > artifact_digests.index(artifact.digest)):
            raise ValueError("Invalid artifact repair binding")
    # Each reviewable batch of a round is one generation: the originals, or one cycle's renders.
    batches = {}
    for round_number in {artifact.round for artifact in state.artifacts}:
        originals = tuple(a.digest for a in state.artifacts if a.round == round_number and a.repair_of is None)
        batches[round_number] = {originals} | {cycle.artifact_digests for cycle in state.repairs
                                               if cycle.round == round_number and cycle.outcome != "blocked"}
    _unique([cycle.superseded_digests for cycle in state.repairs], "Duplicate repair of one batch")
    reports_by_digest = {report.digest: report for report in state.visual_reports}
    rendered_by_cycles = set()
    for index, cycle in enumerate(state.repairs):
        # The cycle is judged by the policy it recorded, which must be a known one.
        policy = POLICIES.get(cycle.policy_digest)
        if policy is None:
            raise ValueError("Repair cycle ran under an unknown policy")
        earlier = [c for c in state.repairs[:index] if c.round == cycle.round]
        if (cycle.cycle != len(earlier) + 1 or cycle.cycle > policy["max_repairs"]
                or cycle.preset != policy["presets"][cycle.cycle - 1]):
            raise ValueError("Repair cycles are not consecutive")
        if any(c.policy_digest != cycle.policy_digest for c in earlier):
            raise ValueError("Repair cycles of one round ran under different policies")
        # The trigger is the accepted issues report over exactly the superseded batch, with
        # only non-blocking presentation findings, and the cycle names those categories.
        trigger = reports_by_digest.get(cycle.trigger_report_digest)
        if (trigger is None or trigger.round != cycle.round or trigger.reviewed_digests != cycle.superseded_digests
                or trigger.verdict != "issues" or trigger.prompt_version != policy["prompt_version"]):
            raise ValueError("Repair cycle does not bind to an issues report over the superseded batch")
        categories = tuple(sorted({finding.category for finding in trigger.findings}))
        if (any(finding.severity == "blocking" for finding in trigger.findings)
                or any(category not in policy["presentation"] for category in categories) or cycle.addressed != categories):
            raise ValueError("Repair cycle was triggered by findings it may not repair")
        if cycle.superseded_digests not in batches.get(cycle.round, set()):
            raise ValueError("Repair cycle does not supersede a reviewed batch")
        # The outcome is exactly what the fresh review of the rendered batch recorded.
        fresh = next((record for record in state.vision_records
                      if record.round == cycle.round and record.reviewed_digests == cycle.artifact_digests), None)
        if cycle.outcome == "blocked":
            if cycle.artifact_digests or any(a.repair_of in cycle.superseded_digests for a in state.artifacts):
                raise ValueError("A blocked repair cycle cannot own rendered artifacts")
            continue
        if any(artifacts.get(d) is None or artifacts[d].repair_of != s or artifacts[d].preset != cycle.preset
               for d, s in zip(cycle.artifact_digests, cycle.superseded_digests)):
            raise ValueError("Repair cycle does not bind to its rendered artifacts")
        rendered_by_cycles.update(cycle.artifact_digests)
        if cycle.outcome == "pending":
            if fresh is not None and fresh.status != "reserved":
                raise ValueError("A pending repair cycle already has a finished review")
        elif cycle.outcome == "rejected":
            if fresh is None or fresh.status != "rejected":
                raise ValueError("A rejected repair cycle needs a rejected review of its renders")
        else:
            report = reports_by_digest.get(fresh.report_digest) if fresh is not None and fresh.status == "accepted" else None
            if report is None or report.verdict != cycle.outcome:
                raise ValueError("Repair cycle outcome does not match the accepted review of its renders")
    if any(a.repair_of and a.digest not in rendered_by_cycles for a in state.artifacts):
        raise ValueError("A repaired artifact is not owned by a repair cycle")

    report_keys = [(report.candidate_digest, report.round) for report in state.visual_reports]
    _unique(report_keys, "Duplicate visual report identity")
    reports = {report.digest: report for report in state.visual_reports}
    reservation_keys = [record.candidate_digest for record in state.vision_records]
    _unique(reservation_keys, "Duplicate vision reservation identity")
    for record in state.vision_records:
        if record.input_context.get("candidate_digest") != record.candidate_digest:
            raise ValueError("Invalid vision reservation candidate binding")
        if record.reviewed_digests not in batches.get(record.round, set()):
            raise ValueError("Visual report does not cover the exact supplied image batch")
        selected = tuple(artifacts[d] for d in record.reviewed_digests)
        mission_context = record.input_context.get("mission")
        if not isinstance(mission_context, dict):
            raise ValueError("Invalid vision reservation context")
        if record.input_context.get("round") != record.round or mission_context.get("round") != record.round:
            raise ValueError("Visual report model or round binding mismatch")
        _context_index(SimpleNamespace(input_context=mission_context, role="vision", round=record.round,
                                       reviewed_digests=record.reviewed_digests), state)
        if visual_context(mission_context, selected) != record.input_context:
            raise ValueError("Invalid vision reservation context binding")
        if record.report_digest is not None:
            report = reports.get(record.report_digest)
            if report is None:
                raise ValueError("Invalid accepted visual report binding")
            validate_report(report, record.input_context, selected, record.model)
    accepted = Counter(record.report_digest for record in state.vision_records if record.status == "accepted")
    if accepted != Counter(report.digest for report in state.visual_reports):
        raise ValueError("Visual reports do not bind to accepted reservations")
    for report in state.visual_reports:
        if any(finding.artifact_digest not in artifacts for finding in report.findings):
            raise ValueError("Invalid visual finding artifact reference")

    # A scope derived under the current rule must follow from the record; one derived
    # under an earlier rule is stale, reported by the ledger and derived again on verify.
    if (state.claim_scope is not None and state.claim_scope.derivation_version == DERIVATION_VERSION
            and state.claim_scope != derive_claim_scope(state)):
        raise ValueError("Recorded claim scope does not follow from the recorded reconciliation")
    # Declared changes: each binds to exactly one change_declared event at the point of
    # the history it names, derives what the table says, and every resume has one.
    _unique([change.id for change in state.changes], "Duplicate change identity")
    declared_events = {}
    for index, event in enumerate(state.events):
        if event.kind == "change_declared":
            declared_events.setdefault(event.detail.split(":", 1)[0], []).append(index)
    for change in state.changes:
        indexes = declared_events.pop(change.id, [])
        if len(indexes) != 1:
            raise ValueError("Change is not bound to exactly one declaration event")
        index = indexes[0]
        expected = MISSION_CHANGES[change.kind]["derived"]
        # The decisions a change records are sealed into its declaration event.
        seal, detail = decisions_seal(change.decisions), state.events[index].detail
        if (change.derived_effects != expected or change.required_checks != required_checks(expected)
                or not detail.endswith(seal) or ("; decisions " in detail) != bool(seal)
                or state.events[index].round != change.round
                or change.base_digest != digest([e.model_dump(mode="json") for e in state.events[:index]])):
            raise ValueError("Change record does not bind to its declaration")
    if declared_events:
        raise ValueError("Declaration event without its change record")
    # Operator decisions (contract C6) bind to the plan they answer, to the work they withheld
    # and to what every later planner was told.
    planners = {record.round: record for record in state.model_records if record.role == "planner"}
    decisions = [(change, decision) for change in state.changes for decision in change.decisions]
    for change, decision in decisions:
        plan = planners.get(decision.round)
        target = (decision.target_id == f"plan-{decision.round}" if decision.target == "proposal" else
                  any(b.id == decision.target_id and b.created_round <= decision.round for b in state.branches))
        if (change.kind != "decision" or decision.round != change.round or plan is None
                or decision.plan_digest != digest(plan) or not target):
            raise ValueError("Operator decision does not bind to its plan")
    for record in planners.values():
        told = operator_directives([d.model_dump(mode="json") for _, d in decisions if d.round < record.round])
        if record.input_context.get("operator_directives", []) != told:
            raise ValueError("Planner context does not bind to the recorded operator decisions")
    withheld = _replay_decisions(state, planners, decisions)
    if len(_budgets(state)) > 1:
        raise ValueError("Recorded planner contexts disagree on the remaining rounds and actions")
    for index, event in enumerate(state.events[:-1]):
        # A cancellation after a stop, an interruption or a pause is a terminal operator
        # action, not a continuation; anything else must be a declared change.
        if (event.kind in ("mission_stopped", "mission_interrupted", "mission_paused")
                and state.events[index + 1].kind not in ("change_declared", "mission_cancelled")):
            raise ValueError("Mission continued after a stop without a declared change")
    for assessment in state.assessments:
        if assessment.branch_id not in branches:
            raise ValueError("Invalid assessment branch reference")
        if any(evidence_id not in observations for evidence_id in assessment.evidence_ids):
            raise ValueError("Invalid assessment evidence reference")
        if assessment.position == "support" and not any(
            observations[evidence_id].status == "ok" for evidence_id in assessment.evidence_ids
        ):
            raise ValueError("Operational errors cannot support an assessment")

    keys = [(record.role, record.round) for record in state.model_records]
    _unique(keys, "Duplicate model record identity")
    planned_branches: dict[str, Branch] = {}
    planned_actions = {}
    expected_assessments = []
    for record in sorted(state.model_records, key=lambda item: (item.round, item.role)):
        if record.context_digest != digest(record.input_context):
            raise ValueError("Model context binding mismatch")
        context_branches, context_observations = _context_index(record, state)
        if record.role == "planner":
            packet = Proposal.model_validate(record.payload)
            tools = validate_catalog(record.input_context.get("tools", {}))
            available = set(context_branches)
            for idea in packet.branches:
                if idea.id in available:
                    existing = next((item for item in record.input_context.get("branches", []) if item.get("id") == idea.id), None)
                    if not existing or {k: existing[k] for k in idea.model_dump()} != idea.model_dump(mode="json"):
                        raise ValueError("Recorded proposal rewrites an existing branch")
                    continue
                if idea.id in idea.parents or any(parent not in available for parent in idea.parents):
                    raise ValueError("Recorded proposal has an invalid branch parent")
                branch = Branch(**idea.model_dump(), created_round=record.round)
                if idea.id in planned_branches and planned_branches[idea.id] != branch:
                    raise ValueError("Recorded proposal has duplicate branch identity")
                planned_branches[idea.id] = branch
                available.add(idea.id)
            action_ids = [action.id for action in packet.actions]
            _unique(action_ids, "Recorded proposal has duplicate action identity")
            ran = sum(o.round == record.round for o in state.observations)
            # The action limit cut this plan's dispatch: its round ran every action it had left.
            capped = ran > 0 and ran == record.input_context.get("remaining", {}).get("actions")
            pending = _pending(state, record.round) is not None
            for action in packet.actions:
                if action.branch_id not in available:
                    raise ValueError("Recorded proposal has an invalid action branch")
                try:
                    validate_arguments(action.tool, action.arguments, tools)
                    valid = True
                except ValueError:
                    valid = False
                # Every proposed action ran (one on an unknown tool was refused), or never ran: the
                # plan stopped, the operator withheld it, the action limit cut it, or its plan (the
                # latest, with nothing run yet) waits to run because the mission stopped short of dispatch.
                observed = observations.get(action.id)
                if (not valid and (canonical(observed.action) != canonical(action) or observed.status != "error")
                        if observed else not (packet.stop or (record.round, action.id) in withheld or capped or pending)):
                    raise ValueError("Recorded proposal has an unbound tool request")
                if action.id in planned_actions and canonical(planned_actions[action.id][0]) != canonical(action):
                    raise ValueError("Recorded proposal reuses an action identity")
                # An identical action may be proposed again after it was withheld; it runs in
                # one of the rounds that proposed it, never in a round whose plan stopped.
                rounds = planned_actions.setdefault(action.id, (action, set()))[1]
                if not packet.stop:
                    rounds.add(record.round)
        elif record.role in {"analyst", "falsifier"}:
            packet = Reconciliation.model_validate(record.payload)
            for assessment in packet.assessments:
                if assessment.branch_id not in context_branches:
                    raise ValueError("Invalid recorded reviewer branch reference")
                if any(evidence_id not in context_observations for evidence_id in assessment.evidence_ids):
                    raise ValueError("Invalid recorded reviewer evidence reference")
                if assessment.position == "support" and not any(
                    context_observations[evidence_id] == "ok" for evidence_id in assessment.evidence_ids
                ):
                    raise ValueError("Recorded reviewer used an operational error as support")
                expected_assessments.append(Assessed(
                    **assessment.model_dump(), role=record.role, round=record.round, model=record.model
                ))
        else:
            raise ValueError("Unknown recorded model role")

    if state.model_records:
        if Counter(canonical(branch) for branch in state.branches) != Counter(
            canonical(branch) for branch in planned_branches.values()
        ):
            raise ValueError("Final branch state does not bind to recorded proposals")
        for observation in state.observations:
            planned = planned_actions.get(observation.id)
            if (not planned or canonical(planned[0]) != canonical(observation.action)
                    or observation.round not in planned[1]):
                raise ValueError("Observation does not bind to a recorded proposal")
        if Counter(canonical(item) for item in state.assessments) != Counter(
            canonical(item) for item in expected_assessments
        ):
            raise ValueError("Final assessment payload binding mismatch")
    elif state.assessments:
        raise ValueError("Assessments require recorded reviewer payloads")
    # What a round dispatched is what ran in it; only an interruption leaves a dispatch unobserved.
    dispatched = {}
    for event in state.events:
        if event.kind == "actions_dispatched":
            dispatched.setdefault(event.round, set()).update(event.detail.split(", "))
    for round_number, ids in dispatched.items():
        ran = {o.id for o in state.observations if o.round == round_number}
        if ids != ran and (ran or _pending(state, round_number) != "cut"):
            raise ValueError("Recorded dispatch does not bind to the observations of its round")


def validate_context(request, state: MissionState) -> None:
    """Every recorded model call was shown exactly the attached context its role receives from
    the frozen request: all of it for the planner, none of the planner-only items for the two
    reviewers, none at all for a vision seat. Absent when there is nothing to show."""
    planner = [item.model_dump(mode="json") for item in request.context_items]
    reviewer = [item.model_dump(mode="json") for item in request.context_items if not item.planner_only]
    shown = [(record.input_context, planner if record.role == "planner" else reviewer) for record in state.model_records]
    shown += [(record.input_context.get("mission") or {}, []) for record in state.vision_records]
    for context, expected in shown:
        if context.get("mission_context", []) != expected or ("mission_context" in context) != bool(expected):
            raise ValueError("Recorded model context does not bind to the context attached to the mission")
    # The action-limit excuse reads the planner's remaining actions: they follow from the request.
    if _budgets(state) - {(request.max_rounds, request.max_actions)}:
        raise ValueError("Recorded planner context does not bind to the mission's remaining rounds and actions")
    # A plan left pending at a gate needs a gated mission, and its stop the spend the record shows.
    # The gate's pause checked the budgets after the plan's call, and no call follows until
    # dispatch, so the record's calls are the ones every check read: a token, cost or usage stop
    # recomputes exactly, and any other stop needs a spend none of them stops. A pause names its
    # plan and was not preceded by a decision on its round (a decided round never pauses again;
    # a decision after the pause waits for the resume); a time stop needs the time budget it names.
    # A stopping or empty plan also ends ungated, its stop replaced by a budget stop (the engine's
    # stop checks the budgets first), so for it only the pause label needs the gate.
    # ponytail: the minutes themselves are not recomputable from the record (the clock is in the timeline).
    if _relied_pending(state) == "gate":
        from .engine import budget_stop, plan_digest  # the engine imports this module
        code, facts = state.stop_code, state.stop_facts
        plan = next(r for r in state.model_records if r.role == "planner" and r.round == state.round)
        proposal = Proposal.model_validate(plan.payload)
        stopping = proposal.stop or not proposal.actions
        spend = budget_stop(request, state, lambda: 0)
        kinds = [(e.kind, e.round) for e in state.events]
        committed = len(kinds) - 1 - kinds[::-1].index(("plan_committed", state.round))
        decided = {c.id for c in state.changes if c.kind == "decision" and c.round == state.round}
        if (request.gate != "each_round" and (not stopping or code == "awaiting_decision")
                or spend != (code if code in ("token_limit", "cost_limit", "budget_unmeasurable") else None)
                or code == "awaiting_decision" and (
                    facts != {"round": state.round, "plan_digest": plan_digest(plan)}
                    or any(e.kind == "change_declared" and e.detail.partition(":")[0] in decided
                           for e in state.events[:committed]))
                or code == "time_limit" and (
                    request.max_minutes is None or facts.get("kind") != "minutes" or facts.get("limit") != request.max_minutes
                    or not isinstance(facts.get("spent"), (int, float)) or facts["spent"] < request.max_minutes)):
            raise ValueError("Recorded proposal has an unbound tool request")


def evidence_graph(state: MissionState) -> dict:
    """Return a stable JSON graph; positions express review, never a truth score."""
    validate_evidence(state)
    branches = sorted(state.branches, key=lambda item: item.id)
    observations = sorted(state.observations, key=lambda item: item.id)
    assessments = sorted(state.assessments, key=lambda item: canonical(item))
    dataset_id = "dataset:" + state.dataset_digest
    nodes = [{"id": dataset_id, "kind": "dataset", "digest": state.dataset_digest,
              "origin": state.data_origin, "n": len(state.points)}]
    edges = []
    for branch in branches:
        nodes.append({"id": "branch:" + branch.id, "kind": "branch", "title": branch.title,
                      "hypothesis": branch.hypothesis, "created_round": branch.created_round})
        for parent in sorted(branch.parents):
            edges.append({"source": "branch:" + parent, "target": "branch:" + branch.id, "relation": "parent"})
    tool_nodes = {}
    for observation in observations:
        key = (observation.tool, observation.tool_version)
        tool_nodes[key] = "tool:" + digest({"tool": key[0], "version": key[1]})
    for (tool, version), node_id in sorted(tool_nodes.items()):
        nodes.append({"id": node_id, "kind": "tool", "tool": tool, "version": version})
    model_nodes = {}
    for assessment in assessments:
        key = (assessment.role, assessment.round, assessment.model)
        model_nodes[key] = "model:" + digest({"role": key[0], "round": key[1], "model": key[2]})
    for report in state.visual_reports:
        key = ("vision", report.round, report.model)
        model_nodes[key] = "model:" + digest({"role": key[0], "round": key[1], "model": key[2]})
    for (role, round_number, model), node_id in sorted(model_nodes.items()):
        nodes.append({"id": node_id, "kind": "model", "role": role,
                      "round": round_number, "model": model})
    for observation in observations:
        nodes.append({"id": "observation:" + observation.id, "kind": "observation", "tool": observation.tool,
                      "status": observation.status, "branch_id": observation.branch_id, "round": observation.round})
        edges.append({"source": "branch:" + observation.branch_id, "target": "observation:" + observation.id,
                      "relation": "observation"})
        edges.append({"source": "observation:" + observation.id,
                      "target": tool_nodes[(observation.tool, observation.tool_version)], "relation": "produced-by"})
        edges.append({"source": "observation:" + observation.id, "target": dataset_id,
                      "relation": "uses-dataset"})
    for artifact in sorted(state.artifacts, key=lambda item: item.digest):
        artifact_id = "artifact:" + artifact.digest
        nodes.append({"id": artifact_id, "kind": "artifact", "digest": artifact.digest,
                      "media_type": artifact.media_type, "size": artifact.size,
                      "renderer_version": artifact.renderer_version,
                      "source_observation_id": artifact.source_observation_id, "round": artifact.round})
        edges.append({"source": artifact_id, "target": "observation:" + artifact.source_observation_id,
                      "relation": "rendered-from"})
    for report in sorted(state.visual_reports, key=lambda item: item.digest):
        report_id = "visual-review:" + report.digest
        nodes.append({"id": report_id, "kind": "visual-review", "candidate_digest": report.candidate_digest,
                      "verdict": report.verdict, "round": report.round, "model": report.model,
                      "reviewed_digests": list(report.reviewed_digests),
                      "findings": [finding.model_dump(mode="json") for finding in report.findings]})
        edges.append({"source": report_id,
                      "target": model_nodes[("vision", report.round, report.model)], "relation": "produced-by"})
        for artifact_digest in report.reviewed_digests:
            edges.append({"source": report_id, "target": "artifact:" + artifact_digest,
                          "relation": "reviews"})
    for index, assessment in enumerate(assessments):
        node_id = f"assessment:{index:04d}"
        nodes.append({"id": node_id, "kind": "assessment", "branch_id": assessment.branch_id,
                      "position": assessment.position, "role": assessment.role, "round": assessment.round,
                      "finding": assessment.finding, "next_test": assessment.next_test,
                      "evidence_ids": list(assessment.evidence_ids)})
        edges.append({"source": node_id, "target": "branch:" + assessment.branch_id,
                      "relation": assessment.position})
        edges.append({"source": node_id,
                      "target": model_nodes[(assessment.role, assessment.round, assessment.model)],
                      "relation": "produced-by"})
        for evidence_id in sorted(assessment.evidence_ids):
            edges.append({"source": node_id, "target": "observation:" + evidence_id, "relation": "cites"})

    conflicts = []
    for branch in branches:
        related = [(index, item) for index, item in enumerate(assessments) if item.branch_id == branch.id]
        positions = sorted({item.position for _, item in related if item.position in {"support", "challenge"}})
        if positions == ["challenge", "support"]:
            conflicts.append({
                "branch_id": branch.id,
                "positions": positions,
                "assessment_ids": [f"assessment:{index:04d}" for index, _ in related],
                "evidence_ids": sorted({evidence_id for _, item in related for evidence_id in item.evidence_ids}),
            })
    edges.sort(key=lambda item: (item["source"], item["target"], item["relation"]))
    return {"nodes": nodes, "edges": edges, "conflicts": conflicts}
