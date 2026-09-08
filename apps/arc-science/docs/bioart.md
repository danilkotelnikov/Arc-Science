# NIH BioArt provider

The `bioart` CLI inspects NIH metadata, selects an entry-bound representation,
preserves original files with hashes and a receipt, and imports eligible SVGs
through the existing immutable vector contract. This uses observed public website
HTML and file routes, **not a documented stable public API**.

```sh
arc-science bioart search antibody --project ./project --allow-egress
arc-science bioart inspect 18 --project ./project --allow-egress
arc-science bioart fetch 18 --representation 64 --format svg --project ./project --allow-egress
arc-science bioart verify /absolute/project/.arc-science/bioart/DIGEST.receipt.json
arc-science bioart import /absolute/project/.arc-science/bioart/DIGEST.receipt.json --project ./project
```

The examples describe the interface; no live file transfer was verified in this
development session. Network approval for the prior vector transfer was cancelled,
and no alternate-host, browser-download, or extraction workaround was attempted.

Omit `--allow-egress` to require a fresh verified cache entry; a miss or expired
metadata entry fails explicitly. The provider does not silently refresh, mirror
the catalog, follow redirects, or start a browser. HTTP 401/403 stops immediately.
Transient 429/500/502/503/504 and transport failures have at most two retries.
Retry-After is honored only within five seconds; a larger or invalid value stops
and asks for a later explicit attempt. Compressed responses are rejected; requests
ask for identity encoding so the streaming bound is not bypassed by decompression.

The captured initial search HTML is a client-rendered shell, so ordinary search
may produce a schema-drift error. Inspecting a known entry ID works on the captured
server HTML. An explicit, offline browser-DOM intake is also available:

```sh
arc-science bioart search antibody --project ./project --search-html ./rendered-search.html
```

This reads only a bounded regular local file, extracts canonical entry links,
and stores its bytes/hash, the supplied query, derived source-page URL, timestamp,
and hits in a separate snapshot record. It is labeled
`operator_supplied_browser_snapshot`; neither the URL nor HTML is authenticated.
It is not mixed into network metadata indexes. Do not provide `--allow-egress`
with this offline option. Obtaining a browser snapshot is a separate explicit
operator action, never an automatic response to access denial.

## Native configuration bridge

The native launcher must export the following environment variables to the Python
worker. All are optional; missing values use these defaults. Integer strings must
be canonical nonnegative decimal, with no whitespace, sign, fraction, or exponent.
Unknown `ARC_BIOART_*` settings are rejected.

| Environment variable | Default | Accepted range |
| --- | --- | --- |
| `ARC_BIOART_CACHE_DIR` | `.arc-science/bioart` | Strict descendant of `--project`; relative to project or absolute within it; no `..` |
| `ARC_BIOART_MAX_METADATA_BYTES` | 8388608 | 1–67108864 |
| `ARC_BIOART_MAX_FILE_BYTES` | 33554432 | 1–134217728 |
| `ARC_BIOART_MAX_CACHE_BYTES` | 268435456 | 1–4294967296 |
| `ARC_BIOART_METADATA_TTL_SECONDS` | 86400 | 1–604800 |
| `ARC_BIOART_TIMEOUT_SECONDS` | 30 | 1–120 |
| `ARC_BIOART_MAX_RETRIES` | 2 | 0–2 |

`BioArtSettings.from_environment(project)` is the shared CLI configuration reader.
The native worker should run with its project as working directory and export its
resolved absolute cache path. `verify RECEIPT` deliberately derives the cache root
from the supplied receipt's parent, so it can verify a receipt without knowing the
project layout; it still honors all numeric environment limits and never networks.
No environment setting grants egress: only explicit `--allow-egress` does.

## Cache, import, and limits

Source-page bytes and original file bytes use SHA256-derived names. Receipts use
the schema `arc-bioart-asset/1`, with a SHA256-derived receipt filename. Each receipt
binds title, entry URL/ID, collection, creator, credit, license, citation, group and
caption, actual format/file ID, source-page hash, retrieval time, file hash/size,
and eligibility. Verification reparses the retained page and rechecks all bindings
and hashes independently. Changed metadata creates a new receipt while the old
receipt remains verifiable against its original page. Hashes provide integrity,
not remote authenticity or a cryptographic NIH signature.

The flat cache uses no-follow directory/file descriptors, exclusive temporary
files, a single-writer lock, atomic promotion, and immutable source/receipt writes.
The budget includes temporary write bytes. It refuses growth beyond budget instead
of silently evicting provenance. A process killed during a write may leave a
`.writer-lock` or orphaned artifact; the next write fails explicitly. An operator
must confirm no writer is active before recovering a stale lock. No recovery or
deletion occurs automatically. These filesystem primitives follow the existing
POSIX vector importer; Windows Python file/import support is not certified here.

Only the exact entry license `Public Domain` permits fetch/import. Missing license
is schema drift; unknown/restricted text is retained by inspect and requires
operator review, with fetch/import blocked. There is no unchecked override.
Rights and scientific-validity assertions remain false in receipts and vector
manifests. BioArt images are schematics, not coordinate-derived structures.

SVG is never inlined or rendered during fetch. The existing restrictive SVG
validator determines eligibility; over-16-MiB sources or dimensions above one
million pixels remain download-only. Unsupported SVG constructs are preserved
but are not passed to a permissive converter. The optional vector dependencies
are needed for safe SVG validation and later proof rendering. SVG import checks
the receipt's source hash again on the exact bytes handed to the converter, then
creates an immutable `arc-vector-asset/1` bundle with origin `nih_bioart`, canonical
entry URL, credit/citation and receipt digest. Both host and standalone worker
validators recognize that origin. Existing BioRender validation is unchanged.

PNG must decode successfully within 2048×2048 pixels and is preview-eligible only;
the current vector importer accepts SVG/PDF, so PNG import is explicitly unavailable.
AI/EPS originals are download-only and never executed. Neither a new authenticated
web service route nor a HeroUI workspace is included in this increment.

Fixtures are deliberately labeled: entry 18 is reduced source-derived Flight data;
the seven-result search fixture is a separate reduced browser DOM observation.
Synthetic SVG/PNG/AI/EPS test bytes and HTTP MockTransport responses do not establish
live vector access, NIH-file rendering compatibility, or scientific validity.
