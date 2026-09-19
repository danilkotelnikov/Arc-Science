"""Change-effect declarations (loop D of the 2026-09-19 program).

Every operator change declares what it affects, the server derives what it actually
affects from the two states, and a declaration narrower than the derived effects is
refused. Each effect names the checks it obliges (the design review's table):

    presentation           geometry and readability
    scientific_depiction   structural identity, visibility and interpretation
    analysis               re-execution and invalidation of dependent claims
    claim                  evidence and scope review
    permission             separate authorization

Two changes exist today. Resuming a stopped mission is an analysis change (new
evidence may arrive, the claim scope is derived again) and marks every release check
stale until the mission is verified again. Re-rendering a molecular structure is a
change of the earlier render only when the coordinates are the same; the earlier
render is never touched, the new one is a new candidate that records its base, the
declared and the derived effects and the checks they oblige. Claims are derived, so
they cannot be edited; permission is granted at mission creation, never by an edit.
"""
from __future__ import annotations

import time
from typing import Literal
import uuid

from ..contracts import digest

Effect = Literal['presentation', 'scientific_depiction', 'analysis', 'claim', 'permission']
EFFECTS: tuple[str, ...] = ('presentation', 'scientific_depiction', 'analysis', 'claim', 'permission')
REQUIRED_CHECKS = {
    'presentation': ('geometry', 'readability'),
    'scientific_depiction': ('structural_identity', 'visibility', 'interpretation'),
    'analysis': ('re_execution', 'dependent_claim_invalidation'),
    'claim': ('evidence_review', 'scope_review'),
    'permission': ('separate_authorization',),
}

# Mission changes an operator can declare, and what happens to each.
MISSION_CHANGES = {
    'resume': {'applies': True, 'derived': ('analysis', 'claim'),
               'reason': 'Resuming may add evidence and derives the claim scope again; every release check is stale until the mission is verified again.'},
    'presentation': {'applies': False, 'derived': ('presentation',),
                     'reason': 'Presentation changes to mission figures run only as recorded repair cycles after a visual review; there is no operator edit.'},
    'scientific_depiction': {'applies': False, 'derived': ('scientific_depiction',),
                             'reason': 'Mission plots draw the frozen dataset and the recorded fit; they have no depiction parameters to change.'},
    'analysis': {'applies': False, 'derived': ('analysis',),
                 'reason': 'Analyses are chosen by the planner and executed by trusted tools; to change one, resume the mission so the new evidence is recorded.'},
    'claim': {'applies': False, 'derived': ('claim',),
              'reason': 'Claims are derived from the recorded reconciliation and cannot be edited; add evidence by resuming and the scope is derived again.'},
    'permission': {'applies': False, 'derived': ('permission',),
                   'reason': 'Egress and connector permissions are granted when a mission is created; a permission change is a separate authorization, not an edit.'},
}
# Disabling a memory record excludes it from retrieval and changes no mission evidence:
# a declared change with no effect and nothing to check. It is answered, not stored on
# a mission, because memory records are not mission evidence.
MEMORY_DISABLE = {'kind': 'memory_disable', 'derived': (),
                  'reason': 'Disabling a memory record excludes it from retrieval; it is not deleted and no mission evidence changes.'}
# What closes each obligation of a resume: the release ledger checks it maps to. The
# obligation's state is the worst state of those checks, so it is derived on read and
# never stored or authored.
OBLIGATION_SOURCES = {
    # Re-execution is evidenced by the replay recomputing every analysis, not by the
    # mission merely having stopped again.
    're_execution': ('operational_status', 'replay_integrity', 'numerical_reproduction'),
    'dependent_claim_invalidation': ('claim_scope',),
    'evidence_review': ('evidence_graph', 'reconciliation'),
    'scope_review': ('claim_scope',),
}
WORST = ('error', 'failed', 'stale', 'unknown', 'not_applicable', 'satisfied')
# Obligations of a molecular change have no automated checker in this release; they
# are recorded as unknown so nothing reads them as done.
NO_CHECKER = 'No automated checker exists for this obligation; a human must inspect the render.'
# A resumed mission's release ledger: every check that can be stale is stale.
RESUME_STALE = ('operational_status', 'event_chain_integrity', 'replay_integrity', 'numerical_reproduction',
                'artifact_reproduction', 'evidence_graph', 'reconciliation', 'visual_review', 'claim_scope')

# Molecular render settings by the effect a change of them has. Coordinates are not a
# setting: different coordinates are a new subject, not a change.
MOLECULAR_FIELDS = {
    'presentation': ('width', 'samples', 'seed'),
    'scientific_depiction': ('antibody_chains', 'antigen_chains', 'assembly', 'model_index'),
    'analysis': ('cutoff',),
}


class ChangeRefused(ValueError):
    pass


def required_checks(effects) -> tuple[str, ...]:
    seen = []
    for effect in effects:
        for check in REQUIRED_CHECKS[effect]:
            if check not in seen:
                seen.append(check)
    return tuple(seen)


def check_declaration(declared, derived) -> None:
    """A declaration may be wider than the derived effects, never narrower."""
    unknown = [e for e in declared if e not in EFFECTS]
    if unknown:
        raise ChangeRefused('Unknown effect: ' + ', '.join(unknown)[:100])
    missing = [e for e in derived if e not in declared]
    if missing:
        raise ChangeRefused('The change also affects ' + ', '.join(missing) + '; declare that or narrow the change.')


def molecular_effects(base_settings: dict, new_settings: dict) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(derived effects, changed fields) between two renders of the same coordinates."""
    changed = tuple(field for fields in MOLECULAR_FIELDS.values() for field in fields
                    if base_settings.get(field) != new_settings.get(field))
    derived = tuple(effect for effect, fields in MOLECULAR_FIELDS.items() if any(f in changed for f in fields))
    return derived, changed


def declare_resume(state, declared, note: str, at: int | None = None):
    """Record a resume on the state: the change, and the event that binds it to this
    point of the history (base_digest is the digest of every event before it)."""
    from .models import Change, Event
    derived, checks = mission_change('resume', declared)
    base = digest([e.model_dump(mode='json') for e in state.events])
    change = Change(id=uuid.uuid4().hex, kind='resume', declared_effects=tuple(declared), derived_effects=derived,
                    required_checks=checks, base_digest=base, note=note[:400], round=state.round,
                    at=int(time.time()) if at is None else at)
    event = Event(kind='change_declared', round=state.round,
                  detail=change.id + ': resume; declared ' + ', '.join(declared) + '; derived ' + ', '.join(derived))
    return state.model_copy(update={'changes': state.changes + (change,), 'events': state.events + (event,)}), change


def obligation_states(change, decision) -> tuple[dict, ...]:
    """The state of each obligation a change carries, read from the release ledger."""
    states = {check.name: check.state for check in decision.checks} if decision is not None else {}
    out = []
    for obligation in change.required_checks:
        sources = OBLIGATION_SOURCES.get(obligation, ())
        found = [states.get(source, 'unknown') for source in sources] or ['unknown']
        out.append({'check': obligation, 'state': min(found, key=WORST.index), 'sources': list(sources)})
    return tuple(out)


def unknown_obligations(effects) -> list[dict]:
    return [{'name': check, 'state': 'unknown', 'reason': NO_CHECKER} for check in required_checks(effects)]


def mission_change(kind: str, declared) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(derived effects, required checks) for an applicable mission change, or a refusal."""
    entry = MISSION_CHANGES.get(kind)
    if entry is None:
        raise ChangeRefused('Unknown change kind: ' + kind[:40])
    if not entry['applies']:
        raise ChangeRefused(entry['reason'])
    check_declaration(declared, entry['derived'])
    return entry['derived'], required_checks(entry['derived'])
