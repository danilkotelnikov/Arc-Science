"""Own one renderer process group and close it before reporting completion.

This file is executed as an isolated helper, not imported by the renderer.  A
private control pipe proves that the executor parent is alive.  The renderer
cannot inherit either protocol pipe, so parent death is observable even when a
renderer descendant deliberately keeps stdout open.
"""
from __future__ import annotations

import errno
import os
import select
import signal
import stat
import subprocess
import sys
import time


def _publish(fd: int, message: str) -> None:
    data = (message + '\n').encode('ascii', errors='strict')
    if len(data) > 128:
        raise ValueError('Renderer watchdog status is too large')
    os.write(fd, data)


def _kill_owned_group() -> None:
    """SIGKILL the helper, renderer and inherited descendants together."""
    try:
        os.killpg(os.getpgrp(), signal.SIGKILL)
    finally:
        # Unreachable after a successful kill; fail closed if killpg failed.
        os._exit(126)


def _cancelled(control_fd: int, timeout: float) -> bool:
    readable, _, _ = select.select([control_fd], [], [], timeout)
    if not readable:
        return False
    # EOF is the normal parent-death signal.  Any byte is also a cancellation
    # request, keeping the one-way protocol fail closed.
    os.read(control_fd, 1)
    return True


def main() -> int:
    if len(sys.argv) < 6 or sys.argv[4] != '--':
        raise ValueError('Usage: renderer_watchdog CONTROL STATUS RUN -- COMMAND ...')
    control_fd, status_fd, run_fd = (int(value) for value in sys.argv[1:4])
    if control_fd < 3 or status_fd < 3 or run_fd < 3 or len({control_fd, status_fd, run_fd}) != 3:
        raise ValueError('Renderer watchdog descriptors must be distinct inherited descriptors')
    if not stat.S_ISFIFO(os.fstat(control_fd).st_mode) or not stat.S_ISFIFO(os.fstat(status_fd).st_mode):
        raise ValueError('Renderer watchdog protocol descriptors must be pipes')
    if not stat.S_ISDIR(os.fstat(run_fd).st_mode):
        raise ValueError('Renderer watchdog run descriptor must be a directory')
    if os.getpid() != os.getpgrp():
        raise ValueError('Renderer watchdog must lead its process group')
    if _cancelled(control_fd, 0):
        return 125

    try:
        argv = sys.argv[5:]
        try:
            renderer = subprocess.Popen(
                argv, stdin=subprocess.DEVNULL, stderr=subprocess.STDOUT,
                cwd=f'/proc/self/fd/{run_fd}', pass_fds=(run_fd,))
        except OSError as exc:
            number = exc.errno if isinstance(exc.errno, int) and exc.errno > 0 else errno.EIO
            print(f'{type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
            _publish(status_fd, f'spawn {number}')
            return 0
        except BaseException as exc:
            print(f'{type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
            _publish(status_fd, 'watchdog error')
            return 0

        while True:
            status = renderer.poll()
            if status is not None:
                _publish(status_fd, f'status {status}')
                return 0
            if _cancelled(control_fd, 0.05):
                return 125
            # Keep the poll cadence bounded without relying on signal delivery
            # to interrupt a long sleep on platforms with restarted syscalls.
            time.sleep(0)
    finally:
        # This includes EPIPE while publishing status, malformed invocation
        # after ownership, control-pipe errors, and ordinary renderer exit.
        _kill_owned_group()


if __name__ == '__main__':
    try:
        result = main()
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
        raise
    raise SystemExit(result)
