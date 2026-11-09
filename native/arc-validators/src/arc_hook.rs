// Module 2 (arc_hook): Combined cammut-mandatory + english-gentle-guard hook.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookVerdict {
    pub allowed: bool,
    pub violations: Vec<&'static str>,
}

fn find_closing_backticks_on_line(bytes: &[u8], start: usize, tick_len: usize) -> Option<usize> {
    let mut j = start;
    while j < bytes.len() && bytes[j] != b'\n' && bytes[j] != b'\r' {
        if bytes[j] == b'`' {
            let mut run = 0;
            while j + run < bytes.len() && bytes[j + run] == b'`' {
                run += 1;
            }
            if run == tick_len {
                return Some(j + run);
            }
            j += run;
            continue;
        }
        j += 1;
    }
    None
}

fn find_closing_quote_on_line(bytes: &[u8], start: usize) -> Option<usize> {
    let mut j = start;
    while j < bytes.len() && bytes[j] != b'\n' && bytes[j] != b'\r' {
        if bytes[j] == b'\\' {
            j += 2;
            continue;
        }
        if bytes[j] == b'"' {
            return Some(j + 1);
        }
        j += 1;
    }
    None
}

fn strip_allowed_spans(text: &str) -> String {
    // Strip fenced ```...``` blocks, line-bounded `...` / ``...`` code spans,
    // escape-aware single-line "..." file names, and http(s):// URLs.
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut in_fence = false;

    while i < bytes.len() {
        if i + 3 <= bytes.len() && &bytes[i..i + 3] == b"```" {
            in_fence = !in_fence;
            i += 3;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }
        if bytes[i] == b'`' {
            let mut tick_len = 0;
            while i + tick_len < bytes.len() && bytes[i + tick_len] == b'`' {
                tick_len += 1;
            }
            if let Some(next_i) = find_closing_backticks_on_line(bytes, i + tick_len, tick_len) {
                i = next_i;
                continue;
            }
            for _ in 0..tick_len {
                out.push('`');
            }
            i += tick_len;
            continue;
        }
        if bytes[i] == b'"' {
            if let Some(next_i) = find_closing_quote_on_line(bytes, i + 1) {
                i = next_i;
                continue;
            }
            out.push('"');
            i += 1;
            continue;
        }
        if i + 7 <= bytes.len()
            && (&bytes[i..i + 7] == b"http://" || (i + 8 <= bytes.len() && &bytes[i..i + 8] == b"https://"))
        {
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
