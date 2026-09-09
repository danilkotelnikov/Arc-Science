"""Removing scoped renderer cancellation must leak a positively live channel."""
import json
import os
from pathlib import Path
import signal
import select
import subprocess
import sys
import time

import pytest


@pytest.mark.skipif(sys.platform != 'linux', reason='Linux executor uses /proc/self/fd cwd')
@pytest.mark.parametrize('native', [False, True], ids=['standalone', 'native'])
@pytest.mark.parametrize('mode', ['poll', 'acquire', 'setup'])
def test_cancel_owns_renderer_from_acquisition_through_setup(tmp_path, mode, native):
    import arc_science
    repo = Path(__file__).resolve().parents[3]
    binary = repo / 'native/arc-science/target/debug/arc-science-native'
    if native and not binary.is_file():
        pytest.skip('Build native/arc-science with cargo build before integration tests')
    driver = Path(__file__).parent / 'fixtures/render_lifetime.py'
    endpoint = str(tmp_path / 'life.fifo')
    os.mkfifo(endpoint)
    with os.fdopen(os.open(endpoint, os.O_RDONLY | os.O_NONBLOCK), 'rb', buffering=0) as channel:
        env = dict(os.environ)
        if native:
            subprocess.run([str(binary), '--project', str(tmp_path), 'init'], check=True, capture_output=True)
            config = tmp_path / 'arc-science.toml'
            config.write_text(config.read_text().replace('python = "python3"', 'python = ' + json.dumps(sys.executable)))
            package = tmp_path / 'arc_science'
            package.mkdir()
            (package / '__init__.py').write_text('__path__.append(' + repr(str(Path(arc_science.__file__).parent)) + ')\n')
            (package / '__main__.py').write_bytes(driver.read_bytes())
            env['PYTHONPATH'] = str(tmp_path)
            argv = [str(binary), '--project', str(tmp_path), 'worker', '--', mode, endpoint, str(tmp_path)]
        else:
            env['PYTHONPATH'] = str(Path(arc_science.__file__).parent.parent)
            argv = [sys.executable, str(driver), mode, endpoint, str(tmp_path)]
        process = subprocess.Popen(argv, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        pid = None
        try:
            assert select.select([channel], [], [], 5)[0], 'renderer never became live'
            ready = channel.read(32)
            assert ready and ready.endswith(b'\n'), 'renderer exited without a live handshake'
            pid = int(ready)
            if mode == 'poll':
                process.send_signal(signal.SIGTERM)
            # Only the renderer owns this writer: parent, worker and native
            # never inherit it. A timeout cannot be mistaken for death.
            assert select.select([channel], [], [], 5)[0], 'renderer lifetime did not end'
            assert channel.read(1) == b''
            _, stderr = process.communicate(timeout=5)
            assert process.returncode == (130 if native and mode == 'poll' else 143), stderr.decode()
            assert (tmp_path / 'reaped').read_text() == 'ECHILD'
        finally:
            if pid is None and (tmp_path / 'spawned').exists():
                pid = int((tmp_path / 'spawned').read_text())
            if pid is not None:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)


@pytest.mark.skipif(sys.platform != 'linux', reason='Linux executor uses /proc/self/fd cwd')
def test_repeated_native_cancel_contains_renderer_when_python_cannot_cleanup(tmp_path):
    """A force-cancel must reach a renderer even while Python is blocked."""
    import arc_science
    repo = Path(__file__).resolve().parents[3]
    binary = repo / 'native/arc-science/target/debug/arc-science-native'
    if not binary.is_file():
        pytest.skip('Build native/arc-science with cargo build before integration tests')
    driver = Path(__file__).parent / 'fixtures/render_lifetime.py'
    endpoint = str(tmp_path / 'life.fifo')
    os.mkfifo(endpoint)
    with os.fdopen(os.open(endpoint, os.O_RDONLY | os.O_NONBLOCK), 'rb', buffering=0) as channel:
        subprocess.run([str(binary), '--project', str(tmp_path), 'init'], check=True, capture_output=True)
        config = tmp_path / 'arc-science.toml'
        config.write_text(config.read_text().replace('python = "python3"', 'python = ' + json.dumps(sys.executable)))
        package = tmp_path / 'arc_science'
        package.mkdir()
        (package / '__init__.py').write_text('__path__.append(' + repr(str(Path(arc_science.__file__).parent)) + ')\n')
        (package / '__main__.py').write_bytes(driver.read_bytes())
        env = dict(os.environ, PYTHONPATH=str(tmp_path))
        process = subprocess.Popen(
            [str(binary), '--project', str(tmp_path), 'worker', '--', 'blocked', endpoint, str(tmp_path)],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        pid = None
        try:
            assert select.select([channel], [], [], 5)[0], 'renderer never became live'
            ready = channel.read(32)
            assert ready and ready.endswith(b'\n'), 'renderer exited without a live handshake'
            pid = int(ready)
            deadline = time.monotonic() + 5
            while not (tmp_path / 'setup-blocked').exists():
                assert time.monotonic() < deadline, 'Python never entered the blocked setup window'
                time.sleep(.01)
            process.send_signal(signal.SIGTERM)
            assert select.select([process.stderr], [], [], 5)[0], 'native cancellation was not observed'
            first_stderr = process.stderr.readline()
            assert b'Cancellation requested' in first_stderr
            process.send_signal(signal.SIGTERM)
            # The renderer is the sole writer. EOF proves native containment;
            # a process lookup could confuse inaccessible /proc with death.
            assert select.select([channel], [], [], 3)[0], 'renderer survived repeated native cancellation'
            assert channel.read(1) == b''
            _, tail = process.communicate(timeout=5)
            assert process.returncode == 130, (first_stderr + tail).decode()
        finally:
            if pid is None and (tmp_path / 'spawned').exists():
                pid = int((tmp_path / 'spawned').read_text())
            if pid is not None:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)


def test_executor_rejects_non_main_thread_before_spawn(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from arc_science.figure_render import _execute
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pytest.raises(ValueError, match='main thread'):
            pool.submit(_execute, ['/missing/renderer'], -1, -1, 1).result()


@pytest.mark.skipif(os.name != 'posix', reason='POSIX process-group topology check')
def test_native_containment_requires_marker_and_actual_group_leadership(monkeypatch):
    from arc_science.figure_render import _native_owns_descendants
    monkeypatch.setenv('ARC_NATIVE_CONTAINMENT', 'process-group-v1')
    monkeypatch.setattr(os, 'getpid', lambda: 41)
    monkeypatch.setattr(os, 'getpgrp', lambda: 42)
    assert _native_owns_descendants() is False
    monkeypatch.setattr(os, 'getpgrp', lambda: 41)
    assert _native_owns_descendants() is True


@pytest.mark.parametrize('failure', [False, True])
def test_executor_restores_existing_signal_handlers(tmp_path, failure):
    from arc_science.figure_render import _execute
    from arc_science.bioart.isolation import _cancel_on_termination
    # Scope nesting must leave BioArt's SIGTERM policy intact, including errors.
    with _cancel_on_termination():
        before = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM)}
        fd = os.open(tmp_path, os.O_RDONLY | os.O_DIRECTORY)
        log = os.open(tmp_path / 'log', os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            if failure:
                with pytest.raises(FileNotFoundError):
                    _execute(['/missing/renderer'], fd, log, 1)
            else:
                _execute([sys.executable, '-c', 'pass'], fd, log, 1)
            assert {s: signal.getsignal(s) for s in before} == before
        finally:
            os.close(log)
            os.close(fd)
