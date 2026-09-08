"""Reject capsules with unsupported or falsely promoted runtime contracts."""
import asyncio
import hashlib
from io import BytesIO
import json
from zipfile import ZipFile

import pytest

from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.capsule import export_capsule, verify_capsule
from arc_science.exploration.engine import explore
from arc_science.exploration.models import MissionRequest


@pytest.fixture(scope='module')
def valid_capsule():
    request = MissionRequest(goal='Check the release contract')
    return export_capsule(request, asyncio.run(explore(request, DemoAgent())))


def rewrite_runtime(blob, change):
    with ZipFile(BytesIO(blob)) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    runtime = json.loads(entries['runtime.json'])
    runtime = change(runtime)
    entries['runtime.json'] = json.dumps(runtime, sort_keys=True).encode()
    entries['manifest.json'] = json.dumps({
        name: hashlib.sha256(data).hexdigest()
        for name, data in entries.items() if name != 'manifest.json'
    }).encode()
    output = BytesIO()
    with ZipFile(output, 'w') as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return output.getvalue()


@pytest.mark.parametrize('field,value', [
    ('format', 'unrecognized-capsule/99'),
    ('format', 'arc-research-capsule/1'),
    ('arc_version', '0.2.0'),
    ('numeric_version', 'arc-numeric-1'),
    ('scientific_validation', 'established'),
    ('model_replay', 'live_models_reexecuted'),
])
def test_capsule_rejects_incompatible_runtime_claims(valid_capsule, field, value):
    forged = rewrite_runtime(valid_capsule, lambda runtime: {**runtime, field: value})
    with pytest.raises(ValueError):
        verify_capsule(forged)


def test_capsule_rejects_nonobject_runtime_metadata(valid_capsule):
    with pytest.raises(ValueError):
        verify_capsule(rewrite_runtime(valid_capsule, lambda _: []))
