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

from typing import Literal

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


def mission_change(kind: str, declared) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(derived effects, required checks) for an applicable mission change, or a refusal."""
    entry = MISSION_CHANGES.get(kind)
    if entry is None:
        raise ChangeRefused('Unknown change kind: ' + kind[:40])
    if not entry['applies']:
        raise ChangeRefused(entry['reason'])
    check_declaration(declared, entry['derived'])
    return entry['derived'], required_checks(entry['derived'])
