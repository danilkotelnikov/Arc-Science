"""Synthetic process-boundary fixture: no network, not a BioArt download."""
import ctypes
import json
import os
from pathlib import Path
import signal
import sys

report=Path(sys.argv[1]);root=Path(sys.argv[2])
request=json.loads((root/'request.json').read_text())
report.write_text(json.dumps({'pid':os.getpid(),'directory':str(root)}))
if request['path']=='/success':
    (root/'response.bin').write_bytes(b'synthetic child bytes')
    (root/'result.json').write_text('{"ok":true}')
elif request['path']=='/oversize':
    (root/'response.bin').write_bytes(b'x'*(request['limit']+1))
    signal.signal(signal.SIGALRM,signal.SIG_IGN)
    ctypes.CDLL(None).sleep(60)
else:
    # Deliberately native and alarm-ignoring. Parent process termination is required.
    signal.signal(signal.SIGALRM,signal.SIG_IGN)
    ctypes.CDLL(None).sleep(60)
