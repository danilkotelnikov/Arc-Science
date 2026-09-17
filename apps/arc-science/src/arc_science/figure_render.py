"""Operator-only fixed-worker figure renders and portable integrity verification."""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
import secrets
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

from . import figure_contract as c
from .vector_assets import verify_asset, _verify_asset_contents


def _kill_renderer(process):
    """Kill the renderer watchdog's isolated process group."""
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _watchdog_result(status_fd, executable):
    """Read the closed, non-inherited status pipe and preserve spawn errors."""
    message = bytearray()
    while True:
        chunk = os.read(status_fd, 129 - len(message))
        if not chunk:
            break
        message.extend(chunk)
        if len(message) > 128:
            raise RuntimeError('Renderer watchdog returned an oversized status')
    try:
        kind, value = bytes(message).decode('ascii').strip().split(' ', 1)
    except (UnicodeDecodeError, ValueError) as exc:
        raise RuntimeError('Renderer watchdog exited without a valid status') from exc
    if kind == 'spawn':
        try:
            number = int(value)
        except ValueError as exc:
            raise RuntimeError('Renderer watchdog returned an invalid spawn error') from exc
        if number <= 0 or str(number) != value:
            raise RuntimeError('Renderer watchdog returned an invalid spawn error')
        raise OSError(number, os.strerror(number), os.fspath(executable))
    if kind != 'status':
        raise RuntimeError('Renderer watchdog failed before renderer completion')
    try:
        status = int(value)
    except ValueError as exc:
        raise RuntimeError('Renderer watchdog returned an invalid renderer status') from exc
    if str(status) != value or not -255 <= status <= 255:
        raise RuntimeError('Renderer watchdog returned an invalid renderer status')
    return status


def _reservation(fd, job, status, failure=None):
    value = {'format':'arc-figure-reservation/1','run_id':job['run_id'],
             'job_sha256':c.digest(c.canonical(job)),'status':status,'failure':failure}
    if status == 'reserved':
        c.write_new(fd,'reservation.json',c.canonical(value))
    else:
        temporary = '.reservation-' + secrets.token_hex(12)
        c.write_new(fd,temporary,c.canonical(value))
        os.replace(temporary,'reservation.json',src_dir_fd=fd,dst_dir_fd=fd)
        os.fsync(fd)


def _append_log(fd, message):
    # The host owns the opened log descriptor; keep room for the terminal reason.
    data = ('\n'+message+'\n').encode('utf-8',errors='replace')[-4096:]
    position = min(os.lseek(fd,0,os.SEEK_END),c.LOG_LIMIT-len(data))
    os.ftruncate(fd,position)
    os.lseek(fd,position,os.SEEK_SET)
    os.write(fd,data)
    os.fsync(fd)


@contextmanager
def _render_cancellation():
    """Defer SIGINT/TERM until the renderer is owned; restore caller policy.

    Signal callbacks must not raise inside Popen's OS-child acquisition, nor
    interrupt kill/wait cleanup. This synchronous executor requires the main
    thread; it does not install process-wide handlers from background threads.
    BioArt's alarm/deadline state is deliberately untouched.
    """
    if threading.current_thread() is not threading.main_thread():
        raise ValueError('Render cancellation requires the POSIX main thread; use the CLI')
    pending = None
    previous = {}
    def cancel(signum, _frame):
        nonlocal pending
        if pending is None: pending = signum
    def check():
        if pending is not None: raise SystemExit(128 + pending)
    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, cancel)
        yield check
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def _kill_tree_windows(process):
    """Kill the renderer and any Blender children it spawned (taskkill /T = the tree).

    The Windows stand-in for the POSIX watchdog's killpg(SIGKILL): weaker (no shared
    process group, a hard parent-kill can still orphan children) but it reaps the
    normal render subtree on timeout, error and cleanup."""
    if process.poll() is not None and process.returncode is not None:
        # Already exited; taskkill would just error. Still try, cheaply, for children.
        pass
    try:
        subprocess.run(['taskkill','/F','/T','/PID',str(process.pid)],
                       stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                       creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),timeout=15)
    except Exception:
        try: process.kill()
        except Exception: pass


def _execute_windows(argv, run_dir, log_fd, timeout):
    """Windows has no killpg/proc/pass_fds sandbox. Run the worker in its own process
    group, anchored to the run directory, with a bounded lifetime and a capped log; a
    reader thread drains stdout so the deadline holds even if the renderer goes silent.
    Isolation is weaker than the POSIX watchdog; the run dir is the operator's own."""
    with _render_cancellation() as check_cancelled, tempfile.TemporaryDirectory(prefix='arc-figure-runtime-') as private:
        # Keep Windows DLL resolution intact (SystemRoot/PATH) while isolating the
        # renderer's HOME, temp and Blender config into a private throwaway directory.
        environment = {k:os.environ[k] for k in
                       ('SystemRoot','SystemDrive','WINDIR','PATH','PATHEXT','NUMBER_OF_PROCESSORS')
                       if k in os.environ}
        environment.update({'HOME':private,'USERPROFILE':private,'TEMP':private,'TMP':private,
                            'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','OMP_NUM_THREADS':'4',
                            'OPENBLAS_NUM_THREADS':'4','MKL_NUM_THREADS':'4',
                            'BLENDER_USER_CONFIG':private,'BLENDER_USER_SCRIPTS':private,
                            'BLENDER_USER_DATAFILES':private})
        deadline = time.monotonic()+timeout
        process = None
        try:
            check_cancelled()
            process = subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT,env=environment,cwd=run_dir,
                                       creationflags=getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0))
            stdout_fd = process.stdout.fileno()
            def pump():
                retained = 0
                while True:
                    data = os.read(stdout_fd,64*1024)
                    if not data: break
                    if retained < c.LOG_LIMIT-4096:
                        chunk = data[:c.LOG_LIMIT-4096-retained]
                        os.write(log_fd,chunk); retained += len(chunk)
            reader = threading.Thread(target=pump,daemon=True); reader.start()
            while True:
                check_cancelled()
                if time.monotonic() >= deadline:
                    raise RuntimeError('Render worker timeout')
                status = process.poll()
                if status is not None:
                    reader.join(2)
                    if status != 0: raise RuntimeError(f'Render worker exited with status {status}')
                    return
                time.sleep(0.05)
        finally:
            if process is not None:
                _kill_tree_windows(process)
                process.wait()
                try: process.stdout.close()
                except OSError: pass


def _execute(argv, run_fd, log_fd, timeout):
    """Bound both retained bytes and lifetime, including inherited descendant pipes."""
    if isinstance(run_fd, str):
        return _execute_windows(argv, run_fd, log_fd, timeout)
    with _render_cancellation() as check_cancelled, tempfile.TemporaryDirectory(prefix='arc-figure-runtime-') as private:
        environment = {'PATH':os.defpath,'HOME':private,'TMPDIR':private,
                       'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','OMP_NUM_THREADS':'4',
                       'OPENBLAS_NUM_THREADS':'4','MKL_NUM_THREADS':'4',
                       'BLENDER_USER_CONFIG':private,'BLENDER_USER_SCRIPTS':private,
                       'BLENDER_USER_DATAFILES':private}
        deadline = time.monotonic()+timeout
        retained = 0
        process = selector = None
        control_r = control_w = status_r = status_w = None
        try:
            check_cancelled()
            control_r, control_w = os.pipe()
            status_r, status_w = os.pipe()
            watchdog = Path(__file__).with_name('renderer_watchdog.py').absolute()
            command = [sys.executable, '-I', str(watchdog), str(control_r), str(status_w),
                       str(run_fd), '--', *argv]
            process = subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT,env=environment,
                                       cwd=f'/proc/self/fd/{run_fd}',
                                       pass_fds=(run_fd,control_r,status_w),start_new_session=True)
            os.close(control_r); control_r = None
            os.close(status_w); status_w = None
            check_cancelled()
            selector = selectors.DefaultSelector()
            os.set_blocking(process.stdout.fileno(),False)
            selector.register(process.stdout,selectors.EVENT_READ)
            while True:
                check_cancelled()
                if time.monotonic() >= deadline:
                    raise RuntimeError('Render worker timeout')
                for key,_ in selector.select(min(0.1,max(0,deadline-time.monotonic()))):
                    data = os.read(key.fileobj.fileno(),64*1024)
                    if not data:
                        selector.unregister(key.fileobj)
                    elif retained < c.LOG_LIMIT-4096:
                        chunk = data[:c.LOG_LIMIT-4096-retained]
                        os.write(log_fd,chunk)
                        retained += len(chunk)
                status = process.poll()
                if status is not None:
                    # Stop any group member left by a failed watchdog before
                    # accepting its non-inherited renderer status.
                    _kill_renderer(process)
                    while True:
                        try: data = os.read(process.stdout.fileno(),64*1024)
                        except BlockingIOError: break
                        if not data: break
                        if retained < c.LOG_LIMIT-4096:
                            chunk = data[:c.LOG_LIMIT-4096-retained]
                            os.write(log_fd,chunk); retained += len(chunk)
                    status = _watchdog_result(status_r, argv[0])
                    check_cancelled()
                    if status != 0: raise RuntimeError(f'Render worker exited with status {status}')
                    return
        finally:
            if process is not None:
                _kill_renderer(process)
                process.wait()
                process.stdout.close()
            if selector is not None: selector.close()
            for descriptor in (control_r, control_w, status_r, status_w):
                if descriptor is not None:
                    os.close(descriptor)


def _capture(asset_json, manifest, run_fd):
    source_fd = c.open_directory(asset_json.parent)
    try:
        raw = c.read_regular(source_fd,'asset.json',c.JSON_LIMIT)
        captured,_ = c.validate_asset(source_fd,manifest['asset_id'])
        if captured != manifest: raise ValueError('Source asset changed during capture')
        files = {manifest['source']['file']:c.read_regular(source_fd,manifest['source']['file'],c.SOURCE_LIMIT),
                 'source.png':c.read_regular(source_fd,'source.png',c.SOURCE_LIMIT),'asset.json':raw}
    finally: os.close(source_fd)
    inputs = c.child_directory(run_fd,'inputs',create=True)
    try:
        destination = c.child_directory(inputs,manifest['asset_id'],create=True)
        try:
            for name,data in files.items(): c.write_new(destination,name,data)
            # Reproduce the captured proof from its captured source, pinned to this fd.
            if _verify_asset_contents(os.dup(destination),manifest['asset_id']) != manifest:
                raise ValueError('Captured asset does not reproduce')
        finally: os.close(destination)
    finally: os.close(inputs)
    return c.digest(raw)


def _verified_outputs(fd, job):
    c.validate_job(job,fd)
    asset_fd = c.asset_directory(fd,job['asset_id'])
    _verify_asset_contents(asset_fd,job['asset_id'])
    c.read_regular(fd,'worker.log',c.LOG_LIMIT,empty=True)
    return c.validate_receipt(c.read_json(fd,'render-receipt.json'),job,fd)


def _check_run_path(run_dir, fd):
    current = c.open_directory(run_dir)
    try:
        expected, actual = os.fstat(fd), os.fstat(current)
        if (expected.st_dev,expected.st_ino) != (actual.st_dev,actual.st_ino):
            raise ValueError('Run directory changed during operation')
    finally: os.close(current)


def _result(run_dir,job):
    return {'run_dir':str(run_dir),'image':str(run_dir/'render.png'),
            'scene':str(run_dir/'scene.blend'),'asset_id':job['asset_id'],'passed':True,
            'representation':'rasterized_vector_panel','rights_verified':False,
            'scientific_validity_established':False,'renderer_reexecuted':False,
            'scope':'Local file integrity; permission is operator-attested. No renderer replay or scientific validation.'}


def render_figure(asset_json: Path, project_dir: Path, *, blender: str | None = None,
                  blender_python: str | None = None, style: str = 'publication',
                  width: int = 1600, height: int = 1200, samples: int = 64,
                  seed: int = 23, timeout: int = 180) -> dict:
    """Create and execute a unique persisted run; raise on failed rendering."""
    c.require_filesystem()
    render_settings = c.settings({'style':style,'width':width,'height':height,'samples':samples,
                                  'seed':seed,'timeout':timeout,'threads':4,'engine':'CYCLES','device':'CPU'})
    if blender is not None and blender_python is not None:
        raise ValueError('Choose either --blender or --blender-python')
    runtime = blender_python if blender_python is not None else blender if blender is not None else 'blender'
    if not isinstance(runtime,str) or not runtime or '\x00' in runtime:
        raise ValueError('Invalid runtime executable')
    # Preserve venv interpreter symlinks: realpath would lose bpy's environment.
    runtime = os.path.abspath(runtime) if os.sep in runtime else shutil.which(runtime) or runtime
    asset_json = c.absolute(Path(asset_json))
    manifest = verify_asset(asset_json)
    source_fd = c.open_directory(asset_json.parent)
    try: manifest_digest = c.digest(c.read_regular(source_fd,'asset.json',c.JSON_LIMIT))
    finally: os.close(source_fd)
    project_dir = c.absolute(Path(project_dir))
    project_fd = c.open_directory(project_dir,create=True)
    try:
        try: os.mkdir('renders',0o700,dir_fd=project_fd)
        except FileExistsError: pass
        renders_fd = c.child_directory(project_fd,'renders')
    finally: os.close(project_fd)
    try:
        run_id = secrets.token_hex(12)
        run_fd = c.child_directory(renders_fd,run_id,create=True)
    finally: os.close(renders_fd)
    run_dir = project_dir/'renders'/run_id
    job = {'format':'arc-figure-job/1','run_id':run_id,'asset_id':manifest['asset_id'],
           'asset':'inputs/'+manifest['asset_id']+'/asset.json',
           'asset_manifest_sha256':manifest_digest,'source_sha256':manifest['source']['sha256'],
           'proof_sha256':manifest['preview']['sha256'],'representation':'rasterized_vector_panel',
           'settings':render_settings}
    log_fd = None
    reserved = False
    try:
        c.write_new(run_fd,'job.json',c.canonical(job))
        _reservation(run_fd,job,'reserved'); reserved = True
        log_fd = os.open('worker.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=run_fd)
        if _capture(asset_json,manifest,run_fd) != manifest_digest:
            raise ValueError('Source manifest changed during capture')
        worker = Path(__file__).with_name('figure_worker.py').absolute()
        if blender_python is not None:
            argv = [runtime,'-I',str(worker),'--',str(run_dir/'job.json'),str(run_dir)]
        else:
            argv = [runtime,'--background','--factory-startup','--disable-autoexec',
                    '--threads','4','--python',str(worker),'--',str(run_dir/'job.json'),str(run_dir)]
        _execute(argv,run_fd,log_fd,timeout)
        # Re-read the persisted job and reservation; the child cannot silently alter them.
        if c.read_json(run_fd,'job.json') != job: raise ValueError('Job changed during rendering')
        c.validate_reservation(c.read_json(run_fd,'reservation.json'),job,'reserved')
        _verified_outputs(run_fd,job)
        _check_run_path(run_dir,run_fd)
        _reservation(run_fd,job,'completed')
        return _result(run_dir,job)
    except BaseException as exc:
        if reserved:
            reason = (type(exc).__name__+': '+str(exc)).replace('\x00','')[:2000]
            _reservation(run_fd,job,'failed',reason)
            if log_fd is not None: _append_log(log_fd,reason)
        raise
    finally:
        if log_fd is not None: os.close(log_fd)
        os.close(run_fd)


def verify_render(run_dir: Path) -> dict:
    """Validate the bound source, job and completed outputs without renderer replay."""
    run_dir = c.absolute(Path(run_dir))
    fd = c.open_directory(run_dir)
    try:
        job = c.read_json(fd,'job.json')
        c.validate_job(job,fd)
        c.validate_reservation(c.read_json(fd,'reservation.json'),job,'completed')
        _verified_outputs(fd,job)
        _check_run_path(run_dir,fd)
        return _result(run_dir,job)
    finally: os.close(fd)
