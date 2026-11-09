// Module 4 (arc_scan): Single-pass scanner for personal paths, secrets, blue hexes, and old brand strings.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanHit {
    pub line: usize,
    pub class: &'static str,
}

const PLACEHOLDERS: &[&str] = &[
    "public",
    "default",
    "default user",
    "all users",
    "user",
    "users",
    "username",
    "name",
    "you",
    "your",
    "me",
    "example",
    "runner",
];

fn is_placeholder_user(seg: &str) -> bool {
    let trimmed = seg.trim_matches(|c: char| c == '<' || c == '>' || c == '%' || c == '{' || c == '}' || c == '$');
    if seg.starts_with('<') || seg.starts_with('%') || seg.starts_with('$') || seg.starts_with('{') || seg.starts_with('*') || seg.starts_with("...") {
        return true;
    }
    let low = trimmed.to_ascii_lowercase();
    PLACEHOLDERS.iter().any(|p| *p == low)
}

fn has_windows_home_path(line: &str) -> bool {
    let low = line.to_ascii_lowercase();
    for marker in [":\\users\\", ":/users/", ":\\\\users\\\\"] {
        if let Some(pos) = low.find(marker) {
            if pos >= 1 && low.as_bytes()[pos - 1].is_ascii_alphabetic() {
                let rest = &line[pos + marker.len()..];
                let seg: String = rest
                    .chars()
                    .take_while(|c| !matches!(c, '\\' | '/' | ' ' | '"' | '\'' | '`'))
                    .collect();
                if !seg.is_empty() && !is_placeholder_user(&seg) {
                    return true;
                }
            }
        }
    }
    false
}

fn has_unix_home_path(line: &str) -> bool {
    for marker in ["/home/", "/Users/"] {
        let mut search_from = 0;
        while let Some(pos) = line[search_from..].find(marker) {
            let abs = search_from + pos;
            let prev_ok = abs == 0 || !line.as_bytes()[abs - 1].is_ascii_alphanumeric();
            let rest = &line[abs + marker.len()..];
            let seg: String = rest
                .chars()
                .take_while(|c| !matches!(c, '/' | '\\' | ' ' | '"' | '\'' | '`'))
                .collect();
            if prev_ok && !seg.is_empty() && !is_placeholder_user(&seg) {
                return true;
            }
            search_from = abs + marker.len();
        }
    }
    false
}

fn has_secret_token(line: &str) -> bool {
    if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY") {
        return true;
    }
    for tok in line.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-')) {
        if tok.starts_with("sk-") && tok.len() >= 23 {
            return true;
        }
        if (tok.starts_with("ghp_") || tok.starts_with("gho_") || tok.starts_with("ghs_") || tok.starts_with("ghr_"))
            && tok.len() >= 34
        {
            return true;
        }
        if tok.starts_with("AKIA") && tok.len() == 20 && tok.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
            return true;
        }
    }
    false
}

fn parse_hex_pair(s: &str) -> Option<u8> {
    u8::from_str_radix(s, 16).ok()
}

pub fn is_blue_hex(hex6: &str) -> bool {
    if hex6.len() < 6 {
        return false;
    }
    let (Some(r), Some(g), Some(b)) = (
        parse_hex_pair(&hex6[0..2]),
        parse_hex_pair(&hex6[2..4]),
        parse_hex_pair(&hex6[4..6]),
    ) else {
        return false;
    };
    let max_rg = r.max(g);
    (b as i32) - (max_rg as i32) >= 24
}

fn has_blue_hex_in_line(line: &str) -> bool {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' && i + 7 <= bytes.len() {
            let sub = &line[i + 1..i + 7];
            if sub.bytes().all(|b| b.is_ascii_hexdigit()) {
                let next_is_hex = i + 7 < bytes.len() && bytes[i + 7].is_ascii_hexdigit();
                let next2_is_hex = i + 8 < bytes.len() && bytes[i + 8].is_ascii_hexdigit();
                let valid_len = !next_is_hex || (next_is_hex && next2_is_hex && (i + 9 == bytes.len() || !bytes[i + 9].is_ascii_hexdigit()));
                if valid_len && is_blue_hex(sub) {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

pub fn scan_text(text: &str, check_brand: bool) -> Vec<ScanHit> {
    let mut hits = Vec::new();
    let legacy_brand = format!("{}{}", "deep", "seek");

    for (idx, line) in text.lines().enumerate() {
        if line.contains("privacy-scan: allow") {
            continue;
        }
        let line_no = idx + 1;
        if has_windows_home_path(line) {
            hits.push(ScanHit { line: line_no, class: "windows_home_path" });
        }
        if has_unix_home_path(line) {
            hits.push(ScanHit { line: line_no, class: "unix_home_path" });
        }
        if has_secret_token(line) {
            hits.push(ScanHit { line: line_no, class: "secret_token" });
        }
        if has_blue_hex_in_line(line) {
            hits.push(ScanHit { line: line_no, class: "blue_hex" });
        }
        if check_brand && line.to_ascii_lowercase().contains(&legacy_brand) {
            hits.push(ScanHit { line: line_no, class: "legacy_brand" });
        }
    }

    hits
}
