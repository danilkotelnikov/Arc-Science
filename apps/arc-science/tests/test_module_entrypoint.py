"""The documented Python module entry point must delegate to the actual CLI."""
import os
from pathlib import Path
import subprocess
import sys


def test_package_module_help_runs_in_a_fresh_process(tmp_path):
    source = Path(__file__).resolve().parents[1] / 'src'
    completed = subprocess.run(
        [sys.executable, '-m', 'arc_science', '--help'],
        cwd=tmp_path, env={**os.environ, 'PYTHONPATH': str(source)},
        capture_output=True, text=True, timeout=20,
    )
    assert completed.returncode == 0, completed.stderr
    assert 'Arc Science local research service' in completed.stdout
    assert 'bioart' in completed.stdout
    assert 'serve' in completed.stdout
