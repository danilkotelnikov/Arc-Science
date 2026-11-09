// Module 6 (vector_assets): Zero-dependency SVG validator enforcing 24x24 viewBox, 1.5 stroke, and safe ink-only elements.
use crate::arc_scan::is_blue_hex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SvgCheckResult {
    pub valid: bool,
    pub errors: Vec<&'static str>,
}

fn has_blue_color_literal(svg: &str) -> bool {
    let bytes = svg.as_bytes();
    let mut i = 0;
    while i + 7 <= bytes.len() {
        if bytes[i] == b'#' {
            let hex = &svg[i + 1..i + 7];
            if hex.bytes().all(|b| b.is_ascii_hexdigit()) && is_blue_hex(hex) {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn has_inline_event_attr(lower: &str) -> bool {
    for attr in ["onload=", "onclick=", "onerror=", "onmouseover=", "onfocus="] {
        if lower.contains(attr) {
            return true;
        }
    }
    false
}

pub fn validate_svg(svg_text: &str) -> SvgCheckResult {
    let trimmed = svg_text.trim();
    let lower = trimmed.to_ascii_lowercase();
    let mut errors = Vec::new();

    if !lower.contains("<svg") || !lower.contains("</svg>") {
        errors.push("MISSING_SVG_ROOT");
    }
    if !trimmed.contains("viewBox=\"0 0 24 24\"") && !trimmed.contains("viewBox='0 0 24 24'") {
        errors.push("INVALID_VIEWBOX_24");
    }
    if !trimmed.contains("stroke-width=\"1.5\"")
        && !trimmed.contains("stroke-width='1.5'")
        && !trimmed.contains("strokeWidth=\"1.5\"")
    {
        errors.push("MISSING_STROKE_WIDTH_1_5");
    }
    if lower.contains("<script") || lower.contains("javascript:") {
        errors.push("FORBIDDEN_SCRIPT");
    }
    if lower.contains("<foreignobject") {
        errors.push("FORBIDDEN_FOREIGN_OBJECT");
    }
    if has_inline_event_attr(&lower) {
        errors.push("FORBIDDEN_EVENT_HANDLER");
    }
    if lower.contains("url(http://") || lower.contains("url(https://") || lower.contains("xlink:href=\"http") {
        errors.push("FORBIDDEN_EXTERNAL_URL");
    }
    if has_blue_color_literal(trimmed) {
        errors.push("FORBIDDEN_BLUE_COLOR");
    }

    SvgCheckResult {
        valid: errors.is_empty(),
        errors,
    }
}
