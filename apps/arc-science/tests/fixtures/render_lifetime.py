"""Real executor driver; only the external renderer is a stdlib fixture."""
import errno
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from arc_science import figure_render

mode, endpoint, root = sys.argv[1:]
root = Path(root)
created = []
real_spawn = subprocess.Popen
real_blocking = os.set_blocking


def spawn(*args, **kwargs):
    child = real_spawn(*args, **kwargs)
    created.append(child)
    (root / 'spawned').write_text(str(child.pid))
    if mode == 'acquire':
        # Cancellation occurs after real OS creation but before assignment of
        # Popen's result in _execute. Wait for positive renderer readiness first.
        deadline = time.monotonic() + 5
        while not (root / 'ready').exists():
            if time.monotonic() > deadline:
                raise RuntimeError('Renderer did not become ready')
            time.sleep(.01)
        os.kill(os.getpid(), signal.SIGTERM)
    return child


def setup(fd, blocking):
    if mode == 'setup':
        deadline = time.monotonic() + 5
        while not (root / 'ready').exists():
            if time.monotonic() > deadline:
                raise RuntimeError('Renderer did not become ready')
            time.sleep(.01)
        os.kill(os.getpid(), signal.SIGTERM)
    elif mode == 'blocked':
        # Hold Python after Popen ownership but before its cancellation check.
        # A repeated native interrupt must still contain the live renderer.
        deadline = time.monotonic() + 5
        while not (root / 'ready').exists():
            if time.monotonic() > deadline:
                raise RuntimeError('Renderer did not become ready')
            time.sleep(.01)
        (root / 'setup-blocked').write_text(str(os.getpid()))
        time.sleep(60)
    return real_blocking(fd, blocking)


subprocess.Popen = spawn
os.set_blocking = setup
renderer = '''import os, pathlib, signal, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
channel = os.open(sys.argv[1], os.O_WRONLY)
os.write(channel, (str(os.getpid()) + '\\n').encode())
pathlib.Path(sys.argv[2], 'ready').write_text('live')
time.sleep(60)
'''
directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
log = os.open(root / 'worker.log', os.O_WRONLY | os.O_CREAT, 0o600)
handlers = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM)}
try:
    figure_render._execute([sys.executable, '-c', renderer, endpoint, str(root)], directory, log, 30)
finally:
    assert {s: signal.getsignal(s) for s in handlers} == handlers
    os.close(log)
    os.close(directory)
    if created and created[0].returncode is not None:
        try:
            os.waitpid(created[0].pid, os.WNOHANG)
        except ChildProcessError as error:
            assert error.errno == errno.ECHILD
            (root / 'reaped').write_text('ECHILD')
