"""Change-effect declarations: declared vs derived effects, obliged checks, ledger
invalidation on resume, and molecular re-renders as new candidates of a base render."""
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import asyncio

from arc_science.exploration import changes, release
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.capsule import export_capsule, verify_capsule
from arc_science.exploration.engine import explore
from arc_science.exploration.evidence import validate_evidence
from arc_science.exploration.models import Change, MissionRequest, MissionState

TOKEN = 'c' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def app(tmp_path):
    from arc_science.service import create_app
    return create_app(data_dir=tmp_path, token=TOKEN)


def finished(c, mid):
    for _ in range(300):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(.01)
    raise AssertionError('mission did not finish')


def paused_verified_mission(c):
    mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Change effects', 'max_rounds': 1}).json()['id']
    c.post(f'/api/missions/{mid}/start', headers=AUTH)
    row = finished(c, mid)
    assert row['state']['status'] == 'budget_exhausted'
    assert c.post(f'/api/missions/{mid}/verify', headers=AUTH).json()['release']['status'] == 'eligible_for_human_review'
    repo = c.app.state.repository
    row = repo.get(mid)
    repo.save(mid, MissionState.model_validate({**row['state'], 'status': 'paused'}), expected_revision=row['revision'])
    return mid


def test_the_effect_table_names_the_checks_each_effect_obliges():
    assert changes.required_checks(('presentation',)) == ('geometry', 'readability')
    assert changes.required_checks(('analysis', 'claim')) == ('re_execution', 'dependent_claim_invalidation',
                                                             'evidence_review', 'scope_review')
    assert changes.required_checks(('scientific_depiction', 'presentation', 'scientific_depiction')) == (
        'structural_identity', 'visibility', 'interpretation', 'geometry', 'readability')
    assert changes.mission_change('resume', ['analysis', 'claim'])[0] == ('analysis', 'claim')
    with pytest.raises(changes.ChangeRefused, match='also affects claim'):
        changes.mission_change('resume', ['analysis'])
    with pytest.raises(changes.ChangeRefused, match='Unknown effect'):
        changes.mission_change('resume', ['analysis', 'claim', 'magic'])
    for kind in ('claim', 'permission', 'presentation', 'scientific_depiction', 'analysis'):
        with pytest.raises(changes.ChangeRefused, match=changes.MISSION_CHANGES[kind]['reason'][:30]):
            changes.mission_change(kind, [kind])
    with pytest.raises(ValidationError):
        Change(id='x', kind='resume', declared_effects=('analysis',), derived_effects=('analysis', 'claim'),
               required_checks=('re_execution',), base_digest='a' * 64, round=0, at=0)


def test_resuming_records_a_change_and_stales_every_release_check_until_verified_again(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = paused_verified_mission(c)
        reply = c.post(f'/api/missions/{mid}/changes', headers=AUTH,
                       json={'kind': 'resume', 'declared_effects': ['analysis', 'claim'], 'note': 'Add a round.'})
        assert reply.status_code == 202, reply.text
        change = reply.json()['change']
        assert change['derived_effects'] == ['analysis', 'claim'] and change['note'] == 'Add a round.'
        assert change['required_checks'] == ['re_execution', 'dependent_claim_invalidation', 'evidence_review', 'scope_review']
        row = finished(c, mid)
        assert row['state']['changes'][0]['id'] == change['id']
        assert any(e['kind'] == 'change_declared' and e['detail'].startswith(change['id']) for e in row['state']['events'])
        # Obligations are read from the ledger, never stored: stale now, satisfied after verification.
        before = c.get(f'/api/missions/{mid}', headers=AUTH).json()['change_obligations'][change['id']]
        assert {o['check']: o['state'] for o in before} == {'re_execution': 'stale', 'dependent_claim_invalidation': 'stale',
                                                            'evidence_review': 'stale', 'scope_review': 'stale'}
        # The old ledger was marked stale by the declared change; the mission has to be verified again.
        ledger = c.get(f'/api/missions/{mid}/release', headers=AUTH).json()
        states = {check['name']: check['state'] for check in ledger['checks']}
        assert ledger['status'] == 'blocked'
        # Replay checks are stale through the receipt; checks whose basis came back unchanged
        # (the round limit stopped the mission in the same status) carry the declared change.
        assert states['replay_integrity'] == states['numerical_reproduction'] == states['evidence_graph'] == 'stale'
        for name in ('operational_status', 'reconciliation', 'claim_scope'):
            check = next(c for c in ledger['checks'] if c['name'] == name)
            assert check['state'] == 'stale' and 'Declared change ' + change['id'][:8] in check['reason']
        assert states['event_chain_integrity'] == 'satisfied'  # recomputed live against the repository chain
        assert c.get(f'/api/missions/{mid}/capsule', headers=AUTH).status_code == 409
        verified = c.post(f'/api/missions/{mid}/verify', headers=AUTH).json()
        assert verified['release']['status'] == 'eligible_for_human_review'
        after = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        assert after['state']['claim_scope'] is not None
        assert all(o['state'] == 'satisfied' for o in after['change_obligations'][change['id']])


def test_a_resume_without_its_declaration_fails_the_evidence_graph_and_the_capsule():
    request = MissionRequest(goal='Explore the fixture', max_rounds=1)
    stopped = asyncio.run(explore(request, DemoAgent()))
    assert stopped.status == 'budget_exhausted'
    undeclared = asyncio.run(explore(request, DemoAgent(), initial=stopped.model_copy(update={'status': 'paused'})))
    assert len(undeclared.events) > len(stopped.events)
    with pytest.raises(ValueError, match='without a declared change'):
        validate_evidence(undeclared)
    # The same resume, declared: the change binds to its event and the history before it.
    declared_state, change = changes.declare_resume(stopped.model_copy(update={'status': 'paused'}), ['analysis', 'claim'], 'Second round.')
    resumed = asyncio.run(explore(request, DemoAgent(), initial=declared_state))
    validate_evidence(resumed)
    request2 = request
    assert verify_capsule(export_capsule(request2, resumed))['evidence_graph_valid'] is True
    for forged in (resumed.model_copy(update={'changes': ()}),
                   resumed.model_copy(update={'changes': (change.model_copy(update={'base_digest': 'f' * 64}),)}),
                   resumed.model_copy(update={'changes': (change.model_copy(update={'required_checks': ('re_execution',)}),)}),
                   resumed.model_copy(update={'changes': (change, change.model_copy(update={'id': 'x' * 32}))})):
        with pytest.raises(ValueError):
            validate_evidence(forged)
        with pytest.raises(ValueError):  # the capsule verifier refuses a forged history outright
            verify_capsule(export_capsule(request2, forged))


def test_start_on_a_paused_mission_is_the_same_declared_change(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = paused_verified_mission(c)
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        row = finished(c, mid)
        change, = row['state']['changes']
        assert change['kind'] == 'resume' and change['declared_effects'] == ['analysis', 'claim']
        assert change['note'] == 'Resumed from the workspace.'


def test_declarations_that_cannot_apply_are_refused_with_the_table_reason(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = paused_verified_mission(c)
        for kind in ('claim', 'permission', 'presentation'):
            reply = c.post(f'/api/missions/{mid}/changes', headers=AUTH, json={'kind': kind, 'declared_effects': [kind]})
            assert reply.status_code == 409 and reply.json()['detail'] == changes.MISSION_CHANGES[kind]['reason']
        narrow = c.post(f'/api/missions/{mid}/changes', headers=AUTH, json={'kind': 'resume', 'declared_effects': ['analysis']})
        assert narrow.status_code == 409 and 'also affects claim' in narrow.json()['detail']
        assert c.get(f'/api/missions/{mid}', headers=AUTH).json()['state']['changes'] == []
        table = c.get('/api/changes', headers=AUTH).json()
        assert table['resume']['applies'] is True and table['claim']['applies'] is False
        # A finished mission is not resumable through a declaration either.
        done = c.post('/api/missions', headers=AUTH, json={'goal': 'Finished', 'max_rounds': 1}).json()['id']
        c.post(f'/api/missions/{done}/start', headers=AUTH)
        finished(c, done)
        assert c.post(f'/api/missions/{done}/changes', headers=AUTH,
                      json={'kind': 'resume', 'declared_effects': ['analysis', 'claim']}).status_code == 409
