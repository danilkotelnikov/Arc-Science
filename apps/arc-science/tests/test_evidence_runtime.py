"""Behavioral tests for the trusted evidence catalog and graph runtime."""
import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator


def completed():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    request = MissionRequest(goal="Inspect the fixture")
    return request, asyncio.run(explore(request, DemoAgent()))


def test_numeric_receipt_cannot_skip_reexecution():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    request = MissionRequest(goal='Inspect the fixture')
    state = asyncio.run(explore(request, DemoAgent()))
    bad = state.model_copy(update={'observations': (state.observations[0].model_copy(update={'replayable': False}),) + state.observations[1:]})
    with pytest.raises(ValueError):
        verify_capsule(export_capsule(request, bad))


def test_duplicate_observation_identity_is_rejected():
    from arc_science.exploration.capsule import export_capsule, verify_capsule

    request, state = completed()
    duplicate = state.model_copy(update={"observations": state.observations + (state.observations[0],)})
    with pytest.raises(ValueError, match="Duplicate observation"):
        verify_capsule(export_capsule(request, duplicate))


@pytest.mark.parametrize("kind", ["dangling", "cycle"])
def test_dangling_and_cyclic_branch_parents_are_rejected(kind):
    from arc_science.exploration.evidence import evidence_graph

    _, state = completed()
    branches = list(state.branches)
    if kind == "dangling":
        branches[0] = branches[0].model_copy(update={"parents": ("missing",)})
    else:
        branches[0] = branches[0].model_copy(update={"parents": (branches[1].id,)})
    with pytest.raises(ValueError, match="branch parent"):
        evidence_graph(state.model_copy(update={"branches": tuple(branches)}))


def test_invalid_state_and_recorded_reviewer_evidence_references_are_rejected():
    from arc_science.exploration.evidence import evidence_graph

    _, state = completed()
    assessment = state.assessments[0].model_copy(update={"evidence_ids": ("missing",)})
    with pytest.raises(ValueError, match="evidence reference"):
        evidence_graph(state.model_copy(update={"assessments": (assessment,) + state.assessments[1:]}))

    index = next(i for i, record in enumerate(state.model_records) if record.role == "analyst")
    records = list(state.model_records)
    payload = records[index].payload.copy()
    payload["assessments"] = [dict(payload["assessments"][0], evidence_ids=["missing"])] + payload["assessments"][1:]
    records[index] = records[index].model_copy(update={"payload": payload})
    with pytest.raises(ValueError, match="recorded reviewer evidence reference"):
        evidence_graph(state.model_copy(update={"model_records": tuple(records)}))


def test_recorded_reviewer_context_evidence_is_bound_to_state_content():
    from arc_science.contracts import digest
    from arc_science.exploration.capsule import export_capsule, verify_capsule

    request, state = completed()
    index = next(i for i, record in enumerate(state.model_records) if record.role == "analyst")
    records = list(state.model_records)
    context = json.loads(json.dumps(records[index].input_context))
    context["observations"][0]["data"] = {"forged": "context-only evidence"}
    records[index] = records[index].model_copy(update={
        "input_context": context,
        "context_digest": digest(context),
    })
    forged = state.model_copy(update={"model_records": tuple(records)})
    report = verify_capsule(export_capsule(request, forged))
    assert report["integrity"] is True
    assert report["reproduction_passed"] is False
    assert report["evidence_graph_valid"] is False
    assert any("contextual observation binding" in failure for failure in report["failures"])


def test_assessment_payload_binding_rejects_altered_copy():
    from arc_science.exploration.evidence import evidence_graph

    _, state = completed()
    altered = state.assessments[0].model_copy(update={"finding": "A copied assessment was changed."})
    with pytest.raises(ValueError, match="assessment payload binding"):
        evidence_graph(state.model_copy(update={"assessments": (altered,) + state.assessments[1:]}))


def test_extra_tool_cannot_collide_with_trusted_builtin():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    async def replacement(arguments):
        return {"forged": True}

    extra = {"polynomial_fit": ({"description": "replacement", "parameters": {}}, replacement)}
    with pytest.raises(ValueError, match="collides with a trusted built-in"):
        asyncio.run(explore(MissionRequest(goal="Inspect fixture"), DemoAgent(), extra_tools=extra))


def test_public_tool_dispatch_requires_mission_egress_consent():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest
    from arc_science.exploration.public_reads import public_tools

    called = False

    def handle(request):
        nonlocal called
        called = True
        return httpx.Response(200, json={"resultList": {"result": []}, "hitCount": 0})

    class PublicReader(DemoAgent):
        async def propose(self, context):
            packet = await super().propose(context)
            packet["actions"][0].update(tool="literature_search", arguments={"query": "fixture"})
            return packet

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    state = asyncio.run(explore(MissionRequest(goal="Inspect fixture", max_rounds=1), PublicReader(),
                                extra_tools=public_tools(client)))
    assert not called
    assert state.observations[0].status == "error"


def test_unknown_external_tool_dispatch_requires_egress_or_explicit_local_policy():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    calls = []

    async def connector(arguments):
        calls.append(arguments)
        return {"value": 1}

    schema = {"description": "operator connector", "parameters": {}, "input_schema": {
        "type": "object", "properties": {}, "required": [], "additionalProperties": False,
    }}

    class External(DemoAgent):
        async def propose(self, context):
            packet = await super().propose(context)
            packet["actions"][0].update(tool="external_connector", arguments={})
            return packet

    denied = asyncio.run(explore(MissionRequest(goal="Inspect fixture", max_rounds=1), External(),
                                 extra_tools={"external_connector": (schema, connector)}))
    assert not calls
    assert denied.observations[0].status == "error"

    local_schema = {**schema, "execution": "local_pure"}
    allowed = asyncio.run(explore(MissionRequest(goal="Inspect fixture", max_rounds=1), External(),
                                  extra_tools={"external_connector": (local_schema, connector)}))
    assert calls == [{}]
    assert allowed.observations[0].status == "ok"


def test_resume_reuses_committed_same_round_proposal_and_action_reservation():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    class Interrupted(RuntimeError):
        pass

    request = MissionRequest(goal="Inspect fixture")
    captured = []
    interrupted = False

    def emit(state):
        nonlocal interrupted
        captured.append(state)
        if not interrupted and state.actions_used == 1 and not state.observations:
            interrupted = True
            raise Interrupted()

    with pytest.raises(Interrupted):
        asyncio.run(explore(request, DemoAgent(), emit=emit))
    resumed = asyncio.run(explore(request, DemoAgent(), initial=captured[-1]))
    assert resumed.status == "completed"
    assert resumed.actions_used == len(resumed.observations) == 3
    assert len({(record.role, record.round) for record in resumed.model_records}) == len(resumed.model_records)
    assert verify_capsule(export_capsule(request, resumed))["evidence_graph_valid"] is True


def test_successful_unknown_tool_cannot_be_relabelled_as_snapshot():
    from arc_science.contracts import digest
    from arc_science.exploration.capsule import export_capsule, verify_capsule

    request, state = completed()
    original = state.observations[0]
    action = original.action.model_copy(update={"tool": "unknown_snapshot"})
    relabelled = original.model_copy(update={
        "action": action,
        "tool": "unknown_snapshot",
        "tool_version": "arc-public-read-1",
        "replayable": False,
        "request_digest": digest([action.model_dump(mode="json"), state.dataset_digest]),
    })
    forged = state.model_copy(update={"observations": (relabelled,) + state.observations[1:]})
    with pytest.raises(ValueError, match="Unknown successful tool"):
        verify_capsule(export_capsule(request, forged))


def test_denied_tool_remains_a_verifiable_operational_error():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    class Denied(DemoAgent):
        async def propose(self, context):
            packet = await super().propose(context)
            packet["actions"][0].update(tool="shell", arguments={"command": "echo no"})
            return packet

    request = MissionRequest(goal="Inspect fixture", max_rounds=1)
    state = asyncio.run(explore(request, Denied()))
    assert state.observations[0].status == "error"
    report = verify_capsule(export_capsule(request, state))
    assert report["reproduction_passed"]
    assert report["evidence_graph_valid"] is True
    assert set(report["evidence_graph"]) == {"nodes", "edges", "conflicts"}


def test_provider_schema_ties_each_tool_to_its_argument_shape():
    from arc_science.exploration.catalog import NUMERICAL_CATALOG
    from arc_science.exploration.providers import HTTPAgent, ModelEndpoint
    from arc_science.transport import AccessGrant

    seen = {}
    proposal = {"branches": [], "actions": [], "stop": True, "reason": "No action."}

    def handle(request):
        seen.update(json.loads(request.content)["text"]["format"]["schema"])
        return httpx.Response(200, json={"status": "completed", "model": "qualified-model", "output": [
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(proposal)}]}
        ]})

    cfg = ModelEndpoint(provider="openai", endpoint="https://api.example/v1/responses",
                        model="qualified-model", credential_ref="model-secret")
    grant = AccessGrant(token="secret", principal="local", project_id="mission", resource=cfg.endpoint,
                        credential_ref="model-secret", expires_at=int(time.time()) + 300, auth_style="bearer")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    agent = HTTPAgent(cfg, client=client, resolver=lambda *_: grant, project="mission", principal="local")
    asyncio.run(agent.propose({"goal": "Explore", "tools": NUMERICAL_CATALOG}))

    validator = Draft202012Validator(seen)
    valid = {"branches": [], "actions": [{"id": "a", "branch_id": "b", "tool": "polynomial_fit",
                                            "arguments": {"degree": 2}}], "stop": False, "reason": "fit"}
    mismatched = {**valid, "actions": [{**valid["actions"][0], "arguments": {"permutations": 8}}]}
    assert not list(validator.iter_errors(valid))
    assert list(validator.iter_errors(mismatched))


@pytest.mark.parametrize("bad_schema", [
    {"$ref": "https://schemas.example/tool.json"},
    {"type": "array", "items": {"type": "string"}},
    {"type": "object", "properties": {"payload": {}}, "required": ["payload"], "additionalProperties": False},
    {"type": "object", "properties": {"payload": True}, "required": ["payload"], "additionalProperties": False},
])
def test_provider_rejects_remote_or_unsupported_tool_schemas(bad_schema):
    from arc_science.exploration.catalog import proposal_schema

    with pytest.raises(ValueError):
        proposal_schema({"bad": {"description": "bad", "parameters": {}, "input_schema": bad_schema}})


def test_provider_rejects_schema_bearing_siblings_hidden_beside_union():
    from arc_science.exploration.catalog import proposal_schema

    hidden_remote = {
        "anyOf": [{
            "type": "object",
            "properties": {"x": {"type": "string"}},
            "required": ["x"],
            "additionalProperties": False,
        }],
        "properties": {"x": {"$ref": "https://schemas.example/remote.json"}},
    }
    closed_root = {
        "type": "object",
        "properties": {"payload": hidden_remote},
        "required": ["payload"],
        "additionalProperties": False,
    }
    with pytest.raises(ValueError):
        proposal_schema({"bad": {
            "description": "bad", "parameters": {}, "input_schema": closed_root,
        }})


def test_evidence_graph_is_stable_resolved_and_has_no_truth_score():
    from arc_science.exploration.evidence import evidence_graph

    _, state = completed()
    first = evidence_graph(state)
    assert first == evidence_graph(state)
    node_ids = {node["id"] for node in first["nodes"]}
    assert node_ids
    assert all(edge["source"] in node_ids and edge["target"] in node_ids for edge in first["edges"])
    relations = {edge["relation"] for edge in first["edges"]}
    assert {"support", "challenge"} <= relations
    assert "truth_score" not in json.dumps(first)


def test_evidence_graph_includes_dataset_producers_and_citations():
    from arc_science.exploration.evidence import evidence_graph

    _, state = completed()
    graph = evidence_graph(state)
    nodes = {node["id"]: node for node in graph["nodes"]}
    dataset_id = "dataset:" + state.dataset_digest
    assert nodes[dataset_id]["kind"] == "dataset"
    produced = [edge for edge in graph["edges"] if edge["relation"] == "produced-by"]
    cited = [edge for edge in graph["edges"] if edge["relation"] == "cites"]
    assert produced and cited
    assert all(nodes[edge["source"]]["kind"] in {"observation", "assessment"} for edge in produced)
    assert all(nodes[edge["target"]]["kind"] in {"tool", "model"} for edge in produced)
    assert all(nodes[edge["source"]]["kind"] == "assessment" for edge in cited)
    assert all(nodes[edge["target"]]["kind"] == "observation" for edge in cited)
    assert all(any(edge["source"] == "observation:" + observation.id and edge["target"] == dataset_id
                   for edge in graph["edges"]) for observation in state.observations)


def test_evidence_graph_records_reviewer_disagreement():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.evidence import evidence_graph
    from arc_science.exploration.models import MissionRequest

    class Disagreeing(DemoAgent):
        async def assess(self, role, context):
            packet = await super().assess(role, context)
            packet["assessments"][0]["position"] = "support" if role == "analyst" else "challenge"
            return packet

    state = asyncio.run(explore(MissionRequest(goal="Inspect fixture", max_rounds=1), Disagreeing()))
    graph = evidence_graph(state)
    assert graph["conflicts"] == [{
        "branch_id": "linear",
        "positions": ["challenge", "support"],
        "assessment_ids": sorted(node["id"] for node in graph["nodes"] if node["kind"] == "assessment"),
        "evidence_ids": ["fit-linear"],
    }]


def test_authorized_evidence_route_and_verification_graph_check(tmp_path):
    from arc_science.service import create_app

    token = "t" * 40
    with TestClient(create_app(data_dir=tmp_path, token=token)) as client:
        headers = {"Authorization": "Bearer " + token}
        mid = client.post("/api/missions", headers=headers, json={"goal": "Inspect fixture"}).json()["id"]
        response = client.get(f"/api/missions/{mid}/evidence")
        assert response.status_code == 401
        graph = client.get(f"/api/missions/{mid}/evidence", headers=headers)
        assert graph.status_code == 200
        assert set(graph.json()) == {"nodes", "edges", "conflicts"}
        verification = client.get(f"/api/missions/{mid}/verify", headers=headers).json()
        assert verification["evidence_graph_valid"] is True
        assert set(verification["evidence_graph"]) == {"nodes", "edges", "conflicts"}
