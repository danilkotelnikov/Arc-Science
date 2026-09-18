//! Native Rust host for the local Arc Science workbench. See README for lifecycle limits.
mod startup;
use startup::{Config, start_service};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::{Icon, WindowBuilder};
use wry::WebViewBuilder;

const SNOGGO: &[u8] = include_bytes!("../assets/snoggo-icon.svg");

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

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let check_only = args.as_slice() == ["--check-startup"];
    if !args.is_empty() && !check_only {
        return Err("Usage: arc-science-desktop [--check-startup]; configure via ARC_DESKTOP_* environment variables".into());
    }
    let config = Config::from_env()?;
    let mut service = start_service(&config)?;
    if check_only {
        println!(
            "Arc Science readiness verified; service {}",
            if service.is_some() {
                "owned (shutdown requested on exit)"
            } else {
                "reused (left running)"
            }
        );
        return Ok(());
    }

    // No event loop, window or WebView is created until local readiness passes.
    let event_loop = EventLoop::new();
    let mut window = WindowBuilder::new()
        .with_title("Arc Science")
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 860.0));
    if let Some(icon) = snoggo_icon() {
        window = window.with_window_icon(Some(icon));
    }
    let window = window
        .build(&event_loop)
        .map_err(|e| format!("Cannot create desktop window: {e}"))?;
    let origin = config.url.clone();
    let download_origin = origin.clone();
    let _webview = WebViewBuilder::new()
        .with_url(&config.url.display)
        .with_navigation_handler(move |target| origin.allows(&target))
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .with_download_started_handler(move |target, _| download_origin.allows(&target))
        .build(&window)
        .map_err(|e| format!("Cannot initialize desktop WebView: {e}"))?;
    event_loop.run(move |event, _target, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            service.take();
            *control_flow = ControlFlow::Exit;
        }
    });
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("arc-science-desktop: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
