"""Diagnostics: on-demand local reads with a named source per section, and a redacted
report that carries neither the operator token, nor the native session secret, nor the
user home path."""
import hashlib
import json
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient

from arc_science import __version__, diagnostics
from arc_science.readiness import STATES
from arc_science.render_presets import DEFAULT_PRESET

TOKEN = 'd' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
SECTIONS = ('storage', 'jobs', 'renderer', 'package', 'probes')
NATIVE = 'native-session-secret-B-0123456789abcdef0123456789abcdef'


def make_app(tmp_path):
    from arc_science.service import create_app
    return create_app(data_dir=tmp_path, token=TOKEN)


def write_failed_job(root, *, with_input=True, settings=True):
    job_id = hashlib.sha256(str(with_input).encode() + str(settings).encode()).hexdigest()[:32]
    directory = root / 'molecular' / job_id
    (directory / 'input').mkdir(parents=True)
    data = b'data_complex\n'
    if with_input:
        (directory / 'input' / 'complex.cif').write_bytes(data)
    record = {'id': job_id, 'status': 'failed', 'filename': 'complex.cif', 'created_at': 1.0, 'updated_at': 2.0,
              'source_sha256': hashlib.sha256(data).hexdigest(), 'error': 'Injected failure',
              'settings': {'antibody_chains': ['H'], 'antigen_chains': ['A'], 'assembly': 'asymmetric_unit', 'model_index': 0,
                           'cutoff': 4.0, 'width': 1400, 'samples': 96, 'seed': 23, 'preset': DEFAULT_PRESET} if settings else None}
    (directory / 'job.json').write_text(json.dumps(record), encoding='utf-8')
    return job_id


def test_diagnostics_requires_a_session_and_reads_a_fresh_directory(tmp_path, monkeypatch):
    monkeypatch.delenv('ARC_MOLECULAR_BLENDER_PYTHON', raising=False)
    monkeypatch.delenv('ARC_SUPERVISOR', raising=False)
    with TestClient(make_app(tmp_path)) as client:
        assert client.get('/api/diagnostics').status_code == 401
        assert client.get('/api/diagnostics/report').status_code == 401
        assert client.post('/api/missions', headers=AUTH, json={'goal': 'Diagnostics fixture'}).status_code == 201
        reading = client.get('/api/diagnostics', headers=AUTH)
        assert reading.status_code == 200, reading.text
        doc = reading.json()
        assert isinstance(doc['checked_at'], int) and 'no model call' in doc['note']
        for name in SECTIONS:
            section = doc[name]
            assert section['source'] and isinstance(section['checked_at'], int)
            assert section['state'] in STATES and section['code'].startswith(name + '.')
            assert isinstance(section['meaning'], str) and ('next_action' in section)
        storage = doc['storage']
        assert storage['sqlite'] == {'missions.db': 'ok', 'grants.db': 'ok', 'timeline.db': 'ok'}
        assert (storage['state'], storage['code']) == ('ready', 'storage.verified')
        assert storage['missions'] == {'total': 1, 'checked': 1, 'verified': 1, 'broken': [], 'limit': 200}
        assert storage['meaning'].startswith('1 of 1 missions verified · sqlite ok')
        assert storage['memory_capture']['status'] in ('unconfigured', 'degraded', 'ready')
        assert (doc['jobs']['state'], doc['jobs']['code'], doc['jobs']['total'], doc['jobs']['failed']) == ('not_tested', 'jobs.none', 0, [])
        renderer = doc['renderer']
        assert (renderer['state'], renderer['code']) == ('blocked', 'renderer.not_configured')
        assert renderer['blender_python'] == {'configured': False, 'exists': None, 'executable': None}
        assert renderer['runtime_probe'] == {'checked': False, 'ok': None, 'reason': None} and renderer['last_render'] is None
        package = doc['package']
        assert (package['state'], package['code'], package['version']) == ('not_tested', 'package.facts', __version__)
        assert package['supervisor'] == {'configured': False, 'path': None, 'source': 'ARC_SUPERVISOR'}
        assert package['data_dir'] == str(tmp_path.resolve()) and isinstance(package['started_at'], int)
        assert package['python']['version'] and package['python']['executable']
        assert (doc['probes']['state'], doc['probes']['code'], doc['probes']['records']) == ('not_tested', 'probes.none', [])


def test_a_broken_event_chain_is_named_and_blocks_nothing_else(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        good = client.post('/api/missions', headers=AUTH, json={'goal': 'Intact'}).json()['id']
        bad = client.post('/api/missions', headers=AUTH, json={'goal': 'Tampered'}).json()['id']
        with sqlite3.connect(tmp_path / 'missions.db') as db:
            db.execute('UPDATE mission_events SET hash=? WHERE mission=?', ('0' * 64, bad))
        storage = client.get('/api/diagnostics', headers=AUTH).json()['storage']
        assert (storage['state'], storage['code']) == ('failed', 'storage.chain_broken')
        assert storage['missions']['broken'] == [bad] and storage['missions']['verified'] == 1 and storage['missions']['checked'] == 2
        assert 'Do not export' in storage['next_action'] and storage['sqlite']['missions.db'] == 'ok'
        assert good not in storage['missions']['broken']


def test_a_mission_that_cannot_be_verified_is_named_and_the_others_are_still_checked(tmp_path):
    # A row removed between the listing and its verification (or one that cannot be read)
    # counts as unverified and is named; the missions after it are still verified.
    with TestClient(make_app(tmp_path)) as client:
        later = client.post('/api/missions', headers=AUTH, json={'goal': 'Later'}).json()['id']
        earlier = client.post('/api/missions', headers=AUTH, json={'goal': 'Earlier'}).json()['id']
        repository = client.app.state.repository
        verify = repository.verify
        repository.verify = lambda mid: (_ for _ in ()).throw(KeyError('Unknown mission')) if mid == earlier else verify(mid)
        try:
            storage = client.get('/api/diagnostics', headers=AUTH).json()['storage']
        finally:
            repository.verify = verify
        assert (storage['state'], storage['code']) == ('failed', 'storage.chain_broken')
        assert storage['missions']['broken'] == [earlier] and storage['missions']['verified'] == 1 and storage['missions']['checked'] == 2
        assert later not in storage['missions']['broken']


def test_failed_renders_are_listed_with_their_retry_facts(tmp_path, monkeypatch):
    monkeypatch.delenv('ARC_MOLECULAR_BLENDER_PYTHON', raising=False)
    retryable = write_failed_job(tmp_path, with_input=True)
    orphaned = write_failed_job(tmp_path, with_input=False)
    with TestClient(make_app(tmp_path)) as client:
        jobs = client.get('/api/diagnostics', headers=AUTH).json()['jobs']
        assert (jobs['state'], jobs['code'], jobs['total']) == ('failed', 'jobs.failed', 2)
        assert jobs['meaning'] == '2 of 2 molecular renders failed or was interrupted'
        rows = {row['id']: row for row in jobs['failed']}
        assert rows[retryable]['retryable'] is True and rows[retryable]['retry_note'] is None
        assert rows[retryable]['status'] == 'failed' and rows[retryable]['error'] == 'Injected failure'
        assert rows[orphaned]['retryable'] is False and rows[orphaned]['retry_note'] == 'The uploaded coordinates are no longer available'
        renderer = client.get('/api/diagnostics', headers=AUTH).json()['renderer']
        assert renderer['last_render']['id'] in rows and renderer['last_render']['status'] == 'failed'
        # Without a renderer the resubmission is refused by the service, not by the reading.
        refused = client.post(f'/api/molecular/renders/{retryable}/retry', headers=AUTH)
        assert refused.status_code == 409 and 'unavailable' in refused.json()['detail']
        gone = client.post(f'/api/molecular/renders/{orphaned}/retry', headers=AUTH)
        assert gone.status_code == 404 and 'no longer available' in gone.json()['detail']


def test_sqlite_integrity_names_missing_and_unreadable_stores(tmp_path):
    assert diagnostics.sqlite_integrity(tmp_path / 'absent.db') == 'missing'
    (tmp_path / 'garbage.db').write_bytes(b'not a database at all' * 100)
    assert diagnostics.sqlite_integrity(tmp_path / 'garbage.db').startswith('unreadable: ')
    with sqlite3.connect(tmp_path / 'fine.db') as db:
        db.execute('CREATE TABLE t(x)')
    assert diagnostics.sqlite_integrity(tmp_path / 'fine.db') == 'ok'


def test_redact_report_rewrites_every_string_and_keeps_keys():
    secret = 'S' * 44
    home = Path.home()
    value = {'note': 'header Bearer sk-abc123456789', 'header': 'Authorization: Bearer sk-abc123456789', 'pair': 'token=xyz', 'secret': 'seat ' + secret,
             'nested': [{'path': str(home / 'x')}, ('upper', str(home).upper() + '/y'), str(home).replace('\\', '/') + '/z'],
             'prefixed': '\\\\?\\' + str(home) + '\\w', 'number': 3, 'keep': None, 'Bearer sk-key': 'value'}
    out = diagnostics.redact_report(value, secrets=(secret, '', None))
    text = json.dumps(out)
    assert 'sk-abc123456789' not in text and 'xyz' not in text and secret not in text
    # The secret-pair rule runs first, so a named header loses its whole value; a bare bearer keeps the word.
    assert out['note'] == 'header Bearer [redacted]' and out['header'] == 'Authorization: [redacted]'
    assert out['pair'] == 'token=[redacted]' and out['secret'] == 'seat [redacted]'
    assert out['nested'][0]['path'] == '~' + str(home / 'x')[len(str(home)):] and out['nested'][0]['path'].startswith('~')
    assert out['nested'][1] == ['upper', '~/y'] and out['nested'][2] == '~/z' and out['prefixed'] == '~\\w'
    assert str(home) not in text and str(home).lower() not in text.lower()
    assert out['number'] == 3 and out['keep'] is None and 'Bearer sk-key' in out
    # A longer directory name that merely starts with the home name is not the home.
    assert diagnostics.redact_report({'p': str(home) + 'x/y'}, home=home)['p'] == str(home) + 'x/y'


def test_redacted_report_carries_neither_the_token_nor_the_secret_nor_the_home_path(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_NATIVE_SESSION_SECRET', NATIVE)
    with TestClient(make_app(tmp_path)) as client:
        assert client.get('/api/diagnostics/report').status_code == 401
        report = client.get('/api/diagnostics/report', headers=AUTH)
        assert report.status_code == 200, report.text
        assert report.headers['Content-Type'] == 'text/plain; charset=utf-8'
        document = json.loads(report.text)
        assert document['format'] == 'arc-diagnostics-report/1' and isinstance(document['generated_at'], int)
        assert document['health']['status'] == 'ready' and document['health']['host_session']['source'] == 'ARC_HOST_SESSION'
        readiness = document['readiness']
        assert readiness['session'] == {'kind': 'token', 'state': 'ready', 'code': 'session.token'}
        assert set(readiness['seats']) == {'planner', 'reviewer', 'falsifier', 'vision', 'prose'}
        assert all(set(seat) == {'state', 'code', 'verification'} for seat in readiness['seats'].values())
        assert all(set(readiness[name]) == {'state', 'code'} for name in ('live_mission', 'connectors', 'renderer', 'memory', 'storage'))
        assert set(document['diagnostics']) == {'checked_at', 'note', *SECTIONS}
        assert document['redaction'] == 'bearer values, secret pairs, opaque tokens, the operator token and native session secret, and the user home path (~)'
        home = str(Path.home())
        strings = []
        def walk(v):
            if isinstance(v, dict):
                for x in v.values():
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
            elif isinstance(v, str):
                strings.append(v)
        walk(document)
        assert TOKEN not in report.text and NATIVE not in report.text
        assert not any(home.lower() in s.lower() for s in strings)
        assert document['diagnostics']['package']['data_dir'].startswith('~')
        # The same text a desktop session gets: redaction does not depend on the principal.
        native = client.get('/api/diagnostics/report', headers={'X-Arc-Native-Session': NATIVE})
        assert native.status_code == 200 and json.loads(native.text)['readiness']['session']['kind'] == 'native'
