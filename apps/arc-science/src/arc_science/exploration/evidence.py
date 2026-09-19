"""Whole-state evidence relationship validation and stable graph projection."""
from __future__ import annotations

from collections import Counter
from types import SimpleNamespace

from ..contracts import canonical, digest
from .catalog import validate_arguments, validate_catalog
from .models import Assessed, Branch, MissionState, Proposal, Reconciliation
from .repair import PRESENTATION, PRESET_SEQUENCE
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
        earlier = [c for c in state.repairs[:index] if c.round == cycle.round]
        if cycle.cycle != len(earlier) + 1 or cycle.preset != PRESET_SEQUENCE[cycle.cycle - 1]:
            raise ValueError("Repair cycles are not consecutive")
        if any(c.policy_digest != cycle.policy_digest for c in earlier):
            raise ValueError("Repair cycles of one round ran under different policies")
        # The trigger is the accepted issues report over exactly the superseded batch, with
        # only non-blocking presentation findings, and the cycle names those categories.
        trigger = reports_by_digest.get(cycle.trigger_report_digest)
        if (trigger is None or trigger.round != cycle.round or trigger.reviewed_digests != cycle.superseded_digests
                or trigger.verdict != "issues"):
            raise ValueError("Repair cycle does not bind to an issues report over the superseded batch")
        categories = tuple(sorted({finding.category for finding in trigger.findings}))
        if (any(finding.severity == "blocking" for finding in trigger.findings)
                or any(category not in PRESENTATION for category in categories) or cycle.addressed != categories):
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
            for action in packet.actions:
                if action.branch_id not in available:
                    raise ValueError("Recorded proposal has an invalid action branch")
                try:
                    validate_arguments(action.tool, action.arguments, tools)
                except ValueError:
                    denied = observations.get(action.id)
                    if not denied or denied.action != action or denied.status != "error":
                        raise ValueError("Recorded proposal has an unbound tool request") from None
                if action.id in planned_actions and planned_actions[action.id][0] != action:
                    raise ValueError("Recorded proposal reuses an action identity")
                if action.id not in planned_actions:
                    planned_actions[action.id] = (action, record.round)
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
            if not planned or planned != (observation.action, observation.round):
                raise ValueError("Observation does not bind to a recorded proposal")
        if Counter(canonical(item) for item in state.assessments) != Counter(
            canonical(item) for item in expected_assessments
        ):
            raise ValueError("Final assessment payload binding mismatch")
    elif state.assessments:
        raise ValueError("Assessments require recorded reviewer payloads")


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
