"""Killable owned transport with bounded regular-file transfer, never pipe recv."""
from dataclasses import asdict
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time

from .. import anchored
from ..exploration.cli_seats import scrubbed_environment
from .cache import encoded
from ..vector_assets import _open_directory, _read_regular, _write_regular_at


_ASYNC_SIGNALS = ({signal.SIGINT, signal.SIGTERM, signal.SIGALRM} if os.name == 'posix' else set())
_SOURCE_ROOT = Path(__file__).resolve().parents[2]


def _worker_environment():
    environment = scrubbed_environment()
    environment['PYTHONPATH'] = str(_SOURCE_ROOT)
    return environment


def _mask_async_signals():
    """Block SIGINT/TERM/ALRM while acquiring the child handle (POSIX only)."""
    return signal.pthread_sigmask(signal.SIG_BLOCK, _ASYNC_SIGNALS) if os.name == 'posix' else None


def _reblock_async_signals():
    if os.name == 'posix':
        signal.pthread_sigmask(signal.SIG_BLOCK, _ASYNC_SIGNALS)


def _restore_signal_mask(previous):
    if os.name == 'posix' and previous is not None:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)


def _check_transfer(root,limit):
    bounds={'request.json':4096,'result.json':4096,'response.bin':limit}
    for path in root.iterdir():
        info=path.lstat()
        if path.name not in bounds or not stat.S_ISREG(info.st_mode):
            raise ValueError('Unsafe BioArt worker transfer file')
        if info.st_size>bounds[path.name]:
            raise ValueError('BioArt worker transfer size exceeds limit')


@contextmanager
def _cancel_on_termination():
    if os.name != 'posix':
        # Windows delivers no SIGTERM to a handler; the web supervisor kills the tree.
        yield
        return
    previous=signal.getsignal(signal.SIGTERM)
    def cancel(*_):raise KeyboardInterrupt('BioArt request cancelled by SIGTERM')
    signal.signal(signal.SIGTERM,cancel)
    try:yield
    finally:signal.signal(signal.SIGTERM,previous)


def run_worker(command,request,*,timeout,limit,metadata=None):
    if threading.current_thread() is not threading.main_thread():
        raise ValueError('BioArt owned transport requires the POSIX main thread; use the CLI')
    with _cancel_on_termination():
        return _run_worker(command,request,timeout=timeout,limit=limit,metadata=metadata)


def _run_worker(command,request,*,timeout,limit,metadata=None):
    """Supervise a trusted worker command; terminate/reap before temporary cleanup.

    The timeout includes process start, interpreter/HTTP setup, DNS, headers, body,
    and result publication. Files are read only after successful process exit.
    """
    end=time.monotonic()+timeout
    data=encoded(request)
    if len(data)>4096:raise ValueError('BioArt worker request exceeds limit')
    # System TMPDIR may legitimately use a symlink alias (for example /var on
    # macOS). Resolve that parent before creating our private mode-0700 directory,
    # so both no-follow operations and TemporaryDirectory cleanup use its real path.
    # User cache/source paths retain their separate strict no-symlink policy.
    temporary_parent=Path(tempfile.gettempdir()).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='arc-bioart-http-',dir=temporary_parent) as directory:
        root=Path(directory)
        fd=_open_directory(root)
        try:_write_regular_at(fd,'request.json',data)
        finally:anchored.close_directory(fd)
        if time.monotonic()>=end:raise ValueError('BioArt request total timeout')
        # Defer asynchronous cancellation until the child handle is owned by the
        # cleanup scope. Otherwise SIGINT inside Popen can orphan a spawned child.
        previous_mask=_mask_async_signals()
        process=None
        try:
            process=subprocess.Popen([*command,str(root)],stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,close_fds=True,
                env=_worker_environment())
            _restore_signal_mask(previous_mask)
            while True:
                remaining=end-time.monotonic()
                if remaining<=0:raise ValueError('BioArt request total timeout')
                _check_transfer(root,limit)
                try:
                    process.wait(timeout=min(remaining,0.05))
                    break
                except subprocess.TimeoutExpired:
                    continue
            if time.monotonic()>=end:raise ValueError('BioArt request total timeout')
            _check_transfer(root,limit)
            result=json.loads(_read_regular(root/'result.json',4096,'BioArt worker result'))
            if (not isinstance(result,dict) or type(result.get('ok')) is not bool or
                    (result['ok'] and set(result) not in ({'ok'},{'ok','content_type'})) or
                    (not result['ok'] and set(result)!={'ok','error'})):
                raise ValueError('Invalid BioArt worker result')
            if not result['ok']:
                if not isinstance(result['error'],str) or len(result['error'])>2000:
                    raise ValueError('Invalid BioArt worker error')
                raise ValueError(result['error'])
            if process.returncode!=0:raise ValueError('BioArt transport process failed')
            if metadata is not None:
                if ('content_type' not in result or
                        (result['content_type'] is not None and
                         (not isinstance(result['content_type'],str) or len(result['content_type'])>1024))):
                    raise ValueError('Invalid BioArt worker response metadata')
                metadata['content_type']=result['content_type']
            response=_read_regular(root/'response.bin',limit,'BioArt worker response')
            if time.monotonic()>=end:raise ValueError('BioArt request total timeout')
            return response
        finally:
            # No worker survives timeout, Ctrl-C, malformed output, or file errors.
            # kill() terminates even when the child defers/ignores Python signals.
            _reblock_async_signals()
            try:
                if process is not None:
                    if process.poll() is None:process.kill()
                    process.wait()
            finally:
                _restore_signal_mask(previous_mask)


def request_in_child(path,limit,mimes,limits,*,metadata=None):
    return run_worker([sys.executable,'-m','arc_science.bioart.worker'],
        {'path':path,'limit':limit,'mimes':sorted(mimes),'limits':asdict(limits)},
        timeout=limits.timeout_seconds,limit=limit,metadata=metadata)
