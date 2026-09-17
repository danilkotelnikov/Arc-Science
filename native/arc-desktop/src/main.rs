//! Arc Science desktop: a fast, local Rust shell for the Arc Science workbench.
//!
//! It launches the local Arc Science service (unless one is already listening),
//! waits for it to be healthy, then shows the workbench in a native WebView2 window
//! branded with the Snöggo icon. No browser, no remote host — everything is local.
//!
//! Configuration (all optional, via environment):
//! - `ARC_DESKTOP_URL` — workbench URL (default `http://127.0.0.1:8080/`).
//! - `ARC_DESKTOP_SERVE` — command to start the service, space-separated (default
//!   `arc-science serve`); skipped if a service is already healthy.
//! - `ARC_DESKTOP_TIMEOUT` — seconds to wait for health (default `30`).
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::{Icon, WindowBuilder};
use wry::WebViewBuilder;

// Transparent icon variant of the logo SVG (background rect stripped) so the icon
// has no white padding — just the mark on alpha.
const SNOGGO: &[u8] = include_bytes!("../assets/snoggo-icon.svg");
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);

/// Owns the spawned service process and kills+reaps it when dropped, so no
/// early-exit path (WebView init failure, window panic) can leave it orphaned.
struct ServiceGuard(Child);

impl Drop for ServiceGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn url() -> String {
    std::env::var("ARC_DESKTOP_URL").unwrap_or_else(|_| "http://127.0.0.1:8080/".to_string())
}

fn health_url() -> String {
    let base = url();
    format!(
        "{}health",
        base.strip_suffix('/')
            .map(|s| format!("{s}/"))
            .unwrap_or(base)
    )
}

/// A timeout-bounded HTTP agent, so a stalled peer cannot hang startup forever
/// (ureq blocks indefinitely by default).
fn health_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(HEALTH_TIMEOUT))
        .build()
        .into()
}

/// Rasterize the Snöggo mark to a `size`×`size` transparent RGBA buffer, cropped to
/// its bounding box so the mark fills the square with no white (or empty) padding.
fn render_icon_rgba(size: u32) -> Option<Vec<u8>> {
    let tree = resvg::usvg::Tree::from_data(SNOGGO, &resvg::usvg::Options::default()).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size, size)?;
    let bbox = tree.root().abs_bounding_box();
    let scale = (size as f32 / bbox.width()).min(size as f32 / bbox.height());
    let tx = (size as f32 - bbox.width() * scale) / 2.0 - bbox.x() * scale;
    let ty = (size as f32 - bbox.height() * scale) / 2.0 - bbox.y() * scale;
    let transform = resvg::tiny_skia::Transform::from_row(scale, 0.0, 0.0, scale, tx, ty);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Some(pixmap.data().to_vec())
}

fn snoggo_icon() -> Option<Icon> {
    let size: u32 = 256;
    Icon::from_rgba(render_icon_rgba(size)?, size, size).ok()
}

fn is_healthy(agent: &ureq::Agent) -> bool {
    agent.get(&health_url()).call().is_ok()
}

fn wait_for_health(agent: &ureq::Agent, deadline: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < deadline {
        if is_healthy(agent) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// Start the local service from `ARC_DESKTOP_SERVE`, unless one is already healthy.
fn start_service_if_needed(agent: &ureq::Agent) -> Option<ServiceGuard> {
    if is_healthy(agent) {
        return None; // reuse an already-running local service
    }
    let command = std::env::var("ARC_DESKTOP_SERVE").unwrap_or_else(|_| "arc-science serve".into());
    let mut parts = command.split_whitespace();
    let program = parts.next()?;
    let child = Command::new(program).args(parts).spawn().ok()?;
    let guard = ServiceGuard(child);
    let timeout = std::env::var("ARC_DESKTOP_TIMEOUT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30u64);
    if !wait_for_health(agent, Duration::from_secs(timeout)) {
        eprintln!(
            "arc-science-desktop: service did not become healthy in {timeout}s; showing anyway"
        );
    }
    Some(guard)
}

fn main() -> wry::Result<()> {
    let agent = health_agent();
    // `service` is dropped (killing the child) on any early return/panic below.
    let mut service = start_service_if_needed(&agent);

    let event_loop = EventLoop::new();
    let mut window = WindowBuilder::new()
        .with_title("Arc Science")
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 860.0));
    if let Some(icon) = snoggo_icon() {
        window = window.with_window_icon(Some(icon));
    }
    let window = window.build(&event_loop).expect("window");

    let _webview = WebViewBuilder::new().with_url(url()).build(&window)?;

    event_loop.run(move |event, _target, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            service.take(); // drop the guard -> kill + reap the service
            *control_flow = ControlFlow::Exit;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn service_guard_kills_child_on_drop() {
        // A long-running direct child (no shell wrapper, so kill reaps it).
        let child = Command::new("ping")
            .args(["127.0.0.1", "-n", "30"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("spawn ping");
        let pid = child.id();
        {
            let _guard = ServiceGuard(child);
        } // dropped here -> kill + wait
        let out = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()
            .expect("tasklist");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(
            !text.contains(&pid.to_string()),
            "service child {pid} must be killed when the guard drops"
        );
    }

    #[test]
    fn health_agent_times_out_on_a_stalled_peer() {
        // A peer that accepts the connection but never answers.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                std::thread::sleep(Duration::from_secs(30));
                drop(stream);
            }
        });
        let agent = health_agent();
        let start = Instant::now();
        let ok = agent.get(format!("http://{addr}/health")).call().is_ok();
        assert!(!ok, "a stalled peer must not report healthy");
        assert!(
            start.elapsed() < Duration::from_secs(8),
            "health check must time out (~2s), not hang: took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn icon_has_no_white_padding() {
        let size = 128u32;
        let rgba = render_icon_rgba(size).expect("icon renders");
        let alpha = |x: u32, y: u32| rgba[((y * size + x) * 4 + 3) as usize];
        // No background rect: all four corners are fully transparent (not cream/white).
        for (x, y) in [(0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)] {
            assert_eq!(
                alpha(x, y),
                0,
                "corner ({x},{y}) must be transparent, not padded"
            );
        }
        // Cropped tight: the mark touches opposite edges on at least one axis.
        let row_has = |y: u32| (0..size).any(|x| alpha(x, y) > 0);
        let col_has = |x: u32| (0..size).any(|y| alpha(x, y) > 0);
        assert!(
            (row_has(0) && row_has(size - 1)) || (col_has(0) && col_has(size - 1)),
            "mark must reach opposite icon edges (no margin)"
        );
    }
}
