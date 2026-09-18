"""Offline native-to-application BioArt bridge using source metadata and synthetic SVG."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest


ENTRY_FIXTURE = Path(__file__).parent / "fixtures/bioart/entry-18-reduced.json"
NATIVE = Path(__file__).parents[3] / "native/arc-science/target/debug/arc-science-native"
if os.name == 'nt':
    NATIVE = NATIVE.with_suffix('.exe')
# Deliberately synthetic fixture bytes: no NIH file transfer occurred.
SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">'
    b'<rect width="20" height="10" fill="#ffffff"/></svg>'
)


def canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_page():
    records = json.loads(ENTRY_FIXTURE.read_text(encoding="utf-8"))["records"]
    flight = "11:" + json.dumps(records) + "\n"
    cut = len(flight) // 2
    return "".join(
        "<script>self.__next_f.push(" + json.dumps([1, chunk]) + ")</script>"
        for chunk in (flight[:cut], flight[cut:])
    ).encode()


def run_native(project, *args):
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("ARC_BIOART_")
    }
    environment["PYTHONPATH"] = str(Path(__file__).parents[1] / "src")
    return subprocess.run(
        [NATIVE, "--project", project, *args],
        env=environment,
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )


def seed_verified_fetch(cache):
    cache.mkdir(parents=True)
    page = source_page()
    page_sha = digest(page)
    source_sha = digest(SVG)
    retrieved_at = time.time()
    receipt = {
        "schema": "arc-bioart-asset/1",
        "entry_id": 18,
        "entry_url": "https://bioart.niaid.nih.gov/bioart/18",
        "title": "Antibody",
        "license": "Public Domain",
        "credit": "Courtesy of NIAID",
        "creator": "Ryan Kissinger",
        "collection": "NIAID Visual & Medical Arts",
        "citation": (
            "NIAID Visual & Medical Arts. (10/7/2024). Antibody. "
            "NIAID NIH BIOART Source. bioart.niaid.nih.gov/bioart/18"
        ),
        "representation_id": 64,
        "caption": "Antibody - Grey",
        "format": "SVG",
        "file_id": 626860,
        "retrieved_at": retrieved_at,
        "source_page_sha256": page_sha,
        "sha256": source_sha,
        "size": len(SVG),
        "source_file": source_sha + ".svg",
        "preview_eligible": True,
        "import_eligible": True,
        "limitation": None,
        "rights_verified": False,
        "scientific_validity_established": False,
    }
    receipt_data = canonical(receipt)
    receipt_name = digest(receipt_data) + ".receipt.json"
    (cache / (page_sha + ".html")).write_bytes(page)
    (cache / (source_sha + ".svg")).write_bytes(SVG)
    (cache / receipt_name).write_bytes(receipt_data)
    (cache / ("metadata-" + digest(b"/bioart/18") + ".json")).write_bytes(
        canonical(
            {
                "url": "https://bioart.niaid.nih.gov/bioart/18",
                "retrieved_at": retrieved_at,
                "sha256": page_sha,
            }
        )
    )
    (cache / ("fetch-" + digest(canonical([18, 64, "SVG", page_sha])) + ".json")).write_bytes(
        canonical({"receipt": receipt_name})
    )
    return receipt_name, source_sha


def test_native_init_and_default_svg_fetch_use_configured_offline_cache(tmp_path):
    if not NATIVE.is_file():
        pytest.skip("native debug binary is not built")

    project = tmp_path / "Native BioArt 日本"
    project.mkdir()
    initialized = run_native(project, "init", "--python", sys.executable)
    assert initialized.returncode == 0, initialized.stderr

    config_path = project / "arc-science.toml"
    config = config_path.read_text(encoding="utf-8")
    custom = "state space 日本/bioart cache"
    assert 'cache_dir = ".arc-science/bioart"' in config
    config_path.write_text(
        config.replace('cache_dir = ".arc-science/bioart"', f'cache_dir = "{custom}"'),
        encoding="utf-8",
    )
    cache = project / custom
    receipt_name, source_sha = seed_verified_fetch(cache)

    fetched = run_native(project, "bioart", "fetch", "18")
    assert fetched.returncode == 0, fetched.stderr
    value = json.loads(fetched.stdout)
    assert value["entry_id"] == 18
    assert value["representation_id"] == 64
    assert value["file_id"] == 626860
    assert value["format"] == "SVG"
    assert value["sha256"] == source_sha
    assert value["preview_eligible"] is True
    assert value["import_eligible"] is True
    assert value["limitation"] is None
    # Windows canonicalization may retain the extended-length \\?\ prefix.
    assert Path(value["receipt"]).samefile(cache / receipt_name)
    assert Path(value["source"]).read_bytes() == SVG

    verified = run_native(project, "bioart", "verify", value["receipt"])
    assert verified.returncode == 0, verified.stderr
    verification = json.loads(verified.stdout)
    assert verification["entry_id"] == 18
    assert verification["representation_id"] == 64
    assert verification["file_id"] == 626860
    assert verification["format"] == "SVG"
    assert verification["sha256"] == source_sha
    assert digest((cache / receipt_name).read_bytes()) == receipt_name[:64]


@pytest.mark.parametrize("flag,setting", [("-O", None), ("-OO", None), (None, "1")])
def test_installed_package_check_refuses_disabled_assertions(flag, setting):
    """Removing the optimization refusal must turn rejection into false success."""
    if not NATIVE.is_file():
        pytest.skip("native debug binary is not built")
    environment = dict(os.environ)
    environment.pop("PYTHONOPTIMIZE", None)
    if setting is not None:
        environment["PYTHONOPTIMIZE"] = setting
    script = Path(__file__).parents[1] / "scripts/check-native-installed.py"
    command = [sys.executable, *([flag] if flag else []), str(script),
               "--binary", str(NATIVE), "--python", sys.executable]
    result = subprocess.run(command, env=environment, text=True, capture_output=True,
                            check=False, timeout=20)
    assert result.returncode == 2, (result.returncode, result.stdout, result.stderr)
    assert "optimization disables qualification checks" in result.stderr
    assert '"result": "passed"' not in result.stdout
