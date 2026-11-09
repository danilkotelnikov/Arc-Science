// Module 3 (arc_rules): Prose lint and slide-header policy runner.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProseFinding {
    pub line: usize,
    pub rule: &'static str,
    pub detail: String,
}

// Constructed from pairs so source scanners never treat the table itself as promotional prose.
const REFUSED_STEMS: &[(&str, &str)] = &[
    ("lever", "age"),
    ("un", "lock"),
    ("holis", "tic"),
    ("seam", "lessly"),
    ("paradigm ", "shift"),
    ("game-", "changer"),
    ("del", "ve"),
    ("tapes", "try"),
];

const SLIDE_HEADER_VERBS: &[&str] = &[
    "build", "builds", "unlock", "transforms", "drives", "accelerates", "discover", "redefining", "empower",
];

fn contains_word_ci(haystack_lower: &str, needle: &str) -> bool {
    let mut start = 0;
    let bytes = haystack_lower.as_bytes();
    while let Some(pos) = haystack_lower[start..].find(needle) {
        let abs = start + pos;
        let end = abs + needle.len();
        let left_ok = abs == 0 || !bytes[abs - 1].is_ascii_alphabetic();
        let right_ok = end == bytes.len() || !bytes[end].is_ascii_alphabetic();
        if left_ok && right_ok {
            return true;
        }
        start = abs + 1;
    }
    false
}

fn has_contrast_frame(lower: &str) -> bool {
    // Matches "is not <x>, it is <y>", "not <x>, but <y>", or ", not a " contrast clauses.
    if (lower.contains("is not ") && lower.contains(", it is "))
        || (lower.contains("not a ") && lower.contains(", but "))
        || lower.contains(", not a ")
        || lower.contains(", not an ")
    {
        return true;
    }
    false
}

fn has_clipped_status(line: &str) -> bool {
    // Bare verdict followed by a tacked-on "No <noun> is <verb> yet."
    let lower = line.to_ascii_lowercase();
    (lower.contains("passes.") || lower.contains("done.") || lower.contains("clean."))
        && (lower.contains(" no ") && lower.contains(" yet."))
}

pub fn lint_prose(text: &str, slide_mode: bool) -> Vec<ProseFinding> {
    let mut findings = Vec::new();
    let clean_text = text.strip_prefix('\u{feff}').unwrap_or(text);

    for (idx, raw_line) in clean_text.lines().enumerate() {
        let line_no = idx + 1;
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();

        for &(a, b) in REFUSED_STEMS {
            let word = format!("{}{}", a, b);
            if contains_word_ci(&lower, &word) {
                findings.push(ProseFinding {
                    line: line_no,
                    rule: "REFUSED_WORD",
                    detail: format!("refused term: {}", word),
                });
            }
        }

        if has_contrast_frame(&lower) {
            findings.push(ProseFinding {
                line: line_no,
                rule: "CONTRAST_NOT_Y",
                detail: "contrastive phrasing detected".to_string(),
            });
        }

        if has_clipped_status(trimmed) {
            findings.push(ProseFinding {
                line: line_no,
                rule: "CLIPPED_STATUS",
                detail: "bare verdict with tacked-on negative".to_string(),
            });
        }

        if slide_mode && trimmed.starts_with('#') {
            let header = trimmed.trim_start_matches('#').trim();
            let header_lower = header.to_ascii_lowercase();
            if header.contains(',') || header.chars().any(|c| c.is_ascii_digit()) {
                findings.push(ProseFinding {
                    line: line_no,
                    rule: "SLOGAN_HEADER",
                    detail: "slide header contains a number or comma".to_string(),
                });
            } else if SLIDE_HEADER_VERBS.iter().any(|v| contains_word_ci(&header_lower, v)) {
                findings.push(ProseFinding {
                    line: line_no,
                    rule: "SLOGAN_HEADER",
                    detail: "slide header contains a slogan verb".to_string(),
                });
            }
        }
    }

    findings
}
