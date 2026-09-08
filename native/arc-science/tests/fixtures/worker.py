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
        'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)',
    ])
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
    raise SystemExit(7)
if child:
    while True:
        time.sleep(0.1)
