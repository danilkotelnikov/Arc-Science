# Local molecular rendering in the workbench

The Molecules workspace retains the public, frozen 1DQJ example and adds authenticated
rendering of your own PDB/mmCIF coordinate files. The service calls the existing
coordinate preparation, Blender views, white collage and provenance pipeline.
It runs locally; this workflow does not fetch structures or call model providers.

## Server configuration

Use an interpreter with Arc Science's existing structure/vector dependencies and a
Blender Python runtime that can import `bpy`, NumPy, SciPy and scikit-image in isolated
mode. Configure it on the server before starting Arc Science:

```powershell
$env:PYTHONUTF8 = '1'
$env:ARC_MOLECULAR_BLENDER_PYTHON = 'C:\path\to\blender-env\Scripts\python.exe'
$env:ARC_SVG2PNG = (Resolve-Path 'native\arc-svg\target\release\arc-svg2png.exe').Path
python -m arc_science serve --data .\local-data
```

Run from the repository root after installing the application. If Cairo is available,
`ARC_SVG2PNG` is unnecessary; otherwise build the existing converter with
`cargo build --release --locked --manifest-path native/arc-svg/Cargo.toml`.
The interpreter path is a server setting; requests cannot choose an executable.
For the Rust desktop shell, launch it with the same environment.

## Use

1. Open Molecules and expand **Render your structure locally**.
2. Enter the local operator token (obtain it with `python -m arc_science token --data
   .\local-data`) and load renderer availability and recent jobs.
3. Select a `.pdb`, `.cif` or `.mmcif` file of at most 750,000 bytes and enter the
   antibody and antigen author chains. Select the deposited biological assembly
   explicitly when needed; the default is the asymmetric unit.
4. Start the render. One job runs at a time. Cancel an active job from the panel.
5. Inspect the completed collage and download its PNG, SVG, contact table, caption,
   scene, checks and manifest. Return to the frozen example at any time.

The default settings remain 1400 pixels, 96 samples and seed 23. Advanced settings
are bounded to protect the local workstation. Uploaded sources, job metadata and
render outputs remain in the service data directory. Up to 100 jobs are retained;
the panel lists the most recent 20. At the limit, stop the service, archive old
job directories outside its `molecular` directory, and restart before adding jobs.
Credentials stay in page memory and authorization
headers, never in artifact URLs or browser storage.

Completed downloads are checked against recorded sizes and SHA-256 hashes. Failed,
cancelled and interrupted jobs do not publish completed artifacts. Restarting the
service marks unfinished persisted jobs interrupted; it does not silently restart
computation. The service assumes one worker per private data directory, as before.

## Interpretation and qualification

Contacts are heavy-atom geometric proximity, not hydrogen bonds or measured affinity.
The surface is an illustrative Gaussian envelope, not a solvent-excluded surface.
A successful render and intact hashes do not provide independent visual review,
scientific validity or publication authorization.

Windows retains the filesystem and process-isolation limits described in the
[Windows port record](windows-native-port-2026-09-18.md). A dedicated Blender
environment is preferable to the retained workstation environment, which emits a
NumPy ABI warning. The verification record of this increment is in the git history
(`docs/arc-science/molecular-workbench-qualification-2026-09-18.md` at commit f31a498).
