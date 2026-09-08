#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps --no-build-isolation .
.venv/bin/python -m arc_science.cli validate --output ./local-verification.json
exec .venv/bin/python -m arc_science.cli serve --data ./data
