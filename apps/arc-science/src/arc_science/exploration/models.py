from __future__ import annotations
import base64
import hashlib
from typing import Annotated, Any, Literal
from pydantic import Field, model_validator
from ..contracts import Record, Versioned, Digest, Identifier, canonical, digest

Id = Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')]

class Point(Record):
    x: float = Field(ge=-1e6, le=1e6)
    y: float = Field(ge=-1e12, le=1e12)

CREW_ROLES = ('planner', 'reviewer', 'falsifier', 'vision')
CrewRole = Literal['planner', 'reviewer', 'falsifier', 'vision']
# A model id as a seat sends it: never an option-like word a CLI could read as a flag. Slashes
# and colons (org/model, local-model:q4) are allowed as Settings allows them; a seat whose
# provider refuses them (the Gemini API) refuses the crew entry with its own code.
ModelId = Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$')]


class CrewSeat(Record):
    """One role's model and effort for this mission; provider, transport, endpoint and
    credential stay the Settings seat's. effort None sends no level (the transport default)."""
    model: ModelId
    effort: Literal['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] | None = None


# Mission context limits (contract C2).
CONTEXT_MEMORY_LIMIT, CONTEXT_MISSION_LIMIT, CONTEXT_CHAR_LIMIT = 50, 5, 24_000


class ContextItem(Versioned):
    """Earlier work the operator attached, resolved by the service and frozen at creation:
    a memory record (digest = its content digest) or a prior mission's supported scope and
    claims (digest = its release subject digest). Evidence to weigh, never permission.
    A memory record keeps its trust label and source, so a seat can weigh it."""
    LATER_FIELDS = ('trust', 'source_uri')
    kind: Literal['memory', 'mission']
    ref: str = Field(min_length=1, max_length=200)
    title: str = Field(max_length=300)
    digest: Digest
    text: str = Field(max_length=CONTEXT_CHAR_LIMIT)
    trust: str | None = Field(default=None, max_length=40)
    source_uri: str | None = Field(default=None, max_length=400)

    @property
    def planner_only(self) -> bool:
        """Earlier model agreement: a prior mission, or a memory record a mission wrote (model
        output, or an engine event such as a derived claim scope). The planner reads it; the two
        reviewers do not, so their support stays independent of that earlier verdict."""
        return self.kind == 'mission' or self.trust == 'model_output' or (self.source_uri or '').startswith('mission://')


class MissionRequest(Versioned):
    LATER_FIELDS = ('max_tokens', 'max_cost_usd', 'max_minutes', 'crew', 'context_items', 'gate', 'continues')
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
    # Spend budgets (contract C2); None is no budget. Enforced before each model step.
    max_tokens: int | None = Field(default=None, ge=1000, le=5_000_000)
    max_cost_usd: float | None = Field(default=None, ge=0.01, le=500)
    max_minutes: int | None = Field(default=None, ge=1, le=1440)
    # Per-role model and effort overrides for the live seats (contract C2); None is Settings as is.
    crew: dict[CrewRole, CrewSeat] | None = None
    context_items: tuple[ContextItem, ...] = Field(default=(), max_length=CONTEXT_MEMORY_LIMIT + CONTEXT_MISSION_LIMIT)
    # each_round pauses after every committed plan, a stopping one too, until the operator decides (C6).
    gate: Literal['auto', 'each_round'] = 'auto'
    # The finished mission this one continues (a fork); its supported scope is attached as context.
    continues: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,80}$')

    @model_validator(mode='after')
    def egress_consent(self):
        if self.mode == 'live' and not self.allow_egress:
            raise ValueError('Live models require explicit permission to send mission data')
        return self

    @model_validator(mode='after')
    def bounded_context(self):
        kinds = [item.kind for item in self.context_items]
        if kinds.count('memory') > CONTEXT_MEMORY_LIMIT or kinds.count('mission') > CONTEXT_MISSION_LIMIT:
            raise ValueError('Mission context exceeds its item limits')
        if sum(len(item.text) for item in self.context_items) > CONTEXT_CHAR_LIMIT:
            raise ValueError('Mission context exceeds its character limit')
        return self

class FalsifierTest(Record):
    """A branch's falsifier stated as a measurement before it runs: the hypothesis is
    refuted when the named tool reports `metric` on the `direction` side of `threshold`."""
    tool: str = Field(min_length=1, max_length=80)
    metric: str = Field(min_length=1, max_length=120)
    threshold: float
    direction: Literal['above', 'below']

class BranchIdea(Versioned):
    LATER_FIELDS = ('falsifier_test',)
    id: Id
    title: str = Field(min_length=1, max_length=180)
    hypothesis: str = Field(min_length=1, max_length=1000)
    falsifier: str = Field(min_length=1, max_length=700)
    parents: tuple[Id, ...] = Field(default=(), max_length=8)
    falsifier_test: FalsifierTest | None = None

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
    # Connector content (MCP servers, ACP agents) is an observation the roles may read
    # and never evidence: it cannot support a hypothesis or count toward its scope.
    claim_eligible: bool = True

    @model_validator(mode='before')
    @classmethod
    def legacy_connector_observations(cls, data):
        # Observations recorded before the field existed: connector tools carry the
        # reserved mcp_/acp_ prefixes, so they are read back as ineligible.
        if isinstance(data, dict) and 'claim_eligible' not in data and str(data.get('tool', '')).startswith(('mcp_', 'acp_')):
            data = {**data, 'claim_eligible': False}
        return data

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


class UnboundCall(Record):
    """A reserved model call that produced no accepted record: the engine rejected the
    answer, or the provider failed. The transport record is kept so its usage still counts."""
    role: str
    round: int = Field(ge=0)
    outcome: Literal['rejected', 'failed']
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


class VisionRecord(Versioned):
    LATER_FIELDS = ('transport',)
    candidate_digest: Digest
    reviewed_digests: tuple[Digest, ...] = Field(min_length=1, max_length=8)
    context_digest: Digest
    input_context: dict
    prompt_version: VisualPromptVersion = 'arc-visual-review-2'
    round: int = Field(ge=0)
    model: Identifier
    status: Literal['reserved', 'accepted', 'rejected']
    report_digest: Digest | None = None
    # Per-call transport provenance (usage above all) of an accepted review.
    transport: dict | None = None

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
    # None only for cycles persisted before the policy digest was recorded; they ran
    # under the same rules and are validated as such, but get no further automation.
    policy_digest: Digest | None = None
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


# Claim-strength adjustment (loop C): requested claim -> evidence-supported scope ->
# remaining uncertainty -> next discriminating test, derived from the reconciliation.
ClaimStatus = Literal['unassessed', 'provisionally_supported', 'contradicted', 'unresolved']
UncertaintyReason = Literal['challenged', 'uncertain', 'missing_independent_role', 'untested', 'shared_identity', 'unverified_identity']


class ClaimUncertainty(Record):
    reason: UncertaintyReason
    role: str | None = None
    detail: str = Field(min_length=1, max_length=900)
    evidence_ids: tuple[Id, ...] = Field(default=(), max_length=12)


class ProposedNextTest(Record):
    role: str
    round: int = Field(ge=0)
    test: str = Field(min_length=1, max_length=600)
    evidence_ids: tuple[Id, ...] = Field(default=(), max_length=12)


class ScopedBranch(Record):
    branch_id: Id
    requested: str = Field(min_length=1, max_length=1000)
    status: ClaimStatus
    supported_scope: tuple[str, ...] = Field(default=(), max_length=2)
    scope_qualifier: str = Field(default='', max_length=200)
    uncertainties: tuple[ClaimUncertainty, ...] = Field(default=(), max_length=5)
    next_tests: tuple[ProposedNextTest, ...] = Field(default=(), max_length=2)
    evidence_ids: tuple[Id, ...] = Field(default=(), max_length=64)

    @model_validator(mode='after')
    def never_upgraded(self):
        if self.status == 'provisionally_supported' and (len(self.supported_scope) != 2 or self.uncertainties):
            raise ValueError('Provisional support needs both roles and no open uncertainty')
        if self.status != 'provisionally_supported' and not self.uncertainties:
            raise ValueError('An unsupported claim must say what remains uncertain')
        if self.supported_scope and not self.scope_qualifier:
            raise ValueError('A supported scope carries its qualifier')
        return self


class ClaimScope(Record):
    derivation_version: Literal['arc-claim-scope-1', 'arc-claim-scope-2', 'arc-claim-scope-3'] = 'arc-claim-scope-3'
    basis_round: int = Field(ge=0)
    branches: tuple[ScopedBranch, ...] = Field(default=(), max_length=64)
    counts: dict[str, int]
    rule: str = Field(min_length=1, max_length=400)


# Change-effect declarations (loop D): what an operator declared, what the server
# derived, and the checks that obliges. Recorded on the mission it changed.
ChangeEffect = Literal['presentation', 'scientific_depiction', 'analysis', 'claim', 'permission']


class OperatorDecision(Record):
    """The operator's choice of which work to do next on one plan (contract C6): an execution
    decision, never a verdict on the evidence. A proposal target is the plan node 'plan-<round>'."""
    target: Literal['branch', 'proposal']
    target_id: Id
    directive: Literal['pursue', 'park', 'drop', 'request_test']
    note: str = Field(default='', max_length=400)
    round: int = Field(ge=0)
    plan_digest: Digest


# What each operator directive asks of the next planner, inside the operator-directive fence.
ASKS = {'pursue': 'Keep testing this.', 'park': 'Parked: its actions are withheld until the operator pursues it again.',
        'drop': 'Dropped: its actions are withheld.', 'request_test': 'Propose an action that tests this branch.'}
WITHHOLDS = ('park', 'drop')


def operator_directives(decisions):
    """What the planner reads of each decision (JSON dicts): the engine sends it, evidence checks it."""
    return [{**{k: d[k] for k in ('target', 'target_id', 'directive', 'note', 'round')}, 'ask': ASKS[d['directive']]}
            for d in decisions]


def asks_for_more(decisions, round_number):
    """Whether this round's decisions (JSON dicts, in order) refuse a stopping plan. The latest
    decision on a target stands. A proposal decision answers the plan itself: pursue accepts it,
    anything else asks again. Without one, a request_test on a branch, or a pursue on a branch
    parked or dropped in an earlier round, asks for work the plan does not propose."""
    now = [d for d in decisions if d['round'] == round_number]
    proposal = next((d['directive'] for d in reversed(now) if d['target'] == 'proposal'), None)
    if proposal:
        return proposal != 'pursue'
    before = {d['target_id']: d['directive'] for d in decisions if d['target'] == 'branch' and d['round'] < round_number}
    latest = {d['target_id']: d['directive'] for d in now if d['target'] == 'branch'}
    return any(v == 'request_test' or (v == 'pursue' and before.get(k) in WITHHOLDS) for k, v in latest.items())


def withholding(decisions, round_number, branch_id):
    """The decision (JSON dict with its change_id) that withholds an action of this round's plan
    on this branch, or None: a withholding proposal decision of the round covers its whole plan,
    otherwise the latest decision on the branch stands across rounds."""
    known = [d for d in decisions if d['round'] <= round_number]
    proposal = next((d for d in reversed(known) if d['target'] == 'proposal' and d['round'] == round_number), None)
    why = proposal if proposal and proposal['directive'] in WITHHOLDS else next(
        (d for d in reversed(known) if d['target'] == 'branch' and d['target_id'] == branch_id), None)
    return why if why and why['directive'] in WITHHOLDS else None


class Change(Versioned):
    LATER_FIELDS = ('decisions',)
    id: Id
    kind: Literal['resume', 'decision']
    declared_effects: tuple[ChangeEffect, ...] = Field(min_length=1, max_length=5)
    derived_effects: tuple[ChangeEffect, ...] = Field(min_length=1, max_length=5)
    required_checks: tuple[str, ...] = Field(min_length=1, max_length=12)
    base_digest: Digest
    note: str = Field(default='', max_length=400)
    round: int = Field(ge=0)
    at: int = Field(ge=0)
    # The operator decisions a 'decision' change records; none continues the plan as proposed.
    decisions: tuple[OperatorDecision, ...] = Field(default=(), max_length=24)

    @model_validator(mode='after')
    def declaration_covers_derivation(self):
        if any(effect not in self.declared_effects for effect in self.derived_effects):
            raise ValueError('A change declaration cannot be narrower than its derived effects')
        if self.decisions and self.kind != 'decision':
            raise ValueError('Only a decision change carries operator decisions')
        return self


# Release ledger (loop A of the 2026-09-19 program). A check is one named question
# about the mission with one of six states; unknown and error never count as
# satisfied, not_applicable must say why, and every check remembers the digest of
# what it looked at so a later change can mark it stale rather than silently reuse it.
CheckState = Literal['satisfied', 'failed', 'unknown', 'error', 'stale', 'not_applicable']
MissionCheck = Literal['operational_status', 'event_chain_integrity', 'replay_integrity',
                       'numerical_reproduction', 'artifact_reproduction', 'evidence_graph',
                       'reconciliation', 'visual_review', 'claim_scope', 'claim_rungs']

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


class MissionState(Versioned):
    LATER_FIELDS = ('stop_code', 'stop_facts', 'unbound_calls')
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
    # Calls whose answer was rejected or failed; their usage counts toward the spend.
    unbound_calls: tuple[UnboundCall, ...] = ()
    artifacts: tuple[Artifact, ...] = Field(default=(), max_length=64)
    visual_reports: tuple[VisualReport, ...] = Field(default=(), max_length=64)
    vision_records: tuple[VisionRecord, ...] = Field(default=(), max_length=64)
    repairs: tuple[RepairCycle, ...] = Field(default=(), max_length=64)
    # Derived at every stop from the reconciliation; cleared when the mission resumes.
    claim_scope: ClaimScope | None = None
    changes: tuple[Change, ...] = Field(default=(), max_length=64)
    events: tuple[Event, ...] = ()
    actions_used: int = 0
    model_calls_used: int = 0
    focus: str | None = None
    publication_eligible: Literal[False] = False
    stop_reason: str = ''
    # Why the mission stopped, as a registered error_codes.STOP_CODES key, and the variable
    # parts of stop_reason; empty for missions stored before codes existed.
    stop_code: str = ''
    stop_facts: dict[str, Any] = {}
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
