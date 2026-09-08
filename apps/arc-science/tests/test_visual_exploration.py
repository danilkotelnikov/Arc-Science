"""Behavioral tests for artifact-bound visual review."""
import asyncio
import base64
import copy
import hashlib
import json
import time

import httpx
import pytest


def completed(**request_updates):
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    request = MissionRequest(goal="Inspect the fixture", **request_updates)
    return request, asyncio.run(explore(request, DemoAgent()))


def accepted_two_image_checkpoint():
    from arc_science.contracts import digest
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest, VisualReport

    class Interrupted(RuntimeError):
        pass

    class TwoFits(DemoAgent):
        vision_model = "fixture-vision"

        async def propose(self, context):
            return {"branches": [
                {"id": "linear", "title": "Linear", "hypothesis": "A linear fit is adequate.",
                 "falsifier": "Structured residuals.", "parents": []},
                {"id": "quadratic", "title": "Quadratic", "hypothesis": "A quadratic fit is adequate.",
                 "falsifier": "No improvement over linear.", "parents": []}],
                "actions": [
                    {"id": "fit-linear", "branch_id": "linear", "tool": "polynomial_fit",
                     "arguments": {"degree": 1}},
                    {"id": "fit-quadratic", "branch_id": "quadratic", "tool": "polynomial_fit",
                     "arguments": {"degree": 2}}],
                "stop": False, "reason": "Compare two fits."}

        async def review_visual(self, context, artifacts):
            return VisualReport(candidate_digest=context["candidate_digest"],
                reviewed_digests=tuple(item.digest for item in artifacts), verdict="adequate", findings=(),
                model=self.vision_model, round=context["round"], prompt_version="arc-visual-review-1",
                context_digest=digest(context), input_context=context)

    request = MissionRequest(goal="Inspect two fits", vision_review=True, max_rounds=1)
    captured = []

    def emit(state):
        captured.append(state)
        if state.vision_records and state.vision_records[-1].status == "accepted":
            raise Interrupted()

    with pytest.raises(Interrupted):
        asyncio.run(explore(request, TwoFits(), emit=emit))
    return request, captured[-1]


def test_real_plot_is_deterministic_uses_every_point_and_stable_fit_coordinates():
    from arc_science.exploration.artifacts import plot_series, render_polynomial_plot
    from arc_science.exploration.models import Point
    from arc_science.exploration.tools import execute_numeric

    points = tuple(Point(x=999900 + i / 1000,
                         y=1 + 2 * (i / 1000) + 3 * (i / 1000) ** 2)
                   for i in range(32))
    fit = execute_numeric("polynomial_fit", {"degree": 2}, points)
    predictions, residuals = plot_series(points, fit)
    assert max(abs(predicted - point.y) for predicted, point in zip(predictions, points)) < 1e-8
    assert max(abs(value) for value in residuals) < 1e-8

    first = render_polynomial_plot(points, fit)
    assert first == render_polynomial_plot(points, fit)
    assert first.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(first) <= 1024 * 1024

    long_points = tuple(Point(x=i / 10, y=1 + 2 * (i / 10) + 0.1 * (i / 10) ** 2)
                        for i in range(96))
    long_fit = execute_numeric("polynomial_fit", {"degree": 2}, long_points)
    changed = long_points[:-1] + (long_points[-1].model_copy(update={"y": long_points[-1].y + 0.25}),)
    assert render_polynomial_plot(changed, long_fit) != render_polynomial_plot(long_points, long_fit)


def test_artifact_bytes_and_source_observation_are_bound_and_capsule_rerenders():
    from arc_science.contracts import digest
    from arc_science.exploration.capsule import export_capsule, verify_capsule

    request, state = completed()
    assert state.artifacts
    artifact = state.artifacts[0]
    assert artifact.digest == hashlib.sha256(artifact.bytes).hexdigest()
    assert artifact.source_observation_digest == next(
        item.digest for item in state.observations if item.id == artifact.source_observation_id
    )
    assert verify_capsule(export_capsule(request, state))["artifacts_reproduced"] == len(state.artifacts)

    raw = artifact.model_dump(mode="json")
    raw["data_base64"] = base64.b64encode(artifact.bytes[:-1] + b"0").decode("ascii")
    raw["digest"] = hashlib.sha256(base64.b64decode(raw["data_base64"])).hexdigest()
    from arc_science.exploration.models import Artifact
    substituted = Artifact.model_validate(raw)
    forged = state.model_copy(update={"artifacts": (substituted,) + state.artifacts[1:]})
    report = verify_capsule(export_capsule(request, forged))
    assert report["reproduction_passed"] is False
    assert any("artifact rendering mismatch" in failure for failure in report["failures"])

    rebound = artifact.model_copy(update={"source_observation_digest": digest({"forged": True})})
    rebound_report = verify_capsule(export_capsule(
        request, state.model_copy(update={"artifacts": (rebound,) + state.artifacts[1:]})))
    assert rebound_report["reproduction_passed"] is False
    assert rebound_report["evidence_graph_valid"] is False


def test_capsule_rejects_visual_receipt_covering_only_part_of_same_round_batch():
    from arc_science.contracts import digest
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.models import VisualReport, VisionRecord
    from arc_science.exploration.vision import visual_context

    request, state = accepted_two_image_checkpoint()
    assert len(state.artifacts) == 2
    original = state.vision_records[0]
    selected = state.artifacts[:1]
    context = visual_context(original.input_context["mission"], selected)
    report = VisualReport(candidate_digest=context["candidate_digest"],
        reviewed_digests=(selected[0].digest,), verdict="adequate", findings=(), model=original.model,
        round=original.round, prompt_version=original.prompt_version,
        context_digest=digest(context), input_context=context)
    reservation = VisionRecord(candidate_digest=context["candidate_digest"],
        reviewed_digests=report.reviewed_digests, context_digest=digest(context), input_context=context,
        prompt_version=original.prompt_version, round=original.round, model=original.model,
        status="accepted", report_digest=report.digest)
    forged = state.model_copy(update={"visual_reports": (report,), "vision_records": (reservation,)})

    with pytest.raises(ValueError, match="exact supplied image batch"):
        verify_capsule(export_capsule(request, forged))


def test_capsule_rejects_visual_context_round_diverging_from_record_round():
    from arc_science.contracts import digest
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.models import VisualReport, VisionRecord
    from arc_science.exploration.vision import visual_context

    request, state = accepted_two_image_checkpoint()
    original = state.vision_records[0]
    mission_context = copy.deepcopy(original.input_context["mission"])
    mission_context["round"] = 999
    context = visual_context(mission_context, state.artifacts)
    report = VisualReport(candidate_digest=context["candidate_digest"],
        reviewed_digests=tuple(item.digest for item in state.artifacts), verdict="adequate", findings=(),
        model=original.model, round=original.round, prompt_version=original.prompt_version,
        context_digest=digest(context), input_context=context)
    reservation = VisionRecord(candidate_digest=context["candidate_digest"],
        reviewed_digests=report.reviewed_digests, context_digest=digest(context), input_context=context,
        prompt_version=original.prompt_version, round=original.round, model=original.model,
        status="accepted", report_digest=report.digest)
    forged = state.model_copy(update={"visual_reports": (report,), "vision_records": (reservation,)})

    with pytest.raises(ValueError, match="model or round binding"):
        verify_capsule(export_capsule(request, forged))


def test_capsule_rejects_completed_required_vision_without_an_accepted_report():
    from arc_science.exploration.capsule import export_capsule, verify_capsule

    request, state = completed(vision_review=True)
    assert state.status == "needs_input"
    assert state.artifacts and not state.visual_reports
    assert verify_capsule(export_capsule(request, state))["reproduction_passed"] is True
    paused = state.model_copy(update={"status": "paused", "stop_reason": "Operator paused."})
    assert verify_capsule(export_capsule(request, paused))["reproduction_passed"] is True
    forged = state.model_copy(update={"status": "completed",
                                      "stop_reason": "All requested review is complete."})

    with pytest.raises(ValueError, match="Required visual review is incomplete"):
        verify_capsule(export_capsule(request, forged))


def test_visual_reply_rejects_adequate_verdict_with_blocking_finding():
    from arc_science.exploration.models import VisualFinding, VisualReply

    artifact_digest = "a" * 64
    with pytest.raises(ValueError, match="blocking"):
        VisualReply(candidate_digest="b" * 64, reviewed_digests=(artifact_digest,), verdict="adequate",
                    findings=(VisualFinding(artifact_digest=artifact_digest, severity="blocking",
                                            category="axes", detail="Axes are illegible."),))


def test_required_visual_gate_and_capsule_preserve_adequate_advisory_findings():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.models import VisualFinding
    from arc_science.exploration.vision import required_visual_reason

    request, state = accepted_two_image_checkpoint()
    original = state.visual_reports[0]
    advisory = original.model_copy(update={"findings": (
        VisualFinding(artifact_digest=state.artifacts[0].digest, severity="minor",
                      category="legend", detail="Consider a shorter legend in later revisions."),)})
    record = state.vision_records[0].model_copy(update={"report_digest": advisory.digest})
    completed_state = state.model_copy(update={"visual_reports": (advisory,), "vision_records": (record,),
                                               "status": "completed", "stop_reason": "Review complete."})

    assert required_visual_reason(completed_state.artifacts, completed_state.visual_reports,
                                  completed_state.vision_records) is None
    replay = verify_capsule(export_capsule(request, completed_state))
    assert replay["reproduction_passed"] is True
    assert replay["evidence_graph_valid"] is True


def test_required_visual_gate_rejects_mutated_adequate_blocking_report():
    from arc_science.exploration.models import VisualFinding
    from arc_science.exploration.vision import required_visual_reason

    request, state = accepted_two_image_checkpoint()
    original = state.visual_reports[0]
    blocking = original.model_copy(update={"findings": (
        VisualFinding(artifact_digest=state.artifacts[0].digest, severity="blocking",
                      category="axes", detail="Axes are illegible and require rejection."),)})
    record = state.vision_records[0].model_copy(update={"report_digest": blocking.digest})
    forged = state.model_copy(update={"visual_reports": (blocking,), "vision_records": (record,),
                                      "status": "completed", "stop_reason": "Review complete."})

    assert "blocking" in required_visual_reason(forged.artifacts, forged.visual_reports,
                                                 forged.vision_records).lower()


def test_capsule_rejects_rehashed_adequate_blocking_visual_forgery():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.models import VisualFinding

    request, state = accepted_two_image_checkpoint()
    original = state.visual_reports[0]
    blocking = original.model_copy(update={"findings": (
        VisualFinding(artifact_digest=state.artifacts[0].digest, severity="blocking",
                      category="axes", detail="Axes are illegible and require rejection."),)})
    record = state.vision_records[0].model_copy(update={"report_digest": blocking.digest})
    forged = state.model_copy(update={"visual_reports": (blocking,), "vision_records": (record,),
                                      "status": "completed", "stop_reason": "Review complete."})

    with pytest.raises(ValueError):
        verify_capsule(export_capsule(request, forged))


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_native_provider_image_blocks_decode_to_exact_artifact(provider):
    from arc_science.exploration.providers import HTTPAgent, ModelEndpoint
    from arc_science.exploration.vision import visual_context
    from arc_science.transport import AccessGrant

    _, state = completed()
    artifacts = state.artifacts[:1]
    context = visual_context({"goal": "Inspect", "round": 0}, artifacts)

    def handle(request):
        body = json.loads(request.content)
        content = body["messages"][0]["content"] if provider == "anthropic" else body["input"][0]["content"]
        if provider == "anthropic":
            encoded = next(block["source"]["data"] for block in content if block["type"] == "image")
        else:
            url = next(block["image_url"] for block in content if block["type"] == "input_image")
            assert url.startswith("data:image/png;base64,")
            encoded = url.split(",", 1)[1]
        assert base64.b64decode(encoded, validate=True) == artifacts[0].bytes
        payload = {"candidate_digest": context["candidate_digest"],
                   "reviewed_digests": [artifacts[0].digest], "verdict": "adequate", "findings": []}
        if provider == "anthropic":
            return httpx.Response(200, json={"model": "vision-model", "stop_reason": "end_turn",
                                             "content": [{"type": "text", "text": json.dumps(payload)}]})
        return httpx.Response(200, json={"status": "completed", "model": "vision-model", "output": [
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(payload)}]}
        ]})

    endpoint = "https://api.example/v1/messages" if provider == "anthropic" else "https://api.example/v1/responses"
    planner = ModelEndpoint(provider=provider, endpoint=endpoint, model="planner-model", credential_ref="planner")
    vision = ModelEndpoint(provider=provider, endpoint=endpoint, model="vision-model", credential_ref="vision")

    def resolve(ref, principal, project):
        return AccessGrant(token="secret", principal=principal, project_id=project, resource=endpoint,
                           credential_ref=ref, expires_at=int(time.time()) + 60,
                           auth_style="x-api-key" if provider == "anthropic" else "bearer")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    agent = HTTPAgent(planner, vision_config=vision, client=client, resolver=resolve,
                      project="mission", principal="local")
    report = asyncio.run(agent.review_visual(context, artifacts))
    assert report.model == "vision-model"
    assert report.reviewed_digests == (artifacts[0].digest,)


def test_provider_rejects_visual_reply_without_exact_digest_coverage():
    from arc_science.exploration.providers import HTTPAgent, ModelEndpoint
    from arc_science.exploration.vision import visual_context
    from arc_science.transport import AccessGrant, ProviderError

    _, state = completed()
    artifacts = state.artifacts[:1]
    context = visual_context({"goal": "Inspect", "round": 0}, artifacts)

    def handle(request):
        payload = {"candidate_digest": context["candidate_digest"], "reviewed_digests": [],
                   "verdict": "adequate", "findings": []}
        return httpx.Response(200, json={"status": "completed", "model": "vision-model", "output": [
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(payload)}]}
        ]})

    endpoint = "https://api.example/v1/responses"
    cfg = ModelEndpoint(provider="openai", endpoint=endpoint, model="planner-model", credential_ref="planner")
    vision = ModelEndpoint(provider="openai", endpoint=endpoint, model="vision-model", credential_ref="vision")
    resolver = lambda ref, principal, project: AccessGrant(
        token="secret", principal=principal, project_id=project, resource=endpoint,
        credential_ref=ref, expires_at=int(time.time()) + 60, auth_style="bearer")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    http_agent = HTTPAgent(cfg, vision_config=vision, client=client, resolver=resolver,
                           project="mission", principal="local")
    with pytest.raises(ProviderError):
        asyncio.run(http_agent.review_visual(context, artifacts))


def test_required_vision_cannot_complete_without_a_vision_seat():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    request = MissionRequest(goal="Inspect the fixture", vision_review=True)
    state = asyncio.run(explore(request, DemoAgent()))
    assert state.status == "needs_input"
    assert "vision" in state.stop_reason.lower()
    assert state.publication_eligible is False
    assert state.artifacts


def test_visual_call_is_reserved_before_failure_and_not_repeated_on_resume():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    class Interrupted(RuntimeError):
        pass

    class VisionAgent(DemoAgent):
        vision_model = "fixture-vision"
        calls = 0

        async def review_visual(self, context, artifacts):
            self.calls += 1
            raise AssertionError("the reservation checkpoint should interrupt before dispatch")

    request = MissionRequest(goal="Inspect the fixture", vision_review=True)
    agent = VisionAgent()
    captured = []

    def emit(state):
        captured.append(state)
        if state.vision_records and state.vision_records[-1].status == "reserved":
            raise Interrupted()

    with pytest.raises(Interrupted):
        asyncio.run(explore(request, agent, emit=emit))
    reserved = captured[-1]
    assert reserved.model_calls_used == 2  # planner, then visual review
    assert agent.calls == 0

    resumed = asyncio.run(explore(request, agent, initial=reserved))
    assert resumed.status == "needs_input"
    assert resumed.model_calls_used == 2
    assert agent.calls == 0


def test_accepted_visual_call_is_not_repeated_when_reconciliation_is_interrupted():
    from arc_science.contracts import digest
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest, VisualReport

    class Interrupted(RuntimeError):
        pass

    class VisionAgent(DemoAgent):
        vision_model = "fixture-vision"

        def __init__(self):
            self.calls = 0

        async def review_visual(self, context, artifacts):
            self.calls += 1
            return VisualReport(candidate_digest=context["candidate_digest"],
                reviewed_digests=tuple(item.digest for item in artifacts), verdict="adequate", findings=(),
                model=self.vision_model, round=context["round"], prompt_version="arc-visual-review-1",
                context_digest=digest(context), input_context=context)

    request = MissionRequest(goal="Inspect the fixture", vision_review=True)
    agent = VisionAgent()
    captured = []
    interrupted = False

    def emit(state):
        nonlocal interrupted
        captured.append(state)
        if not interrupted and state.vision_records and state.vision_records[-1].status == "accepted":
            interrupted = True
            raise Interrupted()

    with pytest.raises(Interrupted):
        asyncio.run(explore(request, agent, emit=emit))
    resumed = asyncio.run(explore(request, agent, initial=captured[-1]))
    assert resumed.status == "completed"
    assert agent.calls == len(resumed.visual_reports) == 2
    assert len({record.candidate_digest for record in resumed.vision_records}) == 2


def test_visual_findings_reach_the_next_planner_without_image_bytes():
    from arc_science.contracts import digest
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest, VisualFinding, VisualReport

    class VisionAgent(DemoAgent):
        vision_model = "fixture-vision"

        async def review_visual(self, context, artifacts):
            return VisualReport(candidate_digest=context["candidate_digest"],
                reviewed_digests=tuple(item.digest for item in artifacts), verdict="adequate",
                findings=(VisualFinding(artifact_digest=artifacts[0].digest, severity="minor",
                                        category="residuals", detail="Inspect the residual pattern."),),
                model=self.vision_model, round=context["round"], prompt_version="arc-visual-review-1",
                context_digest=digest(context), input_context=context)

        async def propose(self, context):
            assert "data_base64" not in json.dumps(context)
            if context["round"] == 1:
                assert context["visual_reports"][0]["findings"][0]["detail"] == "Inspect the residual pattern."
            return await super().propose(context)

    state = asyncio.run(explore(MissionRequest(goal="Inspect the fixture", vision_review=True), VisionAgent()))
    assert state.status == "completed"
    assert state.visual_reports
    assert all(record.status == "accepted" for record in state.vision_records)
    assert all("data_base64" not in json.dumps(record.input_context) for record in state.model_records)


def test_issues_or_uncertain_visual_coverage_prevents_planner_completion():
    from arc_science.contracts import digest
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest, VisualFinding, VisualReport

    class Issues(DemoAgent):
        vision_model = "fixture-vision"

        async def review_visual(self, context, artifacts):
            return VisualReport(candidate_digest=context["candidate_digest"],
                reviewed_digests=tuple(item.digest for item in artifacts), verdict="issues",
                findings=(VisualFinding(artifact_digest=artifacts[0].digest, severity="major",
                                        category="fit", detail="The plot needs human review."),),
                model=self.vision_model, round=context["round"], prompt_version="arc-visual-review-1",
                context_digest=digest(context), input_context=context)

    state = asyncio.run(explore(MissionRequest(goal="Inspect the fixture", vision_review=True), Issues()))
    assert state.status == "needs_input"
    assert "visual" in state.stop_reason.lower()
    assert state.publication_eligible is False


def test_artifact_route_is_authenticated_and_returns_exact_png(tmp_path):
    from fastapi.testclient import TestClient
    from arc_science.service import create_app

    token = "t" * 40
    with TestClient(create_app(data_dir=tmp_path, token=token)) as client:
        headers = {"Authorization": "Bearer " + token}
        row = client.post("/api/missions", headers=headers, json={"goal": "Inspect fixture"}).json()
        mid = row["id"]
        client.post(f"/api/missions/{mid}/start", headers=headers)
        for _ in range(150):
            row = client.get(f"/api/missions/{mid}", headers=headers).json()
            if row["state"]["status"] not in {"ready", "running"}:
                break
            time.sleep(0.01)
        artifact = row["state"]["artifacts"][0]
        path = f"/api/missions/{mid}/artifacts/{artifact['digest']}"
        assert client.get(path).status_code == 401
        response = client.get(path, headers=headers)
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content == base64.b64decode(artifact["data_base64"], validate=True)
        assert "blob:" in client.get("/diagnostics").headers["content-security-policy"]


def test_live_required_vision_needs_separate_configured_model(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from arc_science.service import create_app

    planner = tmp_path / "planner.token"
    planner.write_text("secret\n")
    monkeypatch.setenv("ARC_MODEL", "planner-model")
    monkeypatch.setenv("ARC_MODEL_TOKEN_FILE", str(planner))
    monkeypatch.delenv("ARC_VISION_MODEL", raising=False)
    token = "t" * 40
    with TestClient(create_app(data_dir=tmp_path, token=token)) as client:
        response = client.post("/api/missions", headers={"Authorization": "Bearer " + token}, json={
            "goal": "Inspect fixture", "mode": "live", "allow_egress": True, "vision_review": True})
        assert response.status_code == 409
        assert "vision" in response.json()["detail"].lower()
