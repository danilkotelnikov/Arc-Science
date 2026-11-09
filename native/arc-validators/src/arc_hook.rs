// Module 2 (arc_hook): Combined cammut-mandatory + english-gentle-guard hook.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookVerdict {
    pub allowed: bool,
    pub violations: Vec<&'static str>,
}

fn strip_allowed_spans(text: &str) -> String {
    // Strip fenced ```...``` blocks, inline `...` code spans, double-quoted file names, and http(s):// URLs.
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut in_fence = false;
    let mut in_inline = false;
    let mut in_quote = false;

    while i < bytes.len() {
        if !in_inline && !in_quote && i + 3 <= bytes.len() && &bytes[i..i + 3] == b"```" {
            in_fence = !in_fence;
            i += 3;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }
        if !in_quote && bytes[i] == b'`' {
            in_inline = !in_inline;
            i += 1;
            continue;
        }
        if in_inline {
            i += 1;
            continue;
        }
        if bytes[i] == b'"' {
            in_quote = !in_quote;
            i += 1;
            continue;
        }
        if in_quote {
            i += 1;
            continue;
        }
        if i + 7 <= bytes.len() && (&bytes[i..i + 7] == b"http://" || (i + 8 <= bytes.len() && &bytes[i..i + 8] == b"https://")) {
            while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            continue;
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn contains_cyrillic(s: &str) -> bool {
    s.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c))
}

pub fn evaluate_hook(
    cammut_recalled: bool,
    is_substantive_edit: bool,
    reply_text: &str,
    enforce_cammut: bool,
    enforce_english_gentle: bool,
) -> HookVerdict {
    let mut violations = Vec::new();

    if enforce_cammut && is_substantive_edit && !cammut_recalled {
        violations.push("CAMMUT_RECALL_REQUIRED");
    }

    if enforce_english_gentle && !reply_text.is_empty() {
        let stripped = strip_allowed_spans(reply_text);
        if contains_cyrillic(&stripped) {
            violations.push("NON_ENGLISH_PROSE_OUTSIDE_CODE");
        }
        if stripped.contains("!!!") || stripped.contains("YOU MUST OBEY") {
            violations.push("HARSH_TONE_MARKER");
        }
    }

    HookVerdict {
        allowed: violations.is_empty(),
        violations,
    }
}
