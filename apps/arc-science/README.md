# Arc Science 0.6.0 · development

This is the reviewed Arc Science application, imported into the existing Vedix
repository. The [repository guide](../../README.md) has current installation,
workbench and test commands. The [0.6 migration notes](docs/migration-0.6.md)
describe the public example, packaging, provenance and qualification boundaries.

```bash
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install .
arc-science serve --data ./data
# In another activated terminal:
arc-science token --data ./data
```

Open http://127.0.0.1:8080/ for the compiled HeroUI workbench. The unchanged
diagnostic operations remain available at /diagnostics. The 1DQJ example is
public; BioArt, Research missions, and artifacts require the local operator token.
The BioArt workspace searches the verified cache by default. Its network checkbox
authorizes only the current search, inspection, or fetch request.

Use a fresh data directory. Scientific claims remain exploratory and publication
is not authorized. Historical illustration acceptance does not imply live-provider
qualification, new Blender execution or browser-layout verification.

## Development

```bash
python -m pip install '.[test]'
cd web
npm ci
npm test
npm run build
cd ..
python -m pytest -q -rs
python -m pip wheel --no-deps . --wheel-dir dist
```

Build before packaging a wheel after frontend changes; npm copies the compiled
output into the package. Native Blender tests need a separately configured
runtime and are not invoked in normal CI.

The [original 0.4 guide](docs/source-readme-0.4.md), historical locks and Docker
files are preserved references, not a claim that those deployments were newly
qualified. Provider settings and runtime tools remain compatible; use current
source installation rather than a historical wheel filename.
