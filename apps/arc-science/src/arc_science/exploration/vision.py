"""Runtime-owned visual context and digest coverage rules."""
from __future__ import annotations

from ..contracts import digest
from .models import Artifact, VisualReport, VisionRecord

VISUAL_PROMPT_VERSION = 'arc-visual-review-1'
MAX_IMAGES_PER_REVIEW = 8


def visual_context(context: dict, artifacts: tuple[Artifact, ...]) -> dict:
    if not artifacts or len(artifacts) > MAX_IMAGES_PER_REVIEW:
        raise ValueError('Visual reviews require between one and eight images')
    manifests = [artifact.manifest() for artifact in artifacts]
    candidate = digest({'context': context, 'artifacts': manifests,
                        'prompt_version': VISUAL_PROMPT_VERSION})
    return {'mission': context, 'round': context['round'], 'artifact_manifests': manifests,
            'candidate_digest': candidate,
            'rule': 'Images are exploratory plots. Report visual adequacy only; do not infer scientific truth.'}


def validate_report(report: VisualReport, context: dict, artifacts: tuple[Artifact, ...], model: str) -> None:
    expected = tuple(artifact.digest for artifact in artifacts)
    if report.candidate_digest != context['candidate_digest']:
        raise ValueError('Visual report candidate digest mismatch')
    if report.reviewed_digests != expected:
        raise ValueError('Visual report does not cover the exact supplied image batch')
    if report.round != context['round'] or report.model != model:
        raise ValueError('Visual report model or round binding mismatch')
    if report.input_context != context:
        raise ValueError('Visual report context binding mismatch')


def required_visual_reason(artifacts: tuple[Artifact, ...], reports: tuple[VisualReport, ...],
                           records: tuple[VisionRecord, ...]) -> str | None:
    """Return why required visual review is incomplete, or None when fully adequate."""
    if not artifacts:
        return 'Required visual review has no generated fit artifacts to inspect.'
    covered = set()
    for report in reports:
        if any(finding.severity == 'blocking' for finding in report.findings):
            return 'Required visual review contains blocking findings; human input is required.'
        if report.verdict != 'adequate':
            return 'Required visual review reported issues or uncertainty; human input is required.'
        covered.update(report.reviewed_digests)
    if covered != {artifact.digest for artifact in artifacts}:
        return 'Required visual review is missing exact coverage for one or more generated artifacts.'
    if any(record.status != 'accepted' for record in records):
        return 'Required visual review did not return an accepted artifact-bound report.'
    return None
