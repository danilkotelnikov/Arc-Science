//! Native Rust host for the local Arc Science workbench. See README for lifecycle limits.
mod external;
mod startup;
use startup::{Config, start_service};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, WindowBuilder};
use wry::WebViewBuilder;

const SNOGGO: &[u8] = include_bytes!("../assets/snoggo-icon.svg");

/// Shell events delivered to the event loop from WebView callbacks.
enum Shell {
    /// A download finished; the page is told so it can show the outcome, because
    /// the WebView hosts no download UI of its own here.
    DownloadFinished {
        file: Option<String>,
        folder: Option<String>,
        success: bool,
    },
}

/// A JavaScript string literal (or `null`) for text that came from the file system.
fn js_string(value: Option<&str>) -> String {
    let Some(value) = value else {
        return "null".into();
    };
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() || c == '\u{2028}' || c == '\u{2029}' => {
                out.push_str(&format!("\\u{{{:x}}}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
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

/// Browser profile (cache, storage) under the user's local application data, so it
/// is never written beside the executable, which an installed copy cannot write.
fn profile_directory() -> Option<std::path::PathBuf> {
    let base = std::env::var_os(if cfg!(windows) {
        "LOCALAPPDATA"
    } else {
        "HOME"
    })?;
    let directory = std::path::PathBuf::from(base)
        .join(if cfg!(windows) {
            "ArcScience"
        } else {
            ".arc-science"
        })
        .join("webview");
    match std::fs::create_dir_all(&directory) {
        Ok(()) => Some(directory),
        Err(error) => {
            eprintln!("arc-science-desktop: using the default browser profile location ({error})");
            None
        }
    }
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
    let event_loop = EventLoopBuilder::<Shell>::with_user_event().build();
    let shell = event_loop.create_proxy();
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
    let mut context = wry::WebContext::new(profile_directory());
    // Every downloadable URL is same-origin by construction because navigation is;
    // the download itself is left to the WebView and only its outcome is reported.
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(&config.url.display)
        .with_navigation_handler(move |target| origin.allows(&target))
        .with_download_completed_handler(move |_uri, path, success| {
            let text = |p: Option<&std::path::Path>| p.and_then(|p| p.to_str()).map(str::to_owned);
            let _ = shell.send_event(Shell::DownloadFinished {
                file: text(
                    path.as_deref()
                        .and_then(|p| p.file_name())
                        .map(std::path::Path::new),
                ),
                folder: text(path.as_deref().and_then(|p| p.parent())),
                success,
            });
        })
        .with_new_window_req_handler(|target, _| {
            match external::external_target(&target) {
                Some(url) => {
                    if let Err(error) = external::open(&url) {
                        eprintln!(
                            "arc-science-desktop: cannot open {url} in the system browser: {error}"
                        );
                    }
                }
                None => eprintln!("arc-science-desktop: refused a new window for {target}"),
            }
            wry::NewWindowResponse::Deny
        })
        .build(&window)
        .map_err(|e| format!("Cannot initialize desktop WebView: {e}"))?;
    event_loop.run(move |event, _target, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                service.take();
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(Shell::DownloadFinished {
                file,
                folder,
                success,
            }) => {
                let script = format!(
                    "window.dispatchEvent(new CustomEvent('arc-download', {{detail: {{file: {}, folder: {}, success: {success}}}}}))",
                    js_string(file.as_deref()),
                    js_string(folder.as_deref())
                );
                if let Err(error) = webview.evaluate_script(&script) {
                    eprintln!("arc-science-desktop: cannot report a download to the page: {error}");
                }
            }
            _ => {}
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
    fn download_report_is_a_safe_javascript_literal() {
        assert_eq!(js_string(None), "null");
        assert_eq!(js_string(Some("1dqj-collage.svg")), "\"1dqj-collage.svg\"");
        assert_eq!(
            js_string(Some(r"C:\Users\a b\Downloads")),
            r#""C:\\Users\\a b\\Downloads""#
        );
        assert_eq!(
            js_string(Some("x\"</script>\n\u{2028}\u{7}")),
            r#""x\"</script>\n\u{2028}\u{7}""#
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
        // The puddles inside the mark are white and opaque, not see-through.
        let pixel = |x: u32, y: u32| {
            let i = ((y * size + x) * 4) as usize;
            (rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])
        };
        for (x, y) in [(40, 35), (32, 32), (70, 95)] {
            assert_eq!(
                pixel(x, y),
                (255, 255, 255, 255),
                "puddle at ({x},{y}) must be white"
            );
        }
        assert_eq!(pixel(64, 64).3, 255, "the mark itself is opaque");
    }
}
