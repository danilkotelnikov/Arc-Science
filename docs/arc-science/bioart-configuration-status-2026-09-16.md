---
title: BioArt configuration and Windows status
date: 2026-09-16
status: Unsupported on Windows by design; runs on a POSIX host
---

# BioArt configuration status

**On this Windows machine BioArt cannot be enabled**, and the application already
says so cleanly: `POST /api/bioart/search` returns **HTTP 409** —
"BioArt cache/import requires POSIX no-follow directory/file primitives; Windows
Python provider support is unavailable" (verified live against the running server).
The Memory/BioArt workspaces still load; the BioArt operations simply refuse rather
than degrade unsafely.

## Why (not a misconfiguration)

The NIH BioArt cache and importer depend on POSIX filesystem and process primitives
that Windows Python does not provide:

- `bioart/cache.py` — `fcntl` advisory locks, `O_NOFOLLOW`, directory file descriptors
- `bioart/isolation.py`, `worker.py` — POSIX signals and process groups
- `bioart/deadline.py` — POSIX main-thread network deadlines
- `bioart/web.py` guards `os.name != 'posix'` and returns the 409 above

These are load-bearing safety primitives (no-follow, atomic promotion, owned child-tree
termination), not incidental. Removing the guard would weaken the contract without
supplying equivalents, so it is refused rather than faked.

## To actually run BioArt (POSIX host: Linux / WSL / macOS)

1. Every operation starts with **egress disabled**. The workspace searches the verified
   local cache; a fresh cache result never touches the network.
2. Populate the cache through the installed CLI (trusted package, sanitized environment,
   separate POSIX process group), e.g. `arc-science` BioArt fetch with the visible NIH
   network checkbox, which authorizes **exactly one** search/inspect/fetch and resets.
3. All BioArt routes require the local operator token, including previews and downloads.
4. A parsed "Public Domain" label, a matching hash and a safe preview do **not** establish
   reuse rights or scientific correctness.

## Windows-native path (deferred, large)

Native Windows intake needs the reviewed handle-based filesystem boundary, process-owned
locking, bounded HTTP in a killable worker (Windows **Job Objects** for child-tree
termination — the native `arc-science` crate already links this feature), crash-safe
receipt/source publication, and a Windows-capable validated SVG import path, tested on a
real Windows runner (junction/reparse/alternate-stream/device paths, long paths,
concurrent writers, interrupted promotion). This is the scoped effort from the
`review-and-architecture` and 2026-09-11 qualification notes; it is not attempted here.
