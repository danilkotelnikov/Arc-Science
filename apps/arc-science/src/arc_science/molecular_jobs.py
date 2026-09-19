"""Single-worker, authenticated molecular rendering around the existing CLI.

The state directory belongs to one local service worker. Windows uses the
existing process-tree cleanup and reparse checks; it is not a security sandbox.
"""
from __future__ import annotations

import asyncio
from contextlib import suppress
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Annotated, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator, model_validator

from . import anchored
from .figure_contract import read_regular, write_new
from .figure_render import _assign_process_to_job, _close_job, _kill_on_close_job

MAX_SOURCE_BYTES = 750000
MAX_BODY_BYTES = 1024 * 1024
MAX_RECORDS = 100
MAX_RECORD_BYTES = 64 * 1024
MAX_ASSET_BYTES = 64 * 1024 * 1024
RENDER_DEADLINE_SECONDS = 960
PROBE_DEADLINE_SECONDS = 45
ASSETS = {
    'collage.png': 'image/png', 'collage.svg': 'image/svg+xml',
    'overview.png': 'image/png', 'interface.png': 'image/png', 'rotated.png': 'image/png',
    'contacts.csv': 'text/csv', 'scene.json': 'application/json',
    'source.cif': 'chemical/x-cif', 'source.mmcif': 'chemical/x-cif', 'source.pdb': 'chemical/x-pdb',
    'manifest.json': 'application/json', 'checks.json': 'application/json', 'caption.md': 'text/plain',
}
Chain = Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9_.-]{1,32}$')]
JobStatus = Literal['queued', 'rendering', 'completed', 'failed', 'cancelled', 'interrupted']


SETTINGS = ('antibody_chains', 'antigen_chains', 'assembly', 'model_index', 'cutoff', 'width', 'samples', 'seed')


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    filename: str = Field(min_length=1, max_length=120)
    source_text: str = Field(min_length=1, max_length=MAX_SOURCE_BYTES)
    # A change of an earlier render of the same coordinates: what the operator declares
    # it affects; the server derives the actual effects and refuses a narrower declaration.
    base_job: str | None = Field(default=None, pattern=r'^[0-9a-f]{32}$')
    declared_effects: list[str] = Field(default_factory=list, max_length=5)
    antibody_chains: list[Chain] = Field(min_length=1, max_length=16)
    antigen_chains: list[Chain] = Field(min_length=1, max_length=16)
    assembly: str = Field(default='asymmetric_unit', pattern=r'^[A-Za-z0-9_.-]{1,64}$')
    model_index: int = Field(default=0, ge=0, le=99)
    cutoff: float = Field(default=4.0, ge=.1, le=10, allow_inf_nan=False)
    width: int = Field(default=1400, ge=640, le=2400)
    samples: int = Field(default=96, ge=1, le=128)
    seed: int = Field(default=23, ge=0, le=2147483647)

    @field_validator('filename')
    @classmethod
    def safe_filename(cls, value):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_. -]*\.(?:cif|mmcif|pdb)', value, re.IGNORECASE):
            raise ValueError('Use a safe CIF, mmCIF or PDB filename')
        if value.split('.')[0].rstrip(' ').upper() in {'CON', 'PRN', 'AUX', 'NUL',
                                         *(f'COM{i}' for i in range(10)), *(f'LPT{i}' for i in range(10))}:
            raise ValueError('Reserved filename')
        return value

    @field_validator('source_text')
    @classmethod
    def bounded_source(cls, value):
        if len(value.encode('utf-8')) > MAX_SOURCE_BYTES or '\x00' in value:
            raise ValueError('Coordinate text exceeds the byte limit or contains NUL')
        return value

    @model_validator(mode='after')
    def distinct_partners(self):
        antibody, antigen = self.antibody_chains, self.antigen_chains
        if len(set(antibody)) != len(antibody) or len(set(antigen)) != len(antigen) or set(antibody) & set(antigen):
            raise ValueError('Partner chain selections must be distinct and non-overlapping')
        return self


class ChangeRecord(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    base_job: str = Field(pattern=r'^[0-9a-f]{32}$')
    declared_effects: list[str] = Field(max_length=5)
    derived_effects: list[str] = Field(min_length=1, max_length=5)
    changed_fields: list[str] = Field(min_length=1, max_length=len(SETTINGS))
    required_checks: list[str] = Field(min_length=1, max_length=12)
    # Each obligation with its state; unknown until a checker exists, so nothing reads it as done.
    obligations: list[dict] = Field(min_length=1, max_length=12)


class AssetRecord(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    url: str = Field(max_length=256)
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    bytes: int = Field(ge=1, le=MAX_ASSET_BYTES)
    media_type: str = Field(max_length=64)


class JobRecord(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str = Field(pattern=r'^[0-9a-f]{32}$')
    status: JobStatus
    filename: str = Field(max_length=120)
    created_at: float
    updated_at: float
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    error: str | None = Field(default=None, max_length=256)
    contact_pairs: int | None = Field(default=None, ge=0, le=2000000)
    assets: dict[str, AssetRecord] = Field(default_factory=dict, max_length=len(ASSETS))
    # Render settings (never the coordinates) so a later render can declare itself a
    # change of this one; None for records written before settings were kept.
    settings: dict | None = None
    change: ChangeRecord | None = None


def _json_bytes(value):
    return (json.dumps(value, ensure_ascii=True, allow_nan=False) + '\n').encode('utf-8')


def _read_file(directory, name, limit=MAX_ASSET_BYTES):
    handle = anchored.open_directory(directory)
    try:
        return read_regular(handle, name, limit)
    finally:
        anchored.close_directory(handle)


def _environment(private, svg2png):
    environment = {key: os.environ[key] for key in
                   ('SystemRoot', 'SystemDrive', 'WINDIR', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS')
                   if os.name == 'nt' and key in os.environ}
    environment.setdefault('PATH', os.defpath)
    environment.update(HOME=str(private), USERPROFILE=str(private), TEMP=str(private), TMP=str(private),
                       TMPDIR=str(private), LANG='C.UTF-8', LC_ALL='C.UTF-8',
                       OMP_NUM_THREADS='4', OPENBLAS_NUM_THREADS='4', MKL_NUM_THREADS='4',
                       BLENDER_USER_CONFIG=str(private), BLENDER_USER_SCRIPTS=str(private),
                       BLENDER_USER_DATAFILES=str(private))
    if svg2png:
        environment['ARC_SVG2PNG'] = svg2png
    return environment


STDERR_TAIL_BYTES = 4096
MAX_REASON_CHARS = 200


class WorkerFailure(RuntimeError):
    """The molecular worker exited non-zero; `reason` is a surfaceable domain error or None."""

    def __init__(self, reason=None):
        super().__init__('Molecular process failed')
        self.reason = reason


def _failure_reason(stderr_tail, forbidden):
    """The worker's last stderr line, only when it is a bounded domain error that
    names no path. The CLI prints `ValueError: ...`/`RuntimeError: ...` for its own
    checks (wrong chain, bad cutoff, failed image checks); tracebacks, OSErrors and
    anything path-like stay behind the generic message."""
    lines = bytes(stderr_tail).decode('utf-8', errors='replace').splitlines()
    last = lines[-1].strip() if lines else ''
    for prefix in ('ValueError: ', 'RuntimeError: '):
        if last.startswith(prefix):
            reason = last[len(prefix):].strip()
            if (0 < len(reason) <= MAX_REASON_CHARS and '/' not in reason and chr(92) not in reason
                    and not any(ord(c) < 32 for c in reason) and not any(f and f in reason for f in forbidden)):
                return reason
    return None


def _stop_process(process):
    from .figure_render import _kill_renderer, _kill_tree_windows
    if os.name == 'nt':
        _kill_tree_windows(process)
    else:
        _kill_renderer(process)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


class MolecularJobs:
    def __init__(self, root: Path, authorized):
        self.root = Path(root) / 'molecular'
        handle = anchored.open_directory(self.root, create=True)
        anchored.close_directory(handle)
        self.runtime = self._resolve_executable(os.environ.get('ARC_MOLECULAR_BLENDER_PYTHON'))
        self.svg2png = self._resolve_executable(os.environ.get('ARC_SVG2PNG'))
        self.jobs = {}
        self.task = None
        self.active_id = None
        self.process = None
        self.closing = False
        self.lock = asyncio.Lock()
        self.probe_lock = asyncio.Lock()
        self.probe_result = None
        self._recover()
        self.router = APIRouter(prefix='/api/molecular', dependencies=[Depends(authorized)])
        self.router.add_api_route('/capabilities', self.capabilities, methods=['GET'])
        self.router.add_api_route('/renders', self.list_jobs, methods=['GET'])
        self.router.add_api_route('/renders', self.submit, methods=['POST'], status_code=202)
        self.router.add_api_route('/renders/{job_id}', self.get_job, methods=['GET'])
        self.router.add_api_route('/renders/{job_id}/cancel', self.cancel, methods=['POST'])
        self.router.add_api_route('/renders/{job_id}/assets/{filename:path}', self.asset, methods=['GET'])

    def _change_of(self, parameters, settings):
        """Derive the effects of re-rendering an earlier job's coordinates with new settings.
        The earlier job is never touched: the new render is a new candidate."""
        from .exploration.changes import ChangeRefused, check_declaration, molecular_effects, required_checks, unknown_obligations
        if parameters.base_job is None:
            raise HTTPException(409, 'Declared effects need a base render to be a change of')
        base = self.jobs.get(parameters.base_job)
        if base is None:
            raise HTTPException(404, 'Base render not found')
        if base['status'] != 'completed':
            raise HTTPException(409, 'Only a completed render can be the base of a change')
        if base['source_sha256'] != hashlib.sha256(parameters.source_text.encode('utf-8')).hexdigest() \
                or base['filename'] != parameters.filename:
            raise HTTPException(409, 'Different coordinates are a new subject, not a change of the base render')
        if base.get('settings') is None:
            raise HTTPException(409, 'The base render predates change tracking; render it again first')
        derived, changed = molecular_effects(base['settings'], settings)
        if not derived:
            raise HTTPException(409, 'The settings equal the base render; nothing changes')
        try:
            check_declaration(parameters.declared_effects, derived)
        except ChangeRefused as refused:
            raise HTTPException(409, str(refused)) from None
        return ChangeRecord(base_job=parameters.base_job, declared_effects=list(parameters.declared_effects),
                            derived_effects=list(derived), changed_fields=list(changed),
                            required_checks=list(required_checks(derived)),
                            obligations=unknown_obligations(derived)).model_dump()

    @staticmethod
    def _resolve_executable(value):
        if not value:
            return None
        # Do not resolve a venv symlink: its lexical path selects the environment.
        path = os.path.abspath(value) if os.path.dirname(value) else shutil.which(value)
        return path if path and Path(path).is_file() else None

    def _recover(self):
        for directory in sorted(self.root.iterdir())[:MAX_RECORDS]:
            if not re.fullmatch(r'[0-9a-f]{32}', directory.name):
                continue
            try:
                row = JobRecord.model_validate_json(_read_file(directory, 'job.json', MAX_RECORD_BYTES)).model_dump()
                if row['id'] != directory.name or any(name not in ASSETS for name in row['assets']):
                    continue
                for name, asset in row['assets'].items():
                    if asset['url'] != self._asset_url(row['id'], name) or asset['media_type'] != ASSETS[name]:
                        raise ValueError('Invalid saved asset')
                self.jobs[row['id']] = row
                if row['status'] in ('queued', 'rendering'):
                    self._finish(row, 'interrupted', 'Service stopped before rendering finished.')
            except (OSError, ValueError, ValidationError):
                # Corrupt or redirected local records are never made public.
                continue

    def _save(self, row):
        data = _json_bytes(row)
        if len(data) > MAX_RECORD_BYTES:
            raise ValueError('Job record exceeds its size limit')
        handle = anchored.open_directory(self.root / row['id'])
        temporary = '.job-' + uuid.uuid4().hex
        try:
            write_new(handle, temporary, data)
            anchored.replace(handle, temporary, 'job.json')
            anchored.fsync_dir(handle)
        finally:
            with suppress(OSError):
                anchored.unlink(handle, temporary)
            anchored.close_directory(handle)

    def _finish(self, row, status, error=None):
        row.update(status=status, error=error, updated_at=time.time())
        if status != 'completed':
            row.update(assets={}, contact_pairs=None)
        self._save(row)

    @staticmethod
    def _asset_url(job_id, name):
        return f'/api/molecular/renders/{job_id}/assets/{name}'

    async def _run_process(self, command, directory, timeout, *, track=False):
        private = directory / 'private'
        private.mkdir(mode=0o700, exist_ok=True)
        options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
        # Crash containment (Windows): the render tree lives in a kill-on-close job
        # object. If this service dies for any reason -- crash, forced kill -- the OS
        # closes the handle and terminates the CLI and its Blender descendants, which
        # no cooperative cleanup could do. POSIX uses the process group for this.
        job = _kill_on_close_job() if os.name == 'nt' else None
        try:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.PIPE, cwd=directory,
                                       env=_environment(private, self.svg2png), **options)
        except BaseException:
            if job is not None:
                _close_job(job)
            raise
        if job is not None:
            try:
                _assign_process_to_job(job, process)
            except OSError:
                # Assignment can only fail before the CLI spawns Blender; fall back to
                # the cooperative tree kill rather than run an uncontained render.
                _stop_process(process)
                _close_job(job)
                raise
        if track:
            self.process = process
        # Keep only a bounded tail of stderr so a failure can name its domain error
        # without ever buffering an unbounded log or writing it next to the outputs.
        stderr_tail = bytearray()
        stderr_fd = process.stderr.fileno()

        def drain():
            while True:
                try:
                    chunk = os.read(stderr_fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                stderr_tail.extend(chunk)
                if len(stderr_tail) > STDERR_TAIL_BYTES:
                    del stderr_tail[:-STDERR_TAIL_BYTES]
        drainer = threading.Thread(target=drain, daemon=True)
        drainer.start()
        try:
            deadline = time.monotonic() + timeout
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Molecular render deadline exceeded.')
                await asyncio.sleep(.05)
            if process.returncode:
                drainer.join(2)
                raise WorkerFailure(_failure_reason(stderr_tail, (str(directory), str(self.root))))
        finally:
            # Await cleanup before exposing a terminal status or accepting a new job.
            # A shutdown can cancel a job already being cancelled by its HTTP request.
            cleanup = asyncio.create_task(asyncio.to_thread(_stop_process, process))
            cancellation = None
            while not cleanup.done():
                try:
                    await asyncio.shield(cleanup)
                except asyncio.CancelledError as error:
                    cancellation = error
            cleanup.result()
            with suppress(OSError):
                process.stderr.close()
            if job is not None:
                _close_job(job)  # kill-on-close reaps anything taskkill missed
            if track:
                self.process = None
            if cancellation is not None:
                raise cancellation

    @staticmethod
    def _bootstrap(code):
        package_root = str(Path(__file__).absolute().parent.parent)
        return f'import sys; sys.path.insert(0, {package_root!r}); ' + code

    async def _probe_runtime(self):
        if not self.runtime:
            return False, 'Configure ARC_MOLECULAR_BLENDER_PYTHON on the server, then restart the service.'
        try:
            with tempfile.TemporaryDirectory(prefix='arc-molecular-probe-') as temporary:
                directory = Path(temporary)
                started = time.monotonic()
                await self._run_process([self.runtime, '-I', '-X', 'utf8', '-c',
                    'import bpy, numpy, scipy.ndimage, skimage.measure; assert bpy.app.version[0] >= 4'],
                    directory, PROBE_DEADLINE_SECONDS)
                code = self._bootstrap(
                    'import gemmi, numpy, scipy.spatial; from arc_science.svg_raster import render_png_bytes; '
                    '''assert render_png_bytes(b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').startswith(b"\\x89PNG")''')
                await self._run_process([sys.executable, '-I', '-X', 'utf8', '-c', code], directory,
                    max(.1, PROBE_DEADLINE_SECONDS - (time.monotonic() - started)))
        except (OSError, RuntimeError, TimeoutError):
            return False, 'Runtime readiness check failed. Check Blender Python, structure dependencies and the SVG rasterizer; restart after configuration changes.'
        return True, 'Runtime imports and SVG rasterization passed; each render is checked separately.'

    async def capabilities(self):
        async with self.probe_lock:
            if self.probe_result is None:
                self.probe_result = await self._probe_runtime()
        configured, reason = self.probe_result
        return {'configured': configured, 'reason': reason, 'limits': {
            'max_source_bytes': MAX_SOURCE_BYTES, 'max_body_bytes': MAX_BODY_BYTES,
            'width': {'min': 640, 'max': 2400}, 'samples': {'min': 1, 'max': 128},
            'cutoff': {'min': .1, 'max': 10}, 'model_index': {'min': 0, 'max': 99},
            'max_jobs': MAX_RECORDS, 'deadline_seconds': RENDER_DEADLINE_SECONDS}}

    async def list_jobs(self):
        return sorted(self.jobs.values(), key=lambda row: row['created_at'], reverse=True)[:20]

    async def get_job(self, job_id: str):
        if job_id not in self.jobs:
            raise HTTPException(404, 'Unknown molecular render')
        return self.jobs[job_id]

    async def submit(self, request: Request):
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_BODY_BYTES:
                raise HTTPException(413, 'Molecular request exceeds the upload limit')
            body.extend(chunk)
        try:
            parameters = RenderRequest.model_validate_json(bytes(body))
        except (ValueError, ValidationError):
            raise HTTPException(422, 'Invalid coordinate upload or rendering settings') from None
        settings = parameters.model_dump(include=set(SETTINGS))
        change = None
        if parameters.base_job is not None or parameters.declared_effects:
            change = self._change_of(parameters, settings)
        async with self.lock:
            if self.closing or self.task is not None:
                raise HTTPException(409, 'A molecular render is already active or the service is stopping')
            if len(self.jobs) >= MAX_RECORDS:
                raise HTTPException(409, 'Molecular job storage is full; stop the service, archive old job directories, then restart')
            if not (await self.capabilities())['configured']:
                raise HTTPException(409, 'Molecular rendering is unavailable; check server capabilities')
            if self.closing:
                # Shutdown began while the readiness probe ran; start nothing nobody will reap.
                raise HTTPException(409, 'A molecular render is already active or the service is stopping')
            job_id = uuid.uuid4().hex
            directory = self.root / job_id
            source = parameters.source_text.encode('utf-8')
            handle = anchored.open_directory(self.root)
            try:
                anchored.mkdir(handle, job_id)
                job_handle = anchored.child_directory(handle, job_id)
                try:
                    input_handle = anchored.child_directory(job_handle, 'input', create=True)
                    try:
                        write_new(input_handle, parameters.filename, source)
                    finally:
                        anchored.close_directory(input_handle)
                finally:
                    anchored.close_directory(job_handle)
            finally:
                anchored.close_directory(handle)
            now = time.time()
            row = JobRecord(id=job_id, status='queued', filename=parameters.filename,
                            source_sha256=hashlib.sha256(source).hexdigest(), created_at=now, updated_at=now,
                            settings=settings, change=change).model_dump()
            self._save(row)
            self.jobs[job_id] = row
            self.active_id = job_id
            self.task = asyncio.create_task(self._worker(row, parameters, directory))
            return dict(row)

    def _command(self, parameters, directory):
        code = self._bootstrap('from arc_science.cli import main; raise SystemExit(main())')
        return [sys.executable, '-I', '-X', 'utf8', '-c', code, 'molecule-render',
                str(directory / 'input' / parameters.filename), '--antibody', ','.join(parameters.antibody_chains),
                '--antigen', ','.join(parameters.antigen_chains), '--output', str(directory / 'output'),
                '--blender-python', self.runtime, '--assembly', parameters.assembly,
                '--model-index', str(parameters.model_index), '--cutoff', str(parameters.cutoff),
                '--width', str(parameters.width), '--samples', str(parameters.samples), '--seed', str(parameters.seed)]

    def _collect_assets(self, row, directory):
        output = directory / 'output'
        manifest_bytes = _read_file(output, 'manifest.json', 4 * 1024 * 1024)
        manifest = json.loads(manifest_bytes)
        if (manifest['format'] != 'molecular-artifacts/v1' or manifest['checks_passed'] is not True or
                manifest['source_sha256'] != row['source_sha256'] or manifest['publication_ready'] is not False):
            raise ValueError('Render manifest does not attest to a checked source-bound render')
        required = {'collage.png', 'collage.svg', 'contacts.csv', 'scene.json', 'checks.json', 'caption.md',
                    'source' + Path(row['filename']).suffix.lower()}
        if not required <= manifest['files'].keys():
            raise ValueError('Required molecular artifacts are missing')
        assets = {}
        source_name = 'source' + Path(row['filename']).suffix.lower()
        for name in sorted(set(manifest['files']) & ASSETS.keys()):
            data = _read_file(output, name)
            digest = hashlib.sha256(data).hexdigest()
            if manifest['files'][name] != {'sha256': digest, 'bytes': len(data)}:
                raise ValueError('Render artifact integrity failed')
            if name == source_name and digest != row['source_sha256']:
                raise ValueError('Captured source differs from the uploaded coordinates')
            if name == 'scene.json':
                scene = json.loads(data)
                if scene['source']['sha256'] != row['source_sha256']:
                    raise ValueError('Scene source mismatch')
                contact_pairs = len(scene['contacts'])
            if name == 'checks.json':
                checks = json.loads(data)
                if not all(checks.get(key) is True for key in ('passed', 'source_replay', 'finite_coordinates')):
                    raise ValueError('Render checks did not pass')
            assets[name] = {'url': self._asset_url(row['id'], name), 'sha256': digest,
                            'bytes': len(data), 'media_type': ASSETS[name]}
        run = json.loads(_read_file(output, 'run.json', MAX_RECORD_BYTES))
        if run['status'] != 'completed' or manifest['composition']['total_contact_pairs'] != contact_pairs:
            raise ValueError('Incomplete or inconsistent molecular render')
        assets['manifest.json'] = {'url': self._asset_url(row['id'], 'manifest.json'),
            'sha256': hashlib.sha256(manifest_bytes).hexdigest(), 'bytes': len(manifest_bytes), 'media_type': 'application/json'}
        return assets, contact_pairs

    async def _worker(self, row, parameters, directory):
        try:
            self._finish(row, 'rendering')
            async with asyncio.timeout(RENDER_DEADLINE_SECONDS):
                await self._run_process(self._command(parameters, directory), directory, RENDER_DEADLINE_SECONDS, track=True)
                assets, contact_pairs = await asyncio.to_thread(self._collect_assets, row, directory)
            row.update(assets=assets, contact_pairs=contact_pairs)
            self._finish(row, 'completed')
        except asyncio.CancelledError:
            self._finish(row, 'interrupted' if self.closing else 'cancelled',
                         'Service stopped before rendering finished.' if self.closing else 'Rendering cancelled.')
            raise
        except TimeoutError:
            self._finish(row, 'failed', 'Molecular render exceeded its total deadline.')
        except WorkerFailure as failure:
            self._finish(row, 'failed', 'Molecular rendering failed: ' + failure.reason if failure.reason else
                         'Molecular rendering or artifact checks failed. Verify coordinates, chain selections and server runtime.')
        except Exception:
            self._finish(row, 'failed', 'Molecular rendering or artifact checks failed. Verify coordinates, chain selections and server runtime.')
        finally:
            self.active_id = None
            self.task = None

    async def cancel(self, job_id: str):
        row = await self.get_job(job_id)
        async with self.lock:
            if self.active_id == job_id and self.task is not None:
                task = self.task
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                if row['status'] in ('queued', 'rendering'):
                    self._finish(row, 'cancelled', 'Rendering cancelled.')
                self.active_id = None
                self.task = None
        return row

    async def close(self):
        self.closing = True
        # Serialize with submit: a submit parked in the readiness probe still holds the
        # lock and would otherwise assign self.task after this check.
        async with self.lock:
            if self.task is not None:
                job_id, task = self.active_id, self.task
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                row = self.jobs[job_id]
                if row['status'] in ('queued', 'rendering'):
                    self._finish(row, 'interrupted', 'Service stopped before rendering finished.')
                self.active_id = None
                self.task = None

    async def asset(self, job_id: str, filename: str):
        row = await self.get_job(job_id)
        if row['status'] != 'completed' or filename not in ASSETS or filename not in row['assets']:
            raise HTTPException(404, 'Unknown completed molecular artifact')
        record = row['assets'][filename]
        try:
            data = await asyncio.to_thread(_read_file, self.root / job_id / 'output', filename)
            if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
                raise ValueError('Changed artifact')
        except (OSError, ValueError):
            raise HTTPException(409, 'Molecular artifact integrity check failed') from None
        disposition = 'inline' if record['media_type'] == 'image/png' else 'attachment'
        return Response(data, media_type=record['media_type'], headers={
            'ETag': '"' + record['sha256'] + '"',
            'Content-Disposition': f'{disposition}; filename="{filename}"',
            'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; sandbox",
        })
