# Migrating to Arc Science 0.4.0

Use a fresh application environment and data directory for the new release. Keep old mission data and capsules with the matching verifier. The archive retains the unchanged 0.3.0 deployment under `legacy/Arc_Science_0.3.0_Deployment.zip`, alongside the original 0.2.0 deployment.

The research capsule format remains `arc-research-capsule/2`, but verification binds the Arc runtime version. A 0.3.0 capsule requires its 0.3.0 verifier. There is no automatic history migration; do not rewrite runtime metadata or old receipts to make a capsule pass a newer verifier.

The vector workflow is a separate operator CLI. It does not grant a mission model access to files, arbitrary Python, Blender scripts or account credentials. Existing mission tools and the older atomic/C-alpha worker retain their contracts.

1. Preserve old deployment archives, capsules and data directories.
2. Install the 0.4.0 wheel with `requirements.lock`, then run `arc-science validate`.
3. Add `requirements-vector.lock` when using vector imports. See [the rendering guide](vector-rendering.md) for the separate, pinned Blender environment.
4. Start new missions in a new directory, for example `arc-science serve --data ./data-v0.4`.
5. Keep complete vector asset and render directories, including `inputs/`, records, logs and Blender scenes. Copies are verifiable with the same converter environment.

Vector proofs are regenerated during verification. Converter versions, native rendering libraries and fonts can affect pixels; a mismatch is a failed integrity/reproduction check and should be investigated. Render verification checks retained outputs without re-executing Blender. Neither check authenticates rights or establishes scientific validity.
