# Arc Science 0.6.0 development

Version 0.6.0 adds the NIH BioArt workflow to the HeroUI application. It does not
change the frozen 1DQJ example, the scientific calculation code, or the Rust
launcher protocol.

## BioArt workspace

The new workspace supports the full retained provider sequence: search, inspect,
select a representation and format, fetch, preview or download the verified
source, and import an eligible SVG. It shows the NIH entry identity, source link,
creator, credit, collection, citation, license label, available source variants,
receipt digest, source hashes, selected group/file IDs, byte count, eligibility,
and known limits.

The default selection is a compatible neutral-labelled SVG. Users can select SVG,
PNG, AI, or EPS and can override the representation. SVG and PNG can be previewed
after validation; AI and EPS remain download-only. Only eligible SVG files can be
imported. The original bytes are never recolored during intake.

BioArt and Research share one local operator token in React state. Switching
workspaces keeps current forms and selections mounted, but the token is not stored
in browser storage. All BioArt API routes require it, including previews and
downloads.

## Network and evidence boundary

Every operation starts with egress disabled. A fresh cache result never starts a
network process. When the provider reports a missing or stale cache entry, the
visible NIH network checkbox permits exactly one action and resets immediately.
The service populates the cache through the existing BioArt CLI, launched from the
trusted installed package with a sanitized environment and a separate POSIX
process group. Timeout, cancellation, failure, and normal completion all finalize
that owned group. Identical concurrent misses share one in-flight population;
unrelated live misses are rejected rather than queued. Each new population
rechecks the cache before egress. Canceling one joined request preserves other
identical waiters; canceling the last waiter stops and awaits the population. The
service then opens the cache without egress and verifies the returned metadata,
receipt, and source bytes before responding to the browser.

The web API does not expose absolute cache paths. Receipt and file endpoints bind
64-character receipt digests to project-local files, recheck source size and
SHA-256, and send restrictive response headers. An import returns a project-relative
manifest path.

This increment was tested with source-derived reduced NIH metadata and explicitly
synthetic file bytes. No live NIH vector was downloaded. A parsed `Public Domain`
label, a matching hash, and a safe preview do not establish reuse rights or
scientific correctness. Windows BioArt remains unsupported because the provider's
cache and importer require POSIX no-follow filesystem primitives.

## Compatibility

Use a fresh 0.6 data directory. Keep a matching historical deployment for older
capsules. The 0.5 migration record remains the source for the frozen molecular
asset inclusion policy. Build the web application before producing a wheel so the
compiled BioArt workspace replaces the previous static bundle.
