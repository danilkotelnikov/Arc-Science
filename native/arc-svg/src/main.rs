//! `arc-svg2png`: rasterize an SVG to a PNG with resvg + system fonts.
//!
//! A small, native, Cairo-free replacement for the `cairosvg` dependency in the
//! molecular collage compositor, so the white four-panel figure renders on Windows.
//! Usage: `arc-svg2png <in.svg> <out.png> [width_px]`. Embedded raster `<image>`
//! data URIs and text (system fonts) are supported.
use std::path::PathBuf;

use resvg::{tiny_skia, usvg};

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        return Err("usage: arc-svg2png <in.svg> <out.png> [width_px]".into());
    }
    let input = PathBuf::from(&args[0]);
    let output = PathBuf::from(&args[1]);
    let data = std::fs::read(&input).map_err(|e| format!("read {}: {e}", input.display()))?;

    let mut options = usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = usvg::Tree::from_data(&data, &options).map_err(|e| format!("parse svg: {e}"))?;

    let svg_size = tree.size();
    let target_w = args
        .get(2)
        .and_then(|s| s.parse::<f32>().ok())
        .filter(|w| *w > 0.0)
        .unwrap_or(svg_size.width());
    let scale = target_w / svg_size.width();
    let width = (svg_size.width() * scale).round().max(1.0) as u32;
    let height = (svg_size.height() * scale).round().max(1.0) as u32;

    let mut pixmap = tiny_skia::Pixmap::new(width, height).ok_or("could not allocate pixmap")?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    pixmap
        .save_png(&output)
        .map_err(|e| format!("write {}: {e}", output.display()))
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("arc-svg2png: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
