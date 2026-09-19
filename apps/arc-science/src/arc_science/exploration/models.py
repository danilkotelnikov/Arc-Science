from __future__ import annotations
import base64
import hashlib
from typing import Annotated, Literal
from pydantic import Field, model_validator
from ..contracts import Record, Digest, Identifier, canonical, digest

Id = Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')]

class Point(Record):
    x: float = Field(ge=-1e6, le=1e6)
    y: float = Field(ge=-1e12, le=1e12)

class MissionRequest(Record):
    goal: str = Field(min_length=3, max_length=10000)
    mode: Literal['demo', 'live'] = 'demo'
    seed: int = Field(default=17, ge=0, le=2147483647)
    points: tuple[Point, ...] | None = Field(default=None, min_length=8, max_length=2000)
    max_rounds: int = Field(default=5, ge=1, le=12)
    max_branches: int = Field(default=12, ge=2, le=24)
    max_actions: int = Field(default=20, ge=1, le=64)
    max_model_calls: int = Field(default=24, ge=1, le=64)
    max_parallel: int = Field(default=3, ge=1, le=8)
    allow_egress: bool = False
    vision_review: bool = False

    @model_validator(mode='after')
    def egress_consent(self):
        if self.mode == 'live' and not self.allow_egress:
            raise ValueError('Live models require explicit permission to send mission data')
        return self

class BranchIdea(Record):
    id: Id
    title: str = Field(min_length=1, max_length=180)
    hypothesis: str = Field(min_length=1, max_length=1000)
    falsifier: str = Field(min_length=1, max_length=700)
    parents: tuple[Id, ...] = Field(default=(), max_length=8)

class Branch(BranchIdea):
    created_round: int = Field(ge=0)

class Action(Record):
    id: Id
    branch_id: Id
    tool: str = Field(min_length=1, max_length=80)
    arguments: dict = Field(default_factory=dict)

    @model_validator(mode='after')
    def small_arguments(self):
        from ..contracts import canonical
        if len(canonical(self.arguments)) > 16000:
            raise ValueError('Action arguments exceed budget')
        return self

class Proposal(Record):
    branches: tuple[BranchIdea, ...] = Field(default=(), max_length=6)
    actions: tuple[Action, ...] = Field(default=(), max_length=8)
    stop: bool = False
    reason: str = Field(default='', max_length=700)

class Assessment(Record):
    branch_id: Id
    position: Literal['support', 'challenge', 'uncertain']
    evidence_ids: tuple[Id, ...] = Field(min_length=1, max_length=12)
    finding: str = Field(min_length=1, max_length=900)
    next_test: str = Field(default='', max_length=600)

class Reconciliation(Record):
    assessments: tuple[Assessment, ...] = Field(max_length=24)
    summary: str = Field(default='', max_length=1200)

class Assessed(Assessment):
    role: str
    round: int
    model: str

class Observation(Record):
    id: Id
    action: Action
    tool: str
    tool_version: str
    branch_id: Id
    round: int
    status: Literal['ok', 'error']
    data: dict
    dataset_digest: Digest
    request_digest: Digest
    replayable: bool = True

    @property
    def digest(self):
        return digest(self)

class Event(Record):
    kind: str
    round: int
    detail: str = Field(max_length=1200)

class ModelRecord(Record):
    context_digest: Digest
    input_context: dict
    prompt_version: str = "arc-exploration-1"
    role: str
    round: int
    model: str
    payload: dict
    # Per-call transport provenance (observed identity, usage, contract) when the
    # agent reports it; absent for scripted fixtures and older records.
    transport: dict | None = None


class Artifact(Record):
    digest: Digest
    media_type: Literal['image/png'] = 'image/png'
    size: int = Field(ge=1, le=1024 * 1024)
    data_base64: str = Field(min_length=1, max_length=1400000)
    source_observation_id: Id
    source_observation_digest: Digest
    kind: Literal['polynomial_fit_plot'] = 'polynomial_fit_plot'
    renderer_version: Literal['arc-plot-1'] = 'arc-plot-1'
    round: int = Field(ge=0)
    # Presentation-only render settings and the artifact this render supersedes
    # (loop B): both are part of the manifest, so a repaired image is a new candidate.
    preset: RenderPreset = 'default'
    repair_of: Digest | None = None

    @model_validator(mode='after')
    def content_binding(self):
        try:
            content = base64.b64decode(self.data_base64, validate=True)
        except Exception:
            raise ValueError('Artifact image bytes are not valid base64') from None
        if len(content) != self.size:
            raise ValueError('Artifact size does not match image bytes')
        if hashlib.sha256(content).hexdigest() != self.digest:
            raise ValueError('Artifact digest does not match image bytes')
        if not content.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('Artifact content is not a PNG image')
        return self

    @property
    def bytes(self) -> bytes:
        return base64.b64decode(self.data_base64, validate=True)

    def manifest(self) -> dict:
        return self.model_dump(mode='json', exclude={'data_base64'})


RenderPreset = Literal['default', 'spacious', 'large_text']
VisualPromptVersion = Literal['arc-visual-review-1', 'arc-visual-review-2']


class VisualFinding(Record):
    artifact_digest: Digest
    severity: Literal['blocking', 'major', 'minor']
    category: str = Field(min_length=1, max_length=64)
    detail: str = Field(min_length=1, max_length=700)


class VisualReply(Record):
    candidate_digest: Digest
    reviewed_digests: tuple[Digest, ...] = Field(min_length=1, max_length=8)
    verdict: Literal['adequate', 'issues', 'uncertain']
    findings: tuple[VisualFinding, ...] = Field(default=(), max_length=32)

    @model_validator(mode='after')
    def findings_are_reviewed(self):
        reviewed = set(self.reviewed_digests)
        if len(reviewed) != len(self.reviewed_digests):
            raise ValueError('Visual review repeats an image digest')
        if any(item.artifact_digest not in reviewed for item in self.findings):
            raise ValueError('Visual finding targets an unreviewed artifact')
        if self.verdict == 'issues' and not self.findings:
            raise ValueError('An issues verdict requires a bounded finding')
        if self.verdict == 'adequate' and any(item.severity == 'blocking' for item in self.findings):
            raise ValueError('An adequate verdict cannot contain a blocking finding')
        return self


class VisualReport(VisualReply):
    model: Identifier
    round: int = Field(ge=0)
    prompt_version: VisualPromptVersion = 'arc-visual-review-2'
    context_digest: Digest
    input_context: dict

    @model_validator(mode='after')
    def context_binding(self):
        if len(canonical(self.input_context)) > 350000:
            raise ValueError('Visual review context exceeds service budget')
        if digest(self.input_context) != self.context_digest:
            raise ValueError('Visual review context digest mismatch')
        return self

    @property
    def digest(self) -> str:
        return digest(self)

    def manifest(self) -> dict:
        return self.model_dump(mode='json', exclude={'input_context'})


class VisionRecord(Record):
    candidate_digest: Digest
    reviewed_digests: tuple[Digest, ...] = Field(min_length=1, max_length=8)
    context_digest: Digest
    input_context: dict
    prompt_version: VisualPromptVersion = 'arc-visual-review-2'
    round: int = Field(ge=0)
    model: Identifier
    status: Literal['reserved', 'accepted', 'rejected']
    report_digest: Digest | None = None

    @model_validator(mode='after')
    def valid_status(self):
        if digest(self.input_context) != self.context_digest:
            raise ValueError('Vision reservation context digest mismatch')
        if len(set(self.reviewed_digests)) != len(self.reviewed_digests):
            raise ValueError('Vision reservation repeats an image digest')
        if (self.status == 'accepted') != (self.report_digest is not None):
            raise ValueError('Accepted vision reservations require exactly one report')
        return self


class RepairCycle(Record):
    """One consecutive figure-repair cycle (loop B): a reviewed candidate with
    presentation-only findings is re-rendered under the next preset and reviewed
    again as a new candidate. The outcome is the raw result of that fresh review, or
    `blocked` with the reason the cycle could not proceed; nothing is inferred."""
    cycle: int = Field(ge=1, le=2)
    round: int = Field(ge=0)
    preset: RenderPreset
    trigger_report_digest: Digest
    addressed: tuple[str, ...] = Field(max_length=32)
    superseded_digests: tuple[Digest, ...] = Field(min_length=1, max_length=8)
    artifact_digests: tuple[Digest, ...] = Field(default=(), max_length=8)
    outcome: Literal['pending', 'adequate', 'issues', 'uncertain', 'rejected', 'blocked'] = 'pending'
    reason: str = Field(default='', max_length=700)

    @model_validator(mode='after')
    def coherent(self):
        if self.outcome == 'blocked' and not self.reason:
            raise ValueError('A blocked repair cycle must say why')
        if self.outcome != 'blocked' and len(self.artifact_digests) != len(self.superseded_digests):
            raise ValueError('A repair renders exactly one replacement per superseded artifact')
        return self


# Release ledger (loop A of the 2026-09-19 program). A check is one named question
# about the mission with one of six states; unknown and error never count as
# satisfied, not_applicable must say why, and every check remembers the digest of
# what it looked at so a later change can mark it stale rather than silently reuse it.
CheckState = Literal['satisfied', 'failed', 'unknown', 'error', 'stale', 'not_applicable']
MissionCheck = Literal['operational_status', 'event_chain_integrity', 'replay_integrity',
                       'numerical_reproduction', 'artifact_reproduction', 'evidence_graph',
                       'reconciliation', 'visual_review']

class ReleaseCheck(Record):
    name: MissionCheck
    state: CheckState
    checked_basis_digest: Digest
    evidence_digests: tuple[Digest, ...] = ()
    reason: str = Field(min_length=1, max_length=700)

    @model_validator(mode='after')
    def _applicability_needs_a_reason(self):
        if self.state == 'not_applicable' and len(self.reason.strip()) < 8:
            raise ValueError('A not_applicable check must state why it does not apply')
        return self

class VerificationReceipt(Record):
    """What an actual replay verification observed, bound to the state it read."""
    subject_digest: Digest
    report_digest: Digest
    integrity: bool
    reproduction_passed: bool
    evidence_graph_valid: bool
    reproduced: int
    artifacts_reproduced: int
    failures: tuple[str, ...] = ()
    verifier_version: Literal['arc-mission-verifier-1'] = 'arc-mission-verifier-1'
    verified_at: int

class ReleaseDecision(Record):
    policy_digest: Digest
    subject_digest: Digest
    status: Literal['eligible_for_human_review', 'blocked']
    eligible_for_human_review: bool
    checks: tuple[ReleaseCheck, ...]
    blocking_reasons: tuple[str, ...]
    verification: VerificationReceipt | None = None
    decided_at: int

    @model_validator(mode='after')
    def _fail_closed(self):
        blocked = [c for c in self.checks if c.state not in ('satisfied', 'not_applicable')]
        if self.eligible_for_human_review != (not blocked) or self.status != ('blocked' if blocked else 'eligible_for_human_review'):
            raise ValueError('A release decision must follow from its checks')
        return self


class MissionState(Record):
    request_digest: Digest
    status: Literal['ready','running','completed','budget_exhausted','needs_input','error','paused','cancelled'] = 'ready'
    round: int = 0
    data_origin: Literal['synthetic_fixture','user_supplied','none']
    points: tuple[Point, ...]
    dataset_digest: Digest
    branches: tuple[Branch, ...] = ()
    observations: tuple[Observation, ...] = ()
    assessments: tuple[Assessed, ...] = ()
    model_records: tuple[ModelRecord, ...] = ()
    artifacts: tuple[Artifact, ...] = Field(default=(), max_length=64)
    visual_reports: tuple[VisualReport, ...] = Field(default=(), max_length=64)
    vision_records: tuple[VisionRecord, ...] = Field(default=(), max_length=64)
    repairs: tuple[RepairCycle, ...] = Field(default=(), max_length=64)
    events: tuple[Event, ...] = ()
    actions_used: int = 0
    model_calls_used: int = 0
    focus: str | None = None
    publication_eligible: Literal[False] = False
    stop_reason: str = ''
    # The persisted release ledger; None until verification or a terminal transition.
    release: ReleaseDecision | None = None

    @property
    def scientific_digest(self):
        return digest({'data': self.dataset_digest,
                       'observations': [o.model_dump(mode='json') for o in self.observations],
                       'branches': [b.model_dump(mode='json') for b in self.branches],
                       'artifacts': [a.manifest() for a in self.artifacts],
                       'visual_reports': [r.model_dump(mode='json') for r in self.visual_reports],
                       'repairs': [r.model_dump(mode='json') for r in self.repairs]})
