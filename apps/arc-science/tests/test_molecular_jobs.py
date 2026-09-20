"""Authenticated molecular jobs exercise real subprocess ownership and artifacts."""
import hashlib
import asyncio
from contextlib import suppress
import json
from pathlib import Path
import sys
import subprocess
import threading
import time

import pytest
from fastapi.testclient import TestClient

TOKEN = 'm' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
PREFIX = '/api/molecular'
REQUEST = {'filename': 'complex.cif', 'source_text': 'data_complex\n',
           'antibody_chains': ['A', 'B'], 'antigen_chains': ['C']}


def make_app(tmp_path):
    from arc_science.service import create_app
    return create_app(data_dir=tmp_path, token=TOKEN)


def terminal(client, job_id):
    for _ in range(300):
        row = client.get(f'{PREFIX}/renders/{job_id}', headers=AUTH).json()
        if row['status'] not in ('queued', 'rendering'):
            return row
        time.sleep(.02)
    pytest.fail('Job did not reach a terminal state')


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from arc_science.molecular_jobs import MolecularJobs
    helper = tmp_path / 'standin.py'
    helper.write_text('''import hashlib,json,os,sys,time
from pathlib import Path
root=Path(sys.argv[1]); mode=sys.argv[2]
(root/'started').write_text(str(os.getpid()))
assert 'ARC_MODEL_TOKEN_FILE' not in os.environ
assert 'ANTHROPIC_API_KEY' not in os.environ
assert os.environ['HOME']==str(root/'private')
if mode=='sleep':
    time.sleep(60)
if mode=='chain':
    sys.stderr.write('ValueError: Requested author chain is missing: H, L\\n'); sys.exit(1)
if mode=='fail':
    raise RuntimeError('private /operator/secret/path must not reach the API')
output=root/'output'; output.mkdir()
raw=(root/'input'/'complex.cif').read_bytes()
source_hash=hashlib.sha256(raw).hexdigest()
if mode=='staged':
    # The pipeline's outputs appear one by one: contacts first, then the render log.
    (output/'scene.json').write_bytes(json.dumps({'source':{'sha256':source_hash},'contacts':[{}]}).encode())
    time.sleep(.7)
    (output/'worker.log').write_bytes(b'private log')
    time.sleep(.7)
files={'source.cif':raw,'collage.png':b'\\x89PNG\\r\\n\\x1a\\nfixture',
       'collage.svg':b'<svg xmlns="http://www.w3.org/2000/svg"/>',
       'contacts.csv':b'antibody_residue,antigen_residue\\nA:1,C:1\\n',
       'scene.json':json.dumps({'source':{'sha256':source_hash},'contacts':[{}]}).encode(),
       'checks.json':b'{"passed":true,"source_replay":true,"finite_coordinates":true}',
       'run.json':b'{"status":"completed"}', 'caption.md':b'Geometric contacts only.',
       'worker.log':b'private log'}
for name,data in files.items(): (output/name).write_bytes(data)
manifest={'format':'molecular-artifacts/v1','checks_passed':True,'publication_ready':False,
          'source_sha256':source_hash,'composition':{'total_contact_pairs':1},
          'files':{name:{'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for name,data in files.items()}}
(output/'manifest.json').write_text(json.dumps(manifest))
if mode=='tamper': (output/'collage.png').write_bytes(b'changed')
''', encoding='utf-8')
    monkeypatch.setenv('ARC_MOLECULAR_BLENDER_PYTHON', sys.executable)
    monkeypatch.setenv('ARC_MODEL_TOKEN_FILE', '/private/token')
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'must-never-leak')
    mode = {'value': 'success'}

    async def ready(self):
        return True, 'Runtime probe passed.'

    monkeypatch.setattr(MolecularJobs, '_probe_runtime', ready)
    monkeypatch.setattr(MolecularJobs, '_command',
                        lambda self, request, root: [sys.executable, '-I', str(helper), str(root), mode['value']])
    return mode


def test_every_molecular_route_requires_authentication(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        for method, url in [('get', '/capabilities'), ('get', '/renders'), ('post', '/renders'),
                            ('get', '/renders/nope'), ('post', '/renders/nope/cancel'),
                            ('get', '/renders/nope/assets/collage.png')]:
            assert getattr(client, method)(PREFIX + url).status_code == 401


def test_missing_runtime_is_explicit_and_rejects_submission(tmp_path, monkeypatch):
    monkeypatch.delenv('ARC_MOLECULAR_BLENDER_PYTHON', raising=False)
    with TestClient(make_app(tmp_path)) as client:
        capability = client.get(PREFIX + '/capabilities', headers=AUTH).json()
        assert capability['configured'] is False
        assert capability['reason']
        assert capability['limits']['max_source_bytes'] == 750000
        assert client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).status_code == 409


@pytest.mark.parametrize('changes', [
    {'filename': '../escape.cif'}, {'filename': 'C:\\escape.cif'}, {'filename': 'bad.exe'},
    {'filename': 'CON.cif'}, {'filename': 'CON .cif'}, {'source_text': ''}, {'source_text': '\u20ac' * 250001},
    {'antibody_chains': []}, {'antibody_chains': ['A', 'A']}, {'antigen_chains': ['A']},
    {'antigen_chains': ['C,D']}, {'width': 2401}, {'samples': 129}, {'seed': -1},
    {'model_index': 100}, {'cutoff': 10.1}, {'blender_python': '/untrusted/runtime'},
    {'assembly': 'x' * 65}, {'antibody_chains': [str(i) for i in range(17)]},
])
def test_invalid_upload_is_rejected_without_job(tmp_path, runtime, changes):
    with TestClient(make_app(tmp_path)) as client:
        response = client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, **changes})
        assert response.status_code in (413, 422), response.text
        assert client.get(PREFIX + '/renders', headers=AUTH).json() == []


def test_streamed_body_without_content_length_is_bounded(tmp_path, runtime):
    with TestClient(make_app(tmp_path)) as client:
        response = client.post(PREFIX + '/renders', headers={**AUTH, 'Content-Type': 'application/json'},
                               content=iter([b'{"source_text":"', b'x' * 1100000, b'"}']))
        assert response.status_code == 413
        assert client.get(PREFIX + '/renders', headers=AUTH).json() == []


def test_completion_exposes_only_authenticated_digest_bound_assets(tmp_path, runtime):
    with TestClient(make_app(tmp_path)) as client:
        response = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST)
        assert response.status_code == 202, response.text
        row = terminal(client, response.json()['id'])
        assert row['status'] == 'completed', row
        assert row['contact_pairs'] == 1
        assert row['error'] is None
        assert set(row['assets']) == {'collage.png', 'collage.svg', 'contacts.csv', 'source.cif',
                                      'scene.json', 'manifest.json', 'checks.json', 'caption.md'}
        for name, asset in row['assets'].items():
            assert TOKEN not in asset['url'] and '?' not in asset['url']
            assert client.get(asset['url']).status_code == 401
            download = client.get(asset['url'], headers=AUTH)
            assert download.status_code == 200
            assert hashlib.sha256(download.content).hexdigest() == asset['sha256']
            assert len(download.content) == asset['bytes']
            if name.endswith('.svg'):
                assert 'attachment' in download.headers['content-disposition']
                policy = download.headers['content-security-policy']
                # Hybrid SVGs may embed their own rasters but never run scripts or load remotely.
                assert "default-src 'none'" in policy and 'img-src data:' in policy and 'sandbox' in policy
        assert client.get(f'{PREFIX}/renders/{row["id"]}/assets/worker.log', headers=AUTH).status_code == 404
        assert client.get(f'{PREFIX}/renders/{row["id"]}/assets/../job.json', headers=AUTH).status_code == 404
        assert client.get(PREFIX + '/renders', headers=AUTH).json()[0]['id'] == row['id']


def test_progress_streams_each_stage_as_its_output_appears_and_the_scene_is_readable_early(tmp_path, runtime):
    runtime['value'] = 'staged'
    with TestClient(make_app(tmp_path)) as client:
        job_id = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()['id']
        assert client.get(f'{PREFIX}/renders/{job_id}/events').status_code == 401
        assert client.get(f'{PREFIX}/renders/{job_id}/scene').status_code == 401
        # The scene exists before the render finishes, while the job is still running.
        for _ in range(200):
            scene = client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH)
            if scene.status_code == 200:
                break
            time.sleep(.02)
        assert scene.status_code == 200 and scene.json()['contacts'] == [{}] and scene.headers['x-arc-scene'] == 'provisional'
        assert client.get(f'{PREFIX}/renders/{job_id}', headers=AUTH).json()['status'] == 'rendering'
        # The test client delivers a streamed body only once it is complete; the stages carry
        # their own timestamps, and the browser suite reads the stream live.
        events = []
        with client.stream('GET', f'{PREFIX}/renders/{job_id}/events', headers=AUTH) as stream:
            assert stream.headers['content-type'].startswith('text/event-stream')
            block = {}
            for line in stream.iter_lines():
                if line == '':
                    if block:
                        events.append(block)
                    block = {}
                    if events and events[-1].get('event') == 'end':
                        break
                    continue
                if line.startswith(':'):
                    continue
                key, _, value = line.partition(': ')
                block[key] = json.loads(value) if key == 'data' else value
        ats = [e['data']['at'] for e in events if e['event'] == 'stage']
        assert ats == sorted(ats) and ats[2] - ats[1] >= .5  # rendering was observed after contacts, as the pipeline ran
        kinds = [e['event'] for e in events]
        assert kinds[0] == 'snapshot' and kinds[-2:] == ['status', 'end']
        stages = [e['data']['stage'] for e in events if e['event'] == 'stage']
        assert stages[:3] == ['preparing', 'contacts_ready', 'rendering'] and stages[-1] == 'verifying'
        assert [e['id'] for e in events if e['event'] == 'stage'] == [str(i) for i in range(len(stages))]
        assert events[-2]['data']['status'] == 'completed' and 'collage.png' in events[-2]['data']['assets']
        row = client.get(f'{PREFIX}/renders/{job_id}', headers=AUTH).json()
        assert [s['stage'] for s in row['stages']] == stages
        # Resuming from a stage id replays only what came after it, then the terminal status.
        with client.stream('GET', f'{PREFIX}/renders/{job_id}/events', headers={**AUTH, 'Last-Event-ID': str(len(stages) - 2)}) as stream:
            text = ''.join(stream.iter_text())
        assert text.count('event: stage') == 1 and 'event: status' in text and text.rstrip().endswith('data: {}')
        # The uploaded coordinates are served bound to their digest, never without the token.
        assert client.get(f'{PREFIX}/renders/{job_id}/source').status_code == 401
        source = client.get(f'{PREFIX}/renders/{job_id}/source', headers=AUTH)
        assert source.status_code == 200 and source.text == REQUEST['source_text'] and source.headers['content-type'].startswith('chemical/x-mmcif')
        assert source.headers['etag'] == '"' + row['source_sha256'] + '"'
        (tmp_path / 'molecular' / job_id / 'input' / 'complex.cif').write_text('data_changed\n')
        assert client.get(f'{PREFIX}/renders/{job_id}/source', headers=AUTH).status_code == 409
        # A completed job's scene is verified against the recorded asset digest.
        verified = client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH)
        assert verified.status_code == 200 and verified.headers['x-arc-scene'] == 'verified'
        (tmp_path / 'molecular' / job_id / 'output' / 'scene.json').write_text('{}')
        assert client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH).status_code == 409
        # A resume id past the recorded stages replays nothing it never sent.
        with client.stream('GET', f'{PREFIX}/renders/{job_id}/events', headers={**AUTH, 'Last-Event-ID': '99999'}) as stream:
            text = ''.join(stream.iter_text())
        assert 'event: stage' not in text and 'event: status' in text


def test_a_provisional_scene_is_served_only_while_running_and_only_when_bound_to_the_source(tmp_path, runtime):
    runtime['value'] = 'sleep'
    with TestClient(make_app(tmp_path)) as client:
        job_id = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()['id']
        for _ in range(200):
            if (tmp_path / 'molecular' / job_id / 'started').exists():
                break
            time.sleep(.02)
        output = tmp_path / 'molecular' / job_id / 'output'
        output.mkdir(exist_ok=True)
        # Not bound to the uploaded source, or not a scene at all: nothing is served.
        (output / 'scene.json').write_text(json.dumps({'source': {'sha256': 'f' * 64}, 'contacts': []}))
        assert client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH).status_code == 404
        (output / 'scene.json').write_text('not json')
        assert client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH).status_code == 404
        (output / 'scene.json').write_text(json.dumps({'source': None, 'contacts': []}))
        assert client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH).status_code == 404
        digest = hashlib.sha256(REQUEST['source_text'].encode()).hexdigest()
        (output / 'scene.json').write_text(json.dumps({'source': {'sha256': digest}, 'contacts': [{'antibody_residue': 'A:1', 'antigen_residue': 'C:1'}]}))
        early = client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH)
        assert early.status_code == 200 and early.headers['x-arc-scene'] == 'provisional'
        assert client.post(f'{PREFIX}/renders/{job_id}/cancel', headers=AUTH).status_code == 200
        row = terminal(client, job_id)
        # A cancelled job has no scene to serve, bound or not.
        assert row['status'] == 'cancelled' and client.get(f'{PREFIX}/renders/{job_id}/scene', headers=AUTH).status_code == 404
        assert [s['stage'] for s in row['stages']][:2] == ['preparing', 'contacts_ready']


def test_presets_are_a_registry_the_render_takes_and_the_default_follows_the_settings(tmp_path, runtime, monkeypatch):
    from arc_science import render_presets
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(PREFIX + '/presets').status_code == 401
        listed = client.get(PREFIX + '/presets', headers=AUTH).json()
        assert listed['default'] == 'publication_white' and listed['default_source'] == 'registry'
        assert set(listed['presets']) == set(render_presets.PRESETS) and len(listed['presets']) >= 18
        assert listed['presets']['publication_dark']['style']['background'] == 'dark' and listed['panel_colors']['dark'] == '#1F2326'
        assert listed['geometry_keys'] == ['isovalue', 'stick_radius'] and 'render' not in listed['presets']['publication_dark']
        caps = client.get(PREFIX + '/capabilities', headers=AUTH).json()
        assert caps['presets']['default'] == 'publication_white' and any(p['name'] == 'colourblind_safe' for p in caps['presets']['names'])
        # An unknown preset is refused before any job exists; a known one is recorded as a setting.
        assert client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'preset': 'neon'}).status_code == 422
        row = terminal(client, client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'preset': 'grayscale'}).json()['id'])
        assert row['settings']['preset'] == 'grayscale'
        # Without a preset the operator's default applies; the CLI receives it.
        jobs = client.app.state.molecular_jobs
        jobs.default_preset = lambda: 'publication_dark'
        commands = []
        original = type(jobs)._command
        monkeypatch.setattr(type(jobs), '_command', lambda self, request, root: commands.append(request.preset) or original(self, request, root))
        row2 = terminal(client, client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()['id'])
        assert row2['settings']['preset'] == 'publication_dark' and commands == ['publication_dark']
        # A settings name the registry does not know falls back to the registry default and says so.
        jobs.default_preset = lambda: 'mystery'
        assert client.get(PREFIX + '/presets', headers=AUTH).json()['default_source'].startswith('registry (settings name unknown')
        # A preset change of the same coordinates is a presentation change when only the
        # finish differs, and a change of scientific depiction too when the mesh differs.
        change = client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'preset': 'warm', 'base_job': row['id'], 'declared_effects': ['presentation']})
        assert change.status_code == 202 and change.json()['change']['derived_effects'] == ['presentation'] and change.json()['change']['changed_fields'] == ['preset']
        terminal(client, change.json()['id'])
        narrow = client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'preset': 'tight_envelope', 'base_job': row['id'], 'declared_effects': ['presentation']})
        assert narrow.status_code == 409 and 'scientific_depiction' in narrow.json()['detail']
        full = client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'preset': 'tight_envelope', 'base_job': row['id'], 'declared_effects': ['presentation', 'scientific_depiction']})
        assert full.status_code == 202 and full.json()['change']['derived_effects'] == ['presentation', 'scientific_depiction']
        terminal(client, full.json()['id'])


def test_the_software_catalogue_reports_presence_by_probe_and_never_installs(tmp_path, runtime, monkeypatch):
    from arc_science import molecular_catalogue
    monkeypatch.setattr(molecular_catalogue, 'wsl_available', lambda: False)
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(PREFIX + '/catalogue').status_code == 401
        report = client.get(PREFIX + '/catalogue', headers=AUTH).json()
        assert report['counts']['total'] == len(molecular_catalogue.CATALOGUE) >= 100
        assert set(report['counts']) == {'present', 'absent', 'indirect', 'unprobed', 'total'}
        by_id = {e['id']: e for e in report['entries']}
        # This interpreter's own modules are observed through an isolated import.
        assert by_id['gemmi']['present'] is True and by_id['gemmi']['evidence'] == 'import' and by_id['gemmi']['where'] == 'host python'
        assert by_id['rdkit']['present'] in (True, False) and by_id['rdkit']['licence'] == 'BSD-3-Clause'
        # Without the WSL bench, environments and the daemon are absent, not guessed.
        assert by_id['chai1']['present'] is False and by_id['chai1']['detail'] == 'WSL bench not reachable'
        assert by_id['claude_science']['present'] is False and by_id['boltz']['present'] is False  # no WSL at all: nothing observed
        # Entries with no probe say so instead of claiming absence.
        assert by_id['molstar']['present'] is None and by_id['cdk']['evidence'] is None
        assert 'never qualification' in report['scope'] and 'indirect evidence' in report['scope'] and 'confirm at the project home' in report['licence_note']
        assert set(report['categories']) >= {'structure_prediction', 'cheminformatics', 'antibody_tools'}
        # The report is cached until a refresh is asked for, and a refresh runs probes, so it is a POST.
        assert client.get(PREFIX + '/catalogue', headers=AUTH).json()['checked_at'] == report['checked_at']
        assert client.post(PREFIX + '/catalogue/refresh').status_code == 401
        assert client.post(PREFIX + '/catalogue/refresh', headers=AUTH).json()['checked_at'] >= report['checked_at']


def test_environment_and_daemon_probes_are_indirect_evidence_never_presence(monkeypatch):
    from arc_science import molecular_catalogue as c
    monkeypatch.setattr(c, 'wsl_available', lambda: True)
    monkeypatch.setattr(c, '_run', lambda argv, timeout: subprocess.CompletedProcess(argv, 0,
        '/home/user/miniforge3/envs/SE3nv\n/home/user/miniforge3/envs/plip\n' if 'envs' in argv[-1] else '{"running": true, "version": "0.1.27"}', ''))
    c._WSL_ENVS.update(at=0.0, value=c.UNSET); c._BENCH.update(at=0.0, value=None)
    seen = c.probe({'probe': {'kind': 'wsl_env', 'env': 'SE3nv'}})
    assert seen['present'] is None and seen['observed'] == 'environment_seen' and seen['evidence'] == 'environment'
    assert c.probe({'probe': {'kind': 'wsl_env', 'env': 'nope'}})['present'] is False
    daemon = c.probe({'id': 'boltz', 'probe': {'kind': 'bench'}})
    assert daemon['present'] is None and daemon['observed'] == 'daemon_reachable' and 'not observed' in daemon['detail']
    assert c.probe({'id': 'claude_science', 'probe': {'kind': 'bench'}})['present'] is True  # the daemon is its own package
    # A stopped or unreachable daemon says nothing about the packages it hosts.
    c._BENCH.update(at=0.0, value=None)
    monkeypatch.setattr(c, '_run', lambda argv, timeout: subprocess.CompletedProcess(argv, 0, '{"running": false, "version": "0.1.27"}', ''))
    stopped = c.probe({'id': 'boltz', 'probe': {'kind': 'bench'}})
    assert stopped['present'] is None and stopped['observed'] == 'daemon_installed'
    assert c.probe({'id': 'claude_science', 'probe': {'kind': 'bench'}})['present'] is False
    # An unavailable daemon observed nothing: unprobed in the counts, not indirect evidence.
    c._BENCH.update(at=0.0, value=None)
    monkeypatch.setattr(c, '_run', lambda argv, timeout: subprocess.CompletedProcess(argv, 1, '', 'no daemon'))
    unavailable = c.probe({'id': 'boltz', 'probe': {'kind': 'bench'}})
    assert unavailable['present'] is None and unavailable['observed'] == 'daemon_unavailable' and 'daemon_unavailable' not in c.INDIRECT
    # A failed environment listing is cached for the window instead of being retried per entry.
    c._WSL_ENVS.update(at=0.0, value=c.UNSET)
    calls = []
    def failing(argv, timeout):
        calls.append(argv)
        raise subprocess.TimeoutExpired(argv, timeout)
    monkeypatch.setattr(c, '_run', failing)
    assert c.probe({'probe': {'kind': 'wsl_env', 'env': 'a'}})['detail'] == 'WSL bench not reachable'
    assert c.probe({'probe': {'kind': 'wsl_env', 'env': 'b'}})['detail'] == 'WSL bench not reachable'
    assert len(calls) == 1
    c._WSL_ENVS.update(at=0.0, value=c.UNSET); c._BENCH.update(at=0.0, value=None)


def test_probe_processes_run_under_the_seat_boundary(tmp_path):
    from arc_science import molecular_catalogue as c
    import os as _os
    # Allowlisted environment, private empty working directory, bounded output.
    completed = c._run([sys.executable, '-I', '-c', 'import os, sys; print(os.getcwd()); print(sorted(k for k in os.environ if k in ("ARC_MODEL_TOKEN_FILE", "ANTHROPIC_API_KEY"))); sys.stdout.write("x" * 200000)'], 20)
    lines = completed.stdout.splitlines()
    assert _os.path.basename(lines[0]).startswith('arc-probe-') and not _os.path.isdir(lines[0])
    assert lines[1] == '[]' and len(completed.stdout) <= c.MAX_OUTPUT
    with pytest.raises(subprocess.TimeoutExpired):
        c._run([sys.executable, '-I', '-c', 'import time; time.sleep(30)'], 1)
    # A descendant that keeps stdout open does not hold the probe past the leader's exit.
    started = time.monotonic()
    completed = c._run([sys.executable, '-I', '-c', 'import subprocess, sys; subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"]); print("leader done")'], 15)
    assert completed.stdout.strip() == 'leader done' and time.monotonic() - started < 10


def test_asset_tampering_after_completion_is_detected(tmp_path, runtime):
    with TestClient(make_app(tmp_path)) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
        (tmp_path / 'molecular' / row['id'] / 'output' / 'collage.png').write_bytes(b'tampered')
        assert client.get(row['assets']['collage.png']['url'], headers=AUTH).status_code == 409


@pytest.mark.parametrize('mode', ['fail', 'tamper'])
def test_failure_never_publishes_partial_or_unverified_artifacts(tmp_path, runtime, mode):
    runtime['value'] = mode
    with TestClient(make_app(tmp_path)) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
        assert row['status'] == 'failed'
        assert row['assets'] == {} and row['contact_pairs'] is None
        assert 'private' not in row['error'] and str(tmp_path) not in row['error']
        assert client.get(f'{PREFIX}/renders/{row["id"]}/assets/collage.png', headers=AUTH).status_code == 404


def test_single_active_job_and_cancellation_reap_process(tmp_path, runtime):
    runtime['value'] = 'sleep'
    app = make_app(tmp_path)
    with TestClient(app) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        for _ in range(100):
            process = app.state.molecular_jobs.process
            if process and (tmp_path / 'molecular' / row['id'] / 'started').exists():
                break
            time.sleep(.02)
        assert process is not None and process.poll() is None
        assert client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).status_code == 409
        cancelled = client.post(f'{PREFIX}/renders/{row["id"]}/cancel', headers=AUTH).json()
        assert cancelled['status'] == 'cancelled' and cancelled['assets'] == {}
        assert process.poll() is not None
        runtime['value'] = 'success'
        next_job = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST)
        assert next_job.status_code == 202
        assert terminal(client, next_job.json()['id'])['status'] == 'completed'


def test_deadline_reaps_runtime_and_reports_failure(tmp_path, runtime, monkeypatch):
    import arc_science.molecular_jobs as jobs
    runtime['value'] = 'sleep'
    monkeypatch.setattr(jobs, 'RENDER_DEADLINE_SECONDS', .3)
    app = make_app(tmp_path)
    with TestClient(app) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
        assert row['status'] == 'failed'
        assert 'deadline' in row['error'].lower()
        assert app.state.molecular_jobs.process is None


def test_shutdown_reaps_job_and_persists_interrupted_status(tmp_path, runtime):
    runtime['value'] = 'sleep'
    app = make_app(tmp_path)
    with TestClient(app) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        for _ in range(100):
            process = app.state.molecular_jobs.process
            if process:
                break
            time.sleep(.02)
        assert process is not None
    assert process.poll() is not None
    with TestClient(make_app(tmp_path)) as client:
        restored = client.get(f'{PREFIX}/renders/{row["id"]}', headers=AUTH).json()
        assert restored['status'] == 'interrupted'
        assert restored['assets'] == {}


def test_restart_recovers_abandoned_and_preserves_completed_jobs(tmp_path, runtime):
    with TestClient(make_app(tmp_path)) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
    with TestClient(make_app(tmp_path)) as client:
        restored = client.get(f'{PREFIX}/renders/{row["id"]}', headers=AUTH).json()
        assert restored['status'] == 'completed'
        assert client.get(restored['assets']['collage.png']['url'], headers=AUTH).status_code == 200
    record_path = tmp_path / 'molecular' / row['id'] / 'job.json'
    record = json.loads(record_path.read_text())
    record['status'] = 'rendering'
    record_path.write_text(json.dumps(record))
    with TestClient(make_app(tmp_path)) as client:
        restored = client.get(f'{PREFIX}/renders/{row["id"]}', headers=AUTH).json()
        assert restored['status'] == 'interrupted'
        assert restored['assets'] == {} and restored['contact_pairs'] is None


def test_path_alone_does_not_qualify_runtime(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_MOLECULAR_BLENDER_PYTHON', str(tmp_path / 'fake-python.exe'))
    (tmp_path / 'fake-python.exe').write_bytes(b'not an executable')
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(PREFIX + '/capabilities', headers=AUTH).json()['configured'] is False


def test_runtime_probe_result_is_cached(tmp_path, monkeypatch):
    from arc_science.molecular_jobs import MolecularJobs
    calls = []
    async def probe(self):
        calls.append(True)
        return False, 'Runtime unavailable.'
    monkeypatch.setattr(MolecularJobs, '_probe_runtime', probe)
    with TestClient(make_app(tmp_path)) as client:
        for _ in range(3):
            assert client.get(PREFIX + '/capabilities', headers=AUTH).json()['configured'] is False
        assert len(calls) == 1


@pytest.mark.parametrize('target', ['file', 'directory'])
def test_asset_symlink_redirection_is_rejected(tmp_path, runtime, target):
    with TestClient(make_app(tmp_path)) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
        output = tmp_path / 'molecular' / row['id'] / 'output'
        original = output / 'collage.png' if target == 'file' else output
        redirected = tmp_path / ('redirected.png' if target == 'file' else 'redirected-output')
        original.rename(redirected)
        try:
            original.symlink_to(redirected, target_is_directory=target == 'directory')
        except OSError:
            if target == 'directory' and sys.platform == 'win32':
                result = subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(original), str(redirected)],
                                        capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
                if result.returncode:
                    redirected.rename(original)
                    pytest.skip('This host does not permit creating directory reparse points')
            else:
                redirected.rename(original)
                pytest.skip('This host does not permit creating symlinks')
        assert client.get(row['assets']['collage.png']['url'], headers=AUTH).status_code == 409


def test_recent_history_and_storage_retention_are_bounded(tmp_path, runtime, monkeypatch):
    import arc_science.molecular_jobs as jobs
    with TestClient(make_app(tmp_path)) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
    for number in range(1, 23):
        record = {**row, 'id': f'{number:032x}', 'status': 'cancelled', 'assets': {}, 'contact_pairs': None,
                  'created_at': row['created_at'] + number}
        directory = tmp_path / 'molecular' / record['id']
        directory.mkdir()
        (directory / 'job.json').write_text(json.dumps(record))
    monkeypatch.setattr(jobs, 'MAX_RECORDS', 23)
    with TestClient(make_app(tmp_path)) as client:
        records = client.get(PREFIX + '/renders', headers=AUTH).json()
        assert len(records) == 20
        assert records[0]['id'] == f'{22:032x}'
        assert records[-1]['id'] == f'{3:032x}'
        assert client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).status_code == 409


def test_oversized_and_corrupt_records_are_not_loaded(tmp_path, runtime):
    for number, data in [(1, b'{' + b'x' * 65536), (2, b'{"bad":true}')]:
        directory = tmp_path / 'molecular' / f'{number:032x}'
        directory.mkdir(parents=True)
        (directory / 'job.json').write_bytes(data)
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(PREFIX + '/renders', headers=AUTH).json() == []


def test_actual_cli_parse_failure_is_contained(tmp_path, monkeypatch):
    from arc_science.molecular_jobs import MolecularJobs
    monkeypatch.setenv('ARC_MOLECULAR_BLENDER_PYTHON', sys.executable)
    async def ready(self):
        return True, 'Ready for parser exercise.'
    monkeypatch.setattr(MolecularJobs, '_probe_runtime', ready)
    with TestClient(make_app(tmp_path)) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
        assert row['status'] == 'failed'
        assert row['assets'] == {}
        assert str(tmp_path) not in row['error']


def test_readiness_checks_blender_and_rasterizer_in_isolated_processes(tmp_path, monkeypatch):
    from arc_science.molecular_jobs import MolecularJobs
    monkeypatch.setenv('ARC_MOLECULAR_BLENDER_PYTHON', sys.executable)
    calls = []
    async def execute(self, command, directory, timeout, *, track=False):
        calls.append(command)
    monkeypatch.setattr(MolecularJobs, '_run_process', execute)
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(PREFIX + '/capabilities', headers=AUTH).json()['configured'] is True
        assert len(calls) == 2
        assert all('-I' in command for command in calls)
        assert 'import bpy' in calls[0][-1]
        assert 'render_png_bytes' in calls[1][-1]


def test_failed_rasterizer_probe_is_unavailable(tmp_path, monkeypatch):
    from arc_science.molecular_jobs import MolecularJobs
    monkeypatch.setenv('ARC_MOLECULAR_BLENDER_PYTHON', sys.executable)
    async def execute(self, command, directory, timeout, *, track=False):
        if 'render_png_bytes' in command[-1]:
            raise RuntimeError('/private/rasterizer failed')
    monkeypatch.setattr(MolecularJobs, '_run_process', execute)
    with TestClient(make_app(tmp_path)) as client:
        capability = client.get(PREFIX + '/capabilities', headers=AUTH).json()
        assert capability['configured'] is False
        assert '/private' not in capability['reason']


def test_repeated_cancellation_waits_for_process_cleanup(tmp_path, monkeypatch):
    import arc_science.molecular_jobs as jobs
    started, release = threading.Event(), threading.Event()
    original_stop = jobs._stop_process
    def delayed_stop(process):
        started.set()
        release.wait(3)
        original_stop(process)
    monkeypatch.setattr(jobs, '_stop_process', delayed_stop)
    async def exercise():
        manager = jobs.MolecularJobs(tmp_path, lambda: None)
        task = asyncio.create_task(manager._run_process(
            [sys.executable, '-I', '-c', 'import time; time.sleep(60)'], tmp_path, 60, track=True))
        while manager.process is None:
            await asyncio.sleep(.01)
        process = manager.process
        task.cancel()
        assert await asyncio.to_thread(started.wait, 2)
        task.cancel()
        await asyncio.sleep(.03)
        premature = task.done()
        release.set()
        with suppress(asyncio.CancelledError):
            await task
        assert not premature, 'Cancellation reported before owned process cleanup finished'
        assert process.poll() is not None
        assert manager.process is None
    asyncio.run(exercise())


def test_total_deadline_includes_artifact_verification(tmp_path, runtime, monkeypatch):
    import arc_science.molecular_jobs as jobs
    original = jobs.MolecularJobs._collect_assets
    def delayed_collect(self, row, directory):
        time.sleep(.4)
        return original(self, row, directory)
    monkeypatch.setattr(jobs.MolecularJobs, '_collect_assets', delayed_collect)
    monkeypatch.setattr(jobs, 'RENDER_DEADLINE_SECONDS', .35)
    with TestClient(make_app(tmp_path)) as client:
        row = client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()
        row = terminal(client, row['id'])
        assert row['status'] == 'failed'
        assert 'deadline' in row['error'].lower()
        assert row['assets'] == {}


def test_shutdown_during_readiness_probe_never_starts_a_render(tmp_path, runtime, monkeypatch):
    """close() must serialize with an in-flight submit.

    submit checks `closing` before awaiting the readiness probe inside its lock; the
    first probe runs a subprocess for seconds. A shutdown that begins during that await
    must not let the resumed submit start a render nobody will interrupt or reap.
    """
    import arc_science.molecular_jobs as jobs
    from fastapi import HTTPException
    runtime['value'] = 'sleep'
    gate = asyncio.Event()

    async def parked_probe(self):
        await gate.wait()
        return True, 'Runtime probe passed.'
    monkeypatch.setattr(jobs.MolecularJobs, '_probe_runtime', parked_probe)

    class Upload:
        async def stream(self):
            yield json.dumps(REQUEST).encode()

    async def exercise():
        manager = jobs.MolecularJobs(tmp_path, lambda: None)
        submit = asyncio.create_task(manager.submit(Upload()))
        await asyncio.sleep(.05)                  # submit holds the lock, parked in the probe
        closing = asyncio.create_task(manager.close())
        await asyncio.sleep(.05)                  # shutdown has begun during the probe
        gate.set()                                # probe completes; submit resumes
        try:
            with suppress(HTTPException):
                await submit
            await closing
            assert manager.task is None, 'a render was started after shutdown began'
            assert not any(row['status'] in ('queued', 'rendering') for row in manager.jobs.values())
        finally:
            if manager.task is not None:          # never leak the stand-in renderer on failure
                manager.task.cancel()
                with suppress(asyncio.CancelledError):
                    await manager.task
    asyncio.run(exercise())


def test_domain_failure_reason_is_surfaced_without_private_paths(tmp_path, runtime):
    """A wrong chain ID is the common user mistake; the worker's bounded domain error
    must reach the record, while path-bearing errors (see the 'fail' mode) stay generic."""
    runtime['value'] = 'chain'
    with TestClient(make_app(tmp_path)) as client:
        row = terminal(client, client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()['id'])
        assert row['status'] == 'failed' and row['assets'] == {}
        assert 'Requested author chain is missing: H, L' in row['error']
        assert 'private' not in row['error'] and str(tmp_path) not in row['error']


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows job-object crash containment')
def test_job_object_kills_render_subtree_when_owner_handle_closes(tmp_path):
    """Crash containment: closing the job handle is what happens when the service dies
    for any reason. The whole assigned subtree -- including a grandchild spawned later --
    must be terminated by the OS without any cooperative cleanup."""
    import os, ctypes
    from arc_science.figure_render import _kill_on_close_job, _assign_process_to_job
    child = tmp_path / 'child.py'
    child.write_text('import subprocess, sys, time\n'
                     'g = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\n'
                     'open(sys.argv[1], "w").write(str(g.pid))\n'
                     'time.sleep(60)\n', encoding='utf-8')
    pid_file = tmp_path / 'grandchild.pid'
    job = _kill_on_close_job()
    parent = subprocess.Popen([sys.executable, '-I', str(child), str(pid_file)],
                              creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    try:
        _assign_process_to_job(job, parent)
        for _ in range(200):
            if pid_file.exists() and pid_file.read_text():
                break
            time.sleep(.05)
        grandchild = int(pid_file.read_text())
        ctypes.windll.kernel32.CloseHandle(job)           # the owner dies
        parent.wait(timeout=5)
        assert parent.returncode is not None
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            probe = subprocess.run(['tasklist', '/FI', f'PID eq {grandchild}', '/NH'], capture_output=True, text=True)
            if str(grandchild) not in probe.stdout:
                break
            time.sleep(.1)
        assert str(grandchild) not in probe.stdout, 'grandchild survived the owner death'
    finally:
        if parent.poll() is None:
            parent.kill()


def test_a_rerender_of_the_same_coordinates_declares_its_effects_and_keeps_the_base_render(tmp_path, runtime):
    with TestClient(make_app(tmp_path)) as client:
        base = terminal(client, client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()['id'])
        assert base['settings']['cutoff'] == 4.0 and base['change'] is None
        # Declared presentation, but the cutoff changed too: refused, base untouched, no job created.
        narrow = client.post(PREFIX + '/renders', headers=AUTH,
                             json={**REQUEST, 'cutoff': 5.0, 'width': 1600, 'base_job': base['id'], 'declared_effects': ['presentation']})
        assert narrow.status_code == 409 and 'also affects analysis' in narrow.json()['detail']
        assert len(client.get(PREFIX + '/renders', headers=AUTH).json()) == 1
        # Different coordinates are a new subject, not a change.
        other = client.post(PREFIX + '/renders', headers=AUTH,
                            json={**REQUEST, 'source_text': 'data_other\n', 'base_job': base['id'], 'declared_effects': ['presentation']})
        assert other.status_code == 409 and 'new subject' in other.json()['detail']
        same = client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'base_job': base['id'], 'declared_effects': ['presentation']})
        assert same.status_code == 409 and 'nothing changes' in same.json()['detail']
        assert client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'declared_effects': ['presentation']}).status_code == 409
        assert client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'base_job': '0' * 32, 'declared_effects': ['presentation']}).status_code == 404
        # A wider declaration is accepted; the server records what actually changed and the checks it obliges.
        accepted = client.post(PREFIX + '/renders', headers=AUTH,
                               json={**REQUEST, 'antigen_chains': ['D'], 'width': 1600, 'base_job': base['id'],
                                     'declared_effects': ['presentation', 'scientific_depiction', 'analysis']})
        assert accepted.status_code == 202, accepted.text
        row = terminal(client, accepted.json()['id'])
        assert row['status'] == 'completed'
        assert {k: v for k, v in row['change'].items() if k != 'obligations'} == {
            'base_job': base['id'], 'declared_effects': ['presentation', 'scientific_depiction', 'analysis'],
            'derived_effects': ['presentation', 'scientific_depiction'], 'changed_fields': ['width', 'antigen_chains'],
            'required_checks': ['geometry', 'readability', 'structural_identity', 'visibility', 'interpretation']}
        # No checker exists for these obligations, so every one is recorded unknown, never done.
        assert [o['name'] for o in row['change']['obligations']] == row['change']['required_checks']
        assert all(o['state'] == 'unknown' and 'human must inspect' in o['reason'] for o in row['change']['obligations'])
        # A render that never completed cannot be the base of a change.
        runtime['value'] = 'fail'
        failed = terminal(client, client.post(PREFIX + '/renders', headers=AUTH, json=REQUEST).json()['id'])
        assert failed['status'] == 'failed'
        refused = client.post(PREFIX + '/renders', headers=AUTH, json={**REQUEST, 'width': 1800, 'base_job': failed['id'], 'declared_effects': ['presentation']})
        assert refused.status_code == 409 and 'completed render' in refused.json()['detail']
        runtime['value'] = 'success'
        # The base render is a separate candidate and is never touched.
        again = client.get(f'{PREFIX}/renders/{base["id"]}', headers=AUTH).json()
        assert again == base
    # The change survives a restart with its record.
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(f'{PREFIX}/renders/{row["id"]}', headers=AUTH).json()['change']['changed_fields'] == ['width', 'antigen_chains']
