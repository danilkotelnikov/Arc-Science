"""Qualify a real Linux launcher against an installed wheel, entirely offline.

Run with the application's test environment (pytest is used by the retained
fixture). The separate --python interpreter must contain a non-editable wheel
installation with the vector extra. This is not a live NIH compatibility test.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--python", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("This check qualifies Linux execution only")
    binary = args.binary.resolve(strict=True)
    # Preserve a venv's interpreter path rather than following its symlink.
    python = args.python.absolute()
    if not binary.is_file() or not python.is_file():
        parser.error("Both paths must identify executable files")
    app = Path(__file__).resolve().parents[1]
    fixture = runpy.run_path(str(app / "tests/test_native_bioart.py"))
    environment = {
        key: value for key, value in os.environ.items()
        if not key.startswith("ARC_BIOART_") and key not in {"PYTHONPATH", "PYTHONHOME"}
    }
    probe = subprocess.run(
        [str(python), "-I", "-c",
         "import arc_science,json; print(json.dumps({'path':arc_science.__file__,"
         "'version':arc_science.__version__}))"],
        env=environment, capture_output=True, text=True, check=True, timeout=10,
    )
    installed = json.loads(probe.stdout)
    package = Path(installed["path"]).resolve()
    assert "site-packages" in package.parts, "A non-editable wheel installation is required"
    assert not package.is_relative_to(app), "Source imports are not installed-wheel evidence"
    assert installed["version"] == "0.6.0"
    with tempfile.TemporaryDirectory(
        prefix="arc-installed-check-", dir=Path(tempfile.gettempdir()).resolve()
    ) as directory:
        project = Path(directory)

        def invoke(*arguments):
            result = subprocess.run(
                [str(binary), "--project", str(project), *map(str, arguments)],
                cwd=project, env=environment, capture_output=True, text=True,
                check=True, timeout=20,
            )
            return result.stdout

        invoke("init", "--python", python)
        config = project / "arc-science.toml"
        original = config.read_text(encoding="utf-8")
        old = 'cache_dir = ".arc-science/bioart"'
        assert original.count(old) == 1
        custom = "state space 日本/bioart cache"
        config.write_text(original.replace(old, f'cache_dir = "{custom}"'), encoding="utf-8")
        cache = project / custom
        receipt_name, source_hash = fixture["seed_verified_fetch"](cache)
        fetched = json.loads(invoke("bioart", "fetch", "18"))
        assert (fetched["entry_id"], fetched["representation_id"], fetched["file_id"]) == (18, 64, 626860)
        assert fetched["format"] == "SVG" and fetched["sha256"] == source_hash
        assert Path(fetched["receipt"]) == cache / receipt_name
        assert Path(fetched["source"]).read_bytes() == fixture["SVG"]
        verified = json.loads(invoke("bioart", "verify", fetched["receipt"]))
        assert verified["sha256"] == source_hash
        assert verified["rights_verified"] is False
        assert verified["scientific_validity_established"] is False
        imported = json.loads(invoke("bioart", "import", fetched["receipt"]))
        manifest_path = Path(imported["asset_manifest"])
        assert manifest_path.is_relative_to(project)
        manifest = json.loads(manifest_path.read_bytes())
        assert manifest["asset_id"] == imported["asset_id"]
        assert manifest["provenance"]["origin"] == "nih_bioart"
        assert manifest["source"]["sha256"] == source_hash
    print(json.dumps({
        "check": "fresh-native-installed-wheel-offline-bioart",
        "result": "passed",
        "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "installed_package": installed,
        "entry_id": 18, "representation_id": 64, "file_id": 626860,
        "synthetic_source_sha256": source_hash,
        "operations": ["init", "fetch", "verify", "import"],
        "live_nih_transfer": False,
        "windows_execution": False,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
