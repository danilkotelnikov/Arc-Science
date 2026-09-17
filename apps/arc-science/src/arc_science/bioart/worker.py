"""Private owned-HTTPX subprocess; no shell, browser, cache writes, or credentials."""
import json
import os
from pathlib import Path
import signal
import sys

from .. import anchored
from .cache import encoded
from .client import BioArtClient
from .deadline import request_deadline
from .models import BioArtLimits
from ..vector_assets import _open_directory, _read_regular, _write_regular_at


def main(directory):
    # Parent defers cancellation while acquiring the process handle. The new
    # interpreter owns its signal state; its own cooperative deadline can run.
    if os.name=='posix':
        signal.pthread_sigmask(signal.SIG_UNBLOCK,{signal.SIGINT,signal.SIGTERM,signal.SIGALRM})
    root=Path(directory)
    try:
        request=json.loads(_read_regular(root/'request.json',4096,'BioArt worker request'))
        if not isinstance(request,dict) or set(request)!={'path','limit','mimes','limits'}:
            raise ValueError('Invalid BioArt worker request')
        limits=BioArtLimits(**request['limits'])
        path=request['path'];limit=request['limit'];mimes=request['mimes']
        if (not isinstance(path,str) or not path.startswith('/') or path.startswith('//') or '\\' in path or
                type(limit) is not int or not 0<limit<=max(limits.max_file_bytes,limits.max_metadata_bytes) or
                not isinstance(mimes,list) or not mimes or any(not isinstance(m,str) for m in mimes)):
            raise ValueError('Invalid BioArt worker request bounds')
        client=BioArtClient(root/'unused-cache',allow_egress=True,limits=limits)
        with request_deadline(limits.timeout_seconds) as remaining:
            data=client._request_bounded(path,limit,set(mimes),remaining)
        fd=_open_directory(root)
        try:_write_regular_at(fd,'response.bin',data)
        finally:anchored.close_directory(fd)
        result={'ok':True}
    except (ValueError,OSError,TypeError,KeyError) as exc:
        # Transport messages are sanitized upstream; bound all errors on this boundary.
        result={'ok':False,'error':str(exc)[:2000]}
    fd=_open_directory(root)
    try:_write_regular_at(fd,'result.json',encoded(result))
    finally:anchored.close_directory(fd)
    return 0 if result['ok'] else 1


if __name__=='__main__':raise SystemExit(main(sys.argv[1]))
