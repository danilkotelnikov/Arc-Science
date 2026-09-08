"""Owned-transport process lifetime tests; no network or NIH file requests."""
import importlib
import json
import os
from pathlib import Path
import signal
import sys
import time

import pytest


def supervisor():
    try:return importlib.import_module('arc_science.bioart.isolation').run_worker
    except ModuleNotFoundError:pytest.fail('Owned BioArt transport isolation is not implemented')


def command(tmp_path):
    return [sys.executable,str(Path(__file__).parent/'fixtures/bioart/deadline-worker.py'),str(tmp_path/'child.json')]


def assert_reaped_and_cleaned(tmp_path):
    child=json.loads((tmp_path/'child.json').read_text())
    with pytest.raises(ChildProcessError):os.waitpid(child['pid'],os.WNOHANG)
    with pytest.raises(ProcessLookupError):os.kill(child['pid'],0)
    assert not Path(child['directory']).exists()


def test_owned_deadline_terminates_and_reaps_native_alarm_ignoring_child(tmp_path):
    run=supervisor();start=time.monotonic()
    with pytest.raises(ValueError,match='total timeout'):
        run(command(tmp_path),{'path':'/block','limit':1024},timeout=1,limit=1024)
    assert time.monotonic()-start<2
    assert_reaped_and_cleaned(tmp_path)


def test_owned_deadline_returns_bounded_file_result_after_child_exit(tmp_path):
    result=supervisor()(command(tmp_path),{'path':'/success','limit':1024},timeout=2,limit=1024)
    assert result==b'synthetic child bytes'
    assert_reaped_and_cleaned(tmp_path)


def test_owned_deadline_oversize_transfer_is_terminated_and_reaped(tmp_path):
    with pytest.raises(ValueError,match='size|limit'):
        supervisor()(command(tmp_path),{'path':'/oversize','limit':1024},timeout=2,limit=1024)
    assert_reaped_and_cleaned(tmp_path)


def test_owned_deadline_cancellation_kills_and_reaps_child(tmp_path):
    run=supervisor()
    previous=signal.getsignal(signal.SIGALRM)
    def cancel(*_):raise KeyboardInterrupt
    signal.signal(signal.SIGALRM,cancel)
    signal.setitimer(signal.ITIMER_REAL,0.5)
    try:
        with pytest.raises(KeyboardInterrupt):
            run(command(tmp_path),{'path':'/block','limit':1024},timeout=5,limit=1024)
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        signal.signal(signal.SIGALRM,previous)
    assert_reaped_and_cleaned(tmp_path)


def test_owned_client_uses_isolation_not_parent_httpx(tmp_path,monkeypatch):
    from arc_science.bioart import BioArtClient
    import arc_science.bioart.client as provider
    from test_bioart import page
    def child(path,limit,mimes,limits):
        assert path=='/bioart/18' and mimes=={'text/html'}
        return page().encode()
    monkeypatch.setattr(provider,'request_in_child',child,raising=False)
    def unexpected(**kwargs):pytest.fail('Owned HTTPX transport was created in parent process')
    monkeypatch.setattr(provider.httpx,'Client',unexpected)
    assert BioArtClient(tmp_path/'cache',allow_egress=True).inspect(18).title=='Antibody'


def test_owned_deadline_cancellation_during_launch_does_not_orphan_child(tmp_path,monkeypatch):
    import arc_science.bioart.isolation as isolation
    original=isolation.subprocess.Popen;started=[]
    def launch(*args,**kwargs):
        process=original(*args,**kwargs);started.append(process)
        end=time.monotonic()+1
        while not (tmp_path/'child.json').exists() and time.monotonic()<end:time.sleep(0.01)
        os.kill(os.getpid(),signal.SIGINT)
        return process
    monkeypatch.setattr(isolation.subprocess,'Popen',launch)
    try:
        with pytest.raises(KeyboardInterrupt):
            supervisor()(command(tmp_path),{'path':'/block','limit':1024},timeout=3,limit=1024)
        assert_reaped_and_cleaned(tmp_path)
    finally:
        # Keeps the RED reproduction safe; GREEN must reap before this cleanup.
        for process in started:
            if process.poll() is None:process.kill()
            process.wait()


def test_real_owned_worker_rejects_invalid_request_without_network(tmp_path):
    from arc_science.bioart.models import BioArtLimits
    from dataclasses import asdict
    request={'path':'//invalid','limit':1024,'mimes':['text/html'],'limits':asdict(BioArtLimits())}
    with pytest.raises(ValueError,match='request bounds'):
        supervisor()([sys.executable,'-m','arc_science.bioart.worker'],request,timeout=2,limit=1024)


def test_owned_deadline_rejects_worker_thread_before_launch(tmp_path):
    import concurrent.futures
    run=supervisor()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        with pytest.raises(ValueError,match='main thread'):
            pool.submit(run,command(tmp_path),{'path':'/success','limit':1024},timeout=1,limit=1024).result(timeout=2)
    assert not (tmp_path/'child.json').exists()


def test_owned_deadline_sigterm_cancels_reaps_and_restores_handler(tmp_path):
    run=supervisor();old_term=signal.getsignal(signal.SIGTERM);old_alarm=signal.getsignal(signal.SIGALRM)
    def prior_handler(*_):pass
    def terminate(*_):os.kill(os.getpid(),signal.SIGTERM)
    signal.signal(signal.SIGTERM,prior_handler);signal.signal(signal.SIGALRM,terminate)
    signal.setitimer(signal.ITIMER_REAL,0.3)
    try:
        with pytest.raises(KeyboardInterrupt):
            run(command(tmp_path),{'path':'/block','limit':1024},timeout=1,limit=1024)
        assert signal.getsignal(signal.SIGTERM)==prior_handler
        assert_reaped_and_cleaned(tmp_path)
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        signal.signal(signal.SIGTERM,old_term);signal.signal(signal.SIGALRM,old_alarm)
