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

const SNOGGO: &[u8] = include_bytes!("../assets/snoggo.svg");

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

/// Rasterize the Snöggo SVG to a 256×256 RGBA window icon.
fn snoggo_icon() -> Option<Icon> {
    let tree = resvg::usvg::Tree::from_data(SNOGGO, &resvg::usvg::Options::default()).ok()?;
    let size: u32 = 256;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size, size)?;
    let svg = tree.size();
    let scale = (size as f32 / svg.width()).min(size as f32 / svg.height());
    let transform = resvg::tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Icon::from_rgba(pixmap.data().to_vec(), size, size).ok()
}

fn is_healthy() -> bool {
    ureq::get(&health_url()).call().is_ok()
}

fn wait_for_health(deadline: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < deadline {
        if is_healthy() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// Start the local service from `ARC_DESKTOP_SERVE`, unless one is already healthy.
fn start_service_if_needed() -> Option<Child> {
    if is_healthy() {
        return None; // reuse an already-running local service
    }
    let command = std::env::var("ARC_DESKTOP_SERVE").unwrap_or_else(|_| "arc-science serve".into());
    let mut parts = command.split_whitespace();
    let program = parts.next()?;
    let child = Command::new(program).args(parts).spawn().ok()?;
    let timeout = std::env::var("ARC_DESKTOP_TIMEOUT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30u64);
    wait_for_health(Duration::from_secs(timeout));
    Some(child)
}

fn main() -> wry::Result<()> {
    let mut service = start_service_if_needed();

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
            if let Some(child) = service.as_mut() {
                let _ = child.kill();
            }
            *control_flow = ControlFlow::Exit;
        }
    });
}
