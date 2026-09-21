"""Reject capsules with unsupported or falsely promoted runtime contracts."""
import asyncio
import hashlib
from io import BytesIO
import json
from zipfile import ZipFile

import pytest

from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.capsule import (CAPSULE_FORMAT, CAPSULE_FORMAT_3, INFORMATIONAL_MEMBERS,
                                              export_capsule, verify_capsule)
from arc_science.exploration.claims import build_claims
from arc_science.exploration.engine import explore
from arc_science.exploration.evidence import evidence_graph
from arc_science.exploration.models import MissionRequest
from arc_science.exploration.release import current_decision

V2_MEMBERS = ['manifest.json', 'request.json', 'runtime.json', 'state.json']
V3_MEMBERS = ['claims.json', 'evidence_graph.json', 'grants.json', 'manifest.json', 'release.json',
              'request.json', 'runtime.json', 'state.json', 'timeline.json']
GRANTS = {'grants': [], 'receipts': [], 'receipts_truncated': False}
TIMELINE = [{'id': 'op-1', 'sequence': 1, 'started_at': 1.0, 'finished_at': 2.0, 'outcome': 'ok',
             'outcome_source': 'recorded', 'detail': 'fake row'}]


@pytest.fixture(scope='module')
def mission():
    request = MissionRequest(goal='Check the release contract')
    return request, asyncio.run(explore(request, DemoAgent()))


@pytest.fixture(scope='module')
def valid_capsule(mission):
    return export_capsule(*mission)


@pytest.fixture(scope='module')
def v3_capsule(mission):
    request, state = mission
    release = current_decision(request, state, event_chain_ok=True).model_dump(mode='json')
    claims = build_claims(state, [], evidence_graph(state), release)
    return export_capsule(request, state, release=release, claims=claims, timeline=TIMELINE, grants=GRANTS)


def members_of(blob):
    with ZipFile(BytesIO(blob)) as archive:
        return sorted(archive.namelist())


def rewrite_member(blob, name, data, rehash_manifest=False):
    with ZipFile(BytesIO(blob)) as archive:
        entries = {member: archive.read(member) for member in archive.namelist()}
    entries[name] = data
    if rehash_manifest:
        entries['manifest.json'] = json.dumps({
            member: hashlib.sha256(payload).hexdigest()
            for member, payload in entries.items() if member != 'manifest.json'
        }).encode()
    output = BytesIO()
    with ZipFile(output, 'w') as archive:
        for member, payload in entries.items():
            archive.writestr(member, payload)
    return output.getvalue()


def rewrite_runtime(blob, change):
    with ZipFile(BytesIO(blob)) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    runtime = json.loads(entries['runtime.json'])
    runtime = change(runtime)
    entries['runtime.json'] = json.dumps(runtime, sort_keys=True).encode()
    entries['manifest.json'] = json.dumps({
        name: hashlib.sha256(data).hexdigest()
        for name, data in entries.items() if name != 'manifest.json'
    }).encode()
    output = BytesIO()
    with ZipFile(output, 'w') as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return output.getvalue()


@pytest.mark.parametrize('field,value', [
    ('format', 'unrecognized-capsule/99'),
    ('format', 'arc-research-capsule/1'),
    ('arc_version', '0.2.0'),
    ('numeric_version', 'arc-numeric-1'),
    ('scientific_validation', 'established'),
    ('model_replay', 'live_models_reexecuted'),
])
def test_capsule_rejects_incompatible_runtime_claims(valid_capsule, field, value):
    forged = rewrite_runtime(valid_capsule, lambda runtime: {**runtime, field: value})
    with pytest.raises(ValueError):
        verify_capsule(forged)


def test_capsule_rejects_nonobject_runtime_metadata(valid_capsule):
    with pytest.raises(ValueError):
        verify_capsule(rewrite_runtime(valid_capsule, lambda _: []))


def test_v2_export_keeps_four_members_and_verifies_as_format_2(valid_capsule):
    assert members_of(valid_capsule) == V2_MEMBERS
    report = verify_capsule(valid_capsule)
    assert report['format'] == CAPSULE_FORMAT == 'arc-research-capsule/2'
    assert report['members'] == V2_MEMBERS
    assert report['informational'] == [] and report['manifest_failures'] == [] and report['integrity'] is True
    assert 'never evidence' not in report['limitations']


def test_v3_export_adds_release_graph_and_informational_members(v3_capsule):
    assert members_of(v3_capsule) == V3_MEMBERS
    with ZipFile(BytesIO(v3_capsule)) as archive:
        assert json.loads(archive.read('runtime.json'))['format'] == CAPSULE_FORMAT_3 == 'arc-research-capsule/3'
        assert json.loads(archive.read('timeline.json')) == TIMELINE
        assert json.loads(archive.read('grants.json')) == GRANTS
        assert json.loads(archive.read('release.json'))['status'] in ('blocked', 'eligible_for_human_review')
        assert json.loads(archive.read('claims.json'))['source'] == 'derived'
    report = verify_capsule(v3_capsule)
    assert report['format'] == CAPSULE_FORMAT_3 and report['members'] == V3_MEMBERS
    assert report['integrity'] is True and report['manifest_failures'] == []
    assert report['informational'] == list(INFORMATIONAL_MEMBERS) == ['claims.json', 'grants.json', 'timeline.json']
    assert report['reproduction_passed'] is True and report['reproduced'] == 3
    assert report['limitations'].endswith('are checked by digest only and are never evidence.')


@pytest.mark.parametrize('name', ['timeline.json', 'grants.json', 'claims.json'])
def test_tampered_informational_member_breaks_integrity_but_not_replay(v3_capsule, name):
    report = verify_capsule(rewrite_member(v3_capsule, name, b'[]'))
    assert report['integrity'] is False
    assert report['manifest_failures'] == [name + ': checksum mismatch']
    assert report['reproduction_passed'] is True and report['reproduced'] == 3


def test_tampered_core_member_in_v3_archive_is_rejected(v3_capsule):
    with ZipFile(BytesIO(v3_capsule)) as archive:
        state = archive.read('state.json')
    with pytest.raises(ValueError, match='Artifact checksum mismatch'):
        verify_capsule(rewrite_member(v3_capsule, 'state.json', state.replace(b'quadratic', b'quxdratic', 1)))


def test_runtime_format_must_match_the_member_set(valid_capsule, v3_capsule):
    with pytest.raises(ValueError, match='Unsupported capsule runtime contract'):
        verify_capsule(rewrite_runtime(v3_capsule, lambda runtime: {**runtime, 'format': CAPSULE_FORMAT}))
    with pytest.raises(ValueError, match='Unsupported capsule runtime contract'):
        verify_capsule(rewrite_runtime(valid_capsule, lambda runtime: {**runtime, 'format': CAPSULE_FORMAT_3}))


def test_rehashed_evidence_graph_is_compared_with_the_derived_graph(v3_capsule):
    report = verify_capsule(rewrite_member(v3_capsule, 'evidence_graph.json', b'{}', rehash_manifest=True))
    assert report['manifest_failures'] == ['evidence_graph.json: differs from the graph derived from state.json']
    assert report['integrity'] is False and report['reproduction_passed'] is True


def test_v3_export_needs_every_extra_member(mission):
    request, state = mission
    with pytest.raises(ValueError, match='Capsule v3 needs release, claims, timeline and grants'):
        export_capsule(request, state, release={})
