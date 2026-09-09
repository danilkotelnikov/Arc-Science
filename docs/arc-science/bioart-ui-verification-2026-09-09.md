# Arc Science 0.6 BioArt workspace verification

Date: 2026-09-09  
Reviewed source: `ef16a7b64de7cc04889b4f84027e346bdef141f0`

## Verified scope

This increment adds the authenticated HeroUI BioArt workspace and hardens its
cache-population boundary. The web service loads its CLI from the trusted package,
passes only locale and `ARC_BIOART_*` settings, finalizes the helper process group
on every exit path, and reopens the cache without egress before returning data.

Network permission is action-specific and resets before use. Search/inspection
and fetch have independent controls. Identical concurrent misses join one
population; an unrelated live miss is rejected instead of queued. Canceling one
joined request preserves the others, while canceling the last waiter stops and
awaits the population.

The flat POSIX cache now uses a process-owned advisory lock. A crashed process
cannot leave the cache permanently locked, and recovery removes only Arc-private
interrupted-write names after acquiring the lock.

## Recorded checks

| Check | Result |
| --- | --- |
| Complete Python application suite | 580 passed; 6 explicitly skipped Blender-runtime integrations |
| BioArt-focused Python suite | 112 passed |
| HeroUI and packaging tests | 15 passed |
| Production web build | `index-BJv1Ui3L.js`; `index-BtWlx6y0.css` |
| Concurrency stress | 20/20 owner/join/reject iterations passed |
| Cancellation stress | 20/20 owner-cancel and final-waiter iterations passed |
| Independent code review | No Critical or Important findings; ready to merge locally |
| Clean-snapshot wheel check | 20 public example assets and current compiled UI passed packaged HTTP/hash checks |

The clean-snapshot wheel is `arc_science-0.6.0-py3-none-any.whl`, SHA-256
`01287f168ad6485c8cf12e63ddaa0d89c56e5f3f846cf2c4b73f04fcf06a12b5`.

The frozen 1DQJ collage remains byte-identical at SHA-256
`7394f162dca9bba20ca985a2cd43473da2c9df7d88be5e39acaec81f30f598d9`.
Its retained source coordinate file remains SHA-256
`176f9d155fdf18650f8221007511dbde90f0fc19de9462d59515ce590bb30250`.

## Qualification limits

- No live NIH vector transfer was performed. Tests use retained NIH-derived
  metadata and explicitly synthetic file bytes.
- Managed-browser access to the local application was blocked with
  `ERR_BLOCKED_BY_CLIENT`; the compiled UI and interactions are tested, but its
  browser pixels are not qualified in this runtime.
- The Rust toolchain is absent from this restored runtime. The retained launcher
  runs, but it was not rebuilt for this commit here. Windows and macOS source/CI
  paths remain unexecuted locally.
- The BioArt cache/import provider still requires qualified POSIX filesystem
  primitives; Windows BioArt intake is not claimed.
- Six Blender tests require an explicitly configured official `bpy` or Blender
  runtime and remain skipped. The accepted 1DQJ figure is unchanged.
- GitHub branch creation was last rejected by the installed integration with HTTP
  403. This checkpoint is local; no remote branch or repository was changed.

File validation, a parsed license label, visual quality, and receipt integrity do
not establish scientific correctness or publication rights. Those judgments stay
explicitly outside the automated intake claim.
