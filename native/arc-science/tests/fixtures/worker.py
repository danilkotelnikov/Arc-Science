"""Deterministic local process fixture. No network, packages, shell, or PTY."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

record = Path(os.environ['ARC_NATIVE_RECORD'])
mode = sys.argv[1] if len(sys.argv) > 1 else ''
child = None
if mode in ('tree', 'stubborn-tree', 'exit-tree'):
    child = subprocess.Popen([
        sys.executable, '-c',
        '''import os,signal,sys,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
lifetime = os.open(sys.argv[1], os.O_WRONLY)
os.write(lifetime, (str(os.getpid()) + '\\n').encode())
print('live', flush=True)
time.sleep(60)
''', str(record.parent / 'lifetime.fifo'),
    ], stdout=subprocess.PIPE)
    record.with_suffix('.spawned').write_text(json.dumps([os.getpid(), child.pid]))
    assert child.stdout.readline() == b'live\n'
    child.stdout.close()
    if mode == 'tree':
        def cancel(signum, frame):
            child.kill()
            child.wait()
            record.with_suffix('.cleaned').write_text('reaped')
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, cancel)
    else:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)

record.write_text(json.dumps({
    'args': sys.argv[1:], 'module': sys.argv[0], 'cwd': os.getcwd(),
    'env': {k: v for k, v in os.environ.items() if k.startswith('ARC_BIOART_') or k == 'ARC_DATA_DIR'},
    'stdin': sys.stdin.read(), 'pid': os.getpid(), 'child': child.pid if child else None,
}), encoding='utf-8')
print('fixture stdout', flush=True)
print('fixture stderr', file=sys.stderr, flush=True)
if mode == 'exit':
    raise SystemExit(int(sys.argv[2]))
if mode == 'signal':
    os.kill(os.getpid(), signal.SIGTERM)
if mode == 'exit-tree':
    deadline = time.monotonic() + 5
    while not (record.parent / 'release').exists():
        if time.monotonic() >= deadline:
            raise RuntimeError('Observer never acknowledged live descendant')
        time.sleep(.01)
    raise SystemExit(7)
if child:
    while True:
        time.sleep(0.1)
