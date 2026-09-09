# NIH BioArt provider

The `bioart` CLI inspects NIH metadata, selects an entry-bound representation,
preserves original files with hashes and a receipt, and imports eligible SVGs
through the existing immutable vector contract. This uses observed public website
HTML and file routes, **not a documented stable public API**.

```sh
arc-science bioart search antibody --project ./project --allow-egress
arc-science bioart inspect 18 --project ./project --allow-egress
arc-science bioart fetch 18 --project ./project --allow-egress
arc-science bioart fetch 18 --representation 64 --format svg --project ./project --allow-egress
arc-science bioart verify /absolute/project/.arc-science/bioart/DIGEST.receipt.json
arc-science bioart import /absolute/project/.arc-science/bioart/DIGEST.receipt.json --project ./project
```

`fetch` defaults to SVG. Without `--representation`, it first discards groups
that do not contain the requested format, then chooses the first compatible group
whose caption explicitly contains a neutral label: `grey`, `gray`, `greyscale`,
`grayscale`, `black-and-white`, `black and white`, or `blackwhite`. Labels are
matched case-insensitively as words; stable ties retain website source order. If
no compatible neutral caption exists, the first compatible group in source order
is used. If no group contains the requested format, the command stops rather than
substituting PNG or another format.

Use `--representation` to select a group explicitly and `--format` to request
SVG, PNG, AI, or EPS manually. An explicit group remains authoritative: if it does
not contain that format, fetch stops and does not switch groups. The verified
receipt reports the actual selected group ID, file ID, caption, format, and source
hash. A neutral caption is retained provider metadata, not pixel analysis, an
image-quality judgment, or evidence of scientific validity.

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

The synchronous network path is a POSIX **main-thread CLI** capability. The default
owned HTTPX transport runs in a fresh Python subprocess, launched directly without
a shell. One parent monotonic deadline includes process/interpreter startup, HTTP
setup, DNS, headers, body, retries and result publication. On expiry or cancellation
the parent kills and reaps the child before removing its private temporary directory.
This terminates a child even when native DNS code defers Python signal delivery.
The scope temporarily maps SIGTERM to cancellation and restores the old handler;
SIGINT/SIGTERM/alarm delivery is deferred around process-handle acquisition and
reaping so cancellation cannot orphan a just-launched child.

Results cross this boundary as bounded regular files, read only after child exit;
there is no potentially blocking pipe receive. Temporary transfer storage is at
most the configured response limit plus 8 KiB for request/result metadata. Streams
and result files are checked against their bounds, and stdout/stderr are discarded.
The cache has its separate configured budget. No transport thread or child remains
after timeout, Ctrl-C, SIGTERM, malformed output or transfer-limit failure.

Inside the worker, a monotonic deadline and scoped SIGALRM additionally interrupt
Python socket waits. Retries share the budget, each HTTP request receives its
remaining timeout, and identity body chunks are checked without 64-KiB buffering.
Explicitly injected HTTPX clients use this in-process path for trusted testing or
integration; arbitrary native code inside injected transports is **not** covered
by the owned-production process-isolation guarantee. Injection requires no active
real-time alarm and an unblocked SIGALRM. All network paths reject worker-thread
calls; cache-only operations do not require the signal/deadline scope. No live
BioArt transfer was used to test these guarantees; native-block and socketpair
fixtures are entirely local.

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
files, a process-owned advisory writer lock, atomic promotion, and immutable
source/receipt writes. The lock inode may persist, but the kernel releases its
ownership when a writer exits. After acquiring that lock, a later writer removes
only Arc-private interrupted-write files matching `.write-` plus 32 hexadecimal
characters. It never removes a promoted source or receipt. The budget includes
temporary write bytes and refuses growth beyond budget instead of silently
evicting provenance. These filesystem primitives follow the existing POSIX vector
importer; Windows Python file/import support is not certified here.

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
AI/EPS originals are download-only and never executed.

## HeroUI workspace and authenticated routes

The BioArt workspace uses the local operator token and keeps it in page memory,
shared with Research. Search, inspection, fetch, preview, original download, and
SVG import routes all require that token. The browser never receives a cache path.
It receives a receipt digest, authenticated preview/download URLs, source and
source-page hashes, selected entry/group/file IDs, eligibility fields, and the
retained provenance text.

Search, inspection, and fetch first call the provider with egress disabled. A
fresh cache hit returns without starting another process. On the specific
missing-or-stale-cache error, a checked network box permits one action and is reset
before that action begins. The service starts the same BioArt CLI through a new
POSIX process group from the trusted installed package, in a sanitized environment
that contains only locale and `ARC_BIOART_*` settings. It does not import from or
run with the writable project as its working directory. Cancellation, normal
completion, helper failure, or the total deadline finalizes the whole process
group and waits for it before the request ends. Identical concurrent cache misses
join one in-flight result. An unrelated live miss receives a conflict response
instead of waiting in a queue, and every new population rechecks the cache before
egress. The service then reopens the cache with egress disabled and re-verifies the
result; CLI stdout and absolute source paths are never forwarded to the browser.

Search and inspection receive the configured per-request timeout plus five
seconds. Fetch receives twice that timeout plus five seconds because it may need
one metadata request and one file request. The provider's tighter byte, retry, and
per-request limits still apply. This web path is POSIX-only, like the cache/import
primitives. Live NIH service behavior and actual NIH vector compatibility remain
unqualified until a consented live test is recorded.

SVG and PNG previews are served only after receipt and source-byte verification,
with same-origin authentication and a restrictive content-security policy.
SVG, PNG, AI, and EPS originals can be downloaded after the same check. Only an
eligible SVG can enter the immutable vector importer. The UI keeps the NIH source
link, credit, license label, hashes, and the explicit rights/scientific-validity
limits next to the selected asset.

Fixtures are deliberately labeled: entry 18 is reduced source-derived Flight data;
the seven-result search fixture is a separate reduced browser DOM observation.
Synthetic SVG/PNG/AI/EPS test bytes and HTTP MockTransport responses do not establish
live vector access, NIH-file rendering compatibility, or scientific validity.
