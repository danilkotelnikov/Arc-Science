"""Operator settings, read from the native supervisor's `settings.toml`.

The schema, the validator and the writer live in Rust (`arc-science-native settings`).
This module reads the snapshot and forwards a replacement through the supervisor
with the revision the caller saw, so the file has one owner and the service never
serialises the schema itself. Without a supervisor (tests, bare development) the
file is read directly and cannot be changed from here.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tomllib
from pathlib import Path

from .exploration.cli_seats import scrubbed_environment

STALE_REVISION_STATUS = 3
CALL_TIMEOUT = 30.0
MAX_DOCUMENT = 256 * 1024


class SettingsUnavailable(RuntimeError):
    pass


class SettingsRejected(ValueError):
    pass


class SettingsStale(ValueError):
    pass


def _supervisor():
    path = os.environ.get('ARC_SUPERVISOR')
    project = os.environ.get('ARC_PROJECT')
    if path and project and Path(path).is_file() and Path(project).is_dir():
        return [str(Path(path)), '--project', str(Path(project))]
    return None


def _run(arguments, stdin=None):
    command = _supervisor()
    if command is None:
        raise SettingsUnavailable('The native supervisor is not available to this service')
    completed = subprocess.run(command + arguments, input=stdin, capture_output=True, text=True,
                               encoding='utf-8', timeout=CALL_TIMEOUT,
                               env=scrubbed_environment(),
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return completed


def snapshot():
    """The current settings with their revision, straight from the owner."""
    if _supervisor() is not None:
        completed = _run(['settings', 'show'])
        if completed.returncode != 0:
            raise SettingsRejected((completed.stderr or 'settings show failed').strip()[:700])
        return json.loads(completed.stdout)
    path = os.environ.get('ARC_SETTINGS_FILE')
    if not path or not Path(path).is_file():
        raise SettingsUnavailable('No settings file is configured for this service')
    raw = Path(path).read_bytes()
    return {'settings': tomllib.loads(raw.decode('utf-8')), 'revision': hashlib.sha256(raw).hexdigest(),
            'path': str(path), 'read_only': True}


def replace(document: dict, if_revision: str | None):
    """Replace the whole document through the supervisor; the revision must match."""
    text = json.dumps(document, ensure_ascii=False)
    if len(text.encode('utf-8')) > MAX_DOCUMENT:
        raise SettingsRejected('settings document exceeds 256 KiB')
    arguments = ['settings', 'replace', '--stdin']
    if if_revision:
        arguments += ['--if-revision', if_revision]
    completed = _run(arguments, stdin=text)
    if completed.returncode == STALE_REVISION_STATUS:
        raise SettingsStale('Settings changed since they were read; reload and try again')
    if completed.returncode != 0:
        raise SettingsRejected((completed.stderr or 'settings replace failed').strip().replace('arc-science-native: ', '')[:700])
    return json.loads(completed.stdout)


def current():
    """The settings dict, or None when none are configured; never raises."""
    try:
        return snapshot()['settings']
    except (SettingsUnavailable, SettingsRejected, OSError, ValueError, subprocess.SubprocessError):
        return None


def seat(settings: dict | None, role: str) -> dict | None:
    """A configured seat (provider set) or None."""
    if not settings:
        return None
    found = (settings.get('seats') or {}).get(role) or {}
    return found if found.get('provider') else None
