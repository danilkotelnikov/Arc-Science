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
