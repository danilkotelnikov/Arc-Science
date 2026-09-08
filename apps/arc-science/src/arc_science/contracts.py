"""Closed, immutable wire contracts. Registry entries come from the operator, not models."""
from __future__ import annotations
import hashlib
import json
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Digest = Annotated[str, Field(pattern=r'^[a-f0-9]{64}$')]
Identifier = Annotated[str, Field(min_length=1, max_length=160, pattern=r'^[A-Za-z0-9_.:/-]+$')]

def canonical(value: object) -> bytes:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode='json')
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                      allow_nan=False).encode('utf-8')

def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()

class Record(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False, validate_default=True)

class ArtifactRef(Record):
    name: Annotated[str, Field(min_length=1, max_length=180)]
    digest: Digest
    size: Annotated[int, Field(ge=0)]
    media_type: Annotated[str, Field(min_length=1, max_length=100)]
    role: Literal['render', 'source', 'metadata']

    @field_validator('name')
    @classmethod
    def safe_name(cls, value: str) -> str:
        if '/' in value or '\\' in value or value in {'.','..'} or any(ord(x)<32 for x in value):
            raise ValueError('Artifact name must be a basename')
        return value

class Candidate(Record):
    project_id: Identifier
    producer_id: Identifier
    policy_digest: Digest
    artifacts: Annotated[tuple[ArtifactRef, ...], Field(min_length=1, max_length=256)]
    evidence_digests: tuple[Digest, ...] = ()

    @model_validator(mode='after')
    def unique_names(self):
        if len({a.name for a in self.artifacts}) != len(self.artifacts):
            raise ValueError('Duplicate artifact names')
        return self

    @property
    def digest(self) -> str:
        return digest(self)

    @property
    def render_digests(self) -> frozenset[str]:
        return frozenset(a.digest for a in self.artifacts if a.role=='render')

class Seat(Record):
    seat_id: Identifier
    provider: Literal['openai', 'anthropic', 'openclaw']
    model: Identifier
    group: Identifier
    credential_ref: Identifier
    qualification_digest: Digest
    qualification_expires_at: Annotated[int, Field(gt=0)]
    vision: bool
    agent_id: Identifier | None = None

class Check(Record):
    criterion: Literal['numerical','geometry','provenance','visual_clarity','caption_alignment']
    status: Literal['pass','fail','unknown']
    evidence_digests: tuple[Digest, ...] = ()

class Finding(Record):
    severity: Literal['blocking','major','minor']
    target: Identifier
    category: Annotated[str, Field(min_length=1, max_length=64)]
    detail: Annotated[str, Field(min_length=1, max_length=700)]
    box: tuple[float,float,float,float] | None = None

    @field_validator('box')
    @classmethod
    def valid_box(cls, value):
        if value is not None:
            x,y,w,h=value
            if min(x,y)<0 or min(w,h)<=0 or x+w>1 or y+h>1:
                raise ValueError('Box must lie within normalized image bounds')
        return value

class Review(Record):
    candidate_digest: Digest
    policy_digest: Digest
    seat_id: Identifier
    observed_model: Identifier
    reviewed_digests: tuple[Digest, ...]
    checks: Annotated[tuple[Check, ...], Field(max_length=12)]
    findings: Annotated[tuple[Finding, ...], Field(max_length=32)] = ()

class Decision(Record):
    eligible: bool
    status: Literal['eligible_for_human_review','blocked']
    reasons: tuple[str, ...]

class CaptionClaim(Record):
    id: Identifier
    statement: str = Field(min_length=1, max_length=2000)
    status: Literal['supported', 'hypothesis', 'simulation']
    evidence_digests: tuple[Digest, ...] = ()

class PanelExpectation(Record):
    view_digest: Digest
    caption: str = Field(min_length=1, max_length=4000)
    claim_ids: tuple[Identifier, ...] = ()

class VisualBrief(Record):
    """Runtime-approved display expectations, not evidence of scientific truth."""
    version: Literal[1] = 1
    panels: tuple[PanelExpectation, ...] = Field(min_length=1, max_length=256)
    claims: tuple[CaptionClaim, ...] = Field(default=(), max_length=128)

    @model_validator(mode='after')
    def bound_claims(self):
        ids = {claim.id for claim in self.claims}
        if len(ids) != len(self.claims):
            raise ValueError('Duplicate caption claim IDs')
        if any(not set(panel.claim_ids) <= ids for panel in self.panels):
            raise ValueError('Unknown caption claim reference')
        if any(claim.status == 'supported' and not claim.evidence_digests for claim in self.claims):
            raise ValueError('Supported display claims require source references')
        return self
