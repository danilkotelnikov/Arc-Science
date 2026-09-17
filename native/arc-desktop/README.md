# arc-desktop

A fast, local **Rust** desktop client for the Arc Science workbench. It launches the
local Arc Science service (unless one is already listening), waits for it to be
healthy, and renders the workbench in a native WebView2 window branded with the
Snöggo icon. No browser tab, no remote host — everything runs on the machine.

Why a thin Rust shell rather than a rewritten GUI: the workbench (Molecules, BioArt,
Research, Memory) is already a compiled, accessible HeroUI application served by the
local service. The desktop client gives it a native window, a real app icon, and a
single-process lifecycle, while staying small and quick to start.

## Run

```
cargo run --release --manifest-path native/arc-desktop/Cargo.toml
```

Configuration (all optional, via environment):

| Env | Default | Meaning |
| --- | --- | --- |
| `ARC_DESKTOP_URL` | `http://127.0.0.1:8080/` | workbench URL to display |
| `ARC_DESKTOP_SERVE` | `arc-science serve` | command to start the service; **skipped if one is already healthy** |
| `ARC_DESKTOP_TIMEOUT` | `30` | seconds to wait for `/health` |

The service is the existing Python app (`arc-science serve` / `python -m arc_science
serve`). Set `ARC_MEMORY_WORKER` before launch to enable the Memory workspace. The icon
is `assets/snoggo.svg`, rasterized to RGBA at startup with `resvg`.
