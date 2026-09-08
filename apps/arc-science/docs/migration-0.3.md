# Migrating to Arc Science 0.3.0

Start 0.3.0 with a new data directory. Keep the previous service stopped while copying or archiving its database, and preserve its matching wheel and source with its capsules. There is no automatic in-place history migration in this release.

Version 0.3.0 exports `arc-research-capsule/2`. The verifier requires the matching release and numerical contract and rejects metadata that claims established scientific validity or reexecuted live models.

The rejection is deliberate. Version 0.3 adds a required closed tool-schema contract, binds recorded contexts to complete evidence objects, introduces visual-review request and state fields, and changes numerical receipts to support stable figure rendering. Reinterpreting old history through those defaults could change request or scientific digests. Earlier numerical receipts could also opt out of replay through a receipt flag; the new verifier uses trusted tool identities instead.

To upgrade:

1. Export and preserve existing capsules with their original verifier and source. Keep the original database unchanged.
2. Install the 0.3.0 wheel in a fresh environment and run `arc-science validate`.
3. Create a new directory, for example `arc-science serve --data ./data-v0.3`.
4. Configure current provider IDs and server-side credentials. Recheck connector schema pins against the deployed endpoint.
5. Recreate a mission from its original goal and input dataset when new evidence is needed. Retain a human-readable link to its earlier capsule; do not rewrite old receipts to resemble a new run.

An unchanged copy of the supplied deployment is included under `legacy/`; it contains the original matching source and wheel. The source ZIP also retains historical verification records under `evidence-v0.2/`. Its current fixture and release record use 0.3.0. Capsule checksums establish consistency within the supplied archive; they do not authenticate authorship or retroactively validate old scientific conclusions.
