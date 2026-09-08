"""Build a deterministic source release with a manifest and the current wheel.

Run from an Arc Science source checkout after qualification. Only explicit release
inputs are included; environments, credentials, caches and internal review workspaces
are excluded. The unchanged original deployment is retained under legacy/.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = frozenset({
    'src', 'tests', 'scripts', 'config', 'docs', 'examples', 'workers', 'web',
    'legacy', 'evidence', 'evidence-v0.2', 'evidence-v0.3', 'evidence-v0.4',
})
FILES = frozenset({
    'README.md', 'LICENSE', 'pyproject.toml', 'requirements.lock',
    'requirements-test.lock', 'requirements-vector.lock', 'requirements-blender.lock', 'Dockerfile', 'Dockerfile.api', 'compose.yaml',
    'compose.api.yaml', '.env.example', '.dockerignore', '.gitignore',
})
EXCLUDED_PARTS = frozenset({
    '__pycache__', '.pytest_cache', '.git', '.venv', 'node_modules',
    '.superpowers', '.mypy_cache', '.ruff_cache',
})


def release_paths(version: str) -> list[Path]:
    paths = []
    wheel = ROOT / 'dist' / f'arc_science-{version}-py3-none-any.whl'
    if not wheel.is_file():
        raise ValueError(f'Build the {version} wheel before packaging')
    for path in ROOT.rglob('*'):
        relative = path.relative_to(ROOT)
        if any(part in EXCLUDED_PARTS or part.endswith('.egg-info') for part in relative.parts):
            continue
        include = (relative.as_posix() in FILES or relative.parts[0] in DIRECTORIES or path == wheel)
        if not include:
            continue
        if path.is_symlink():
            raise ValueError(f'Symlink is not a release input: {relative}')
        if not path.is_file():
            continue
        if (path.suffix in {'.pyc', '.pyo', '.token', '.db', '.sqlite', '.sqlite3'}
                or path.name == '.env' or (relative.parts[0] == 'web' and 'dist' in relative.parts)):
            continue
        paths.append(path)
    return sorted(paths, key=lambda p: p.relative_to(ROOT).as_posix())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    import tomllib
    version = tomllib.loads((ROOT / 'pyproject.toml').read_text())['project']['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Expected a three-component release version')
    output = args.output.resolve()
    if output.is_relative_to(ROOT):
        raise ValueError('Place the deployment ZIP outside the source checkout')
    paths = release_paths(version)
    entries = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in paths}
    manifest = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in entries.items())
    (ROOT / 'manifest.sha256').write_text(manifest, encoding='utf-8')
    entries['manifest.sha256'] = manifest.encode('utf-8')
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = ZipInfo('arc-science/' + name, date_time=(2026, 9, 5, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (0o100755 if name.endswith('.sh') else 0o100644) << 16
            archive.writestr(info, data, compresslevel=9)
    with ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError('Release ZIP failed its CRC check')
        for name, expected in entries.items():
            if archive.read('arc-science/' + name) != expected:
                raise ValueError(f'Release member mismatch: {name}')
    print(f'{output.name}: {len(entries)} files, {output.stat().st_size} bytes')
    print('sha256 ' + hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
