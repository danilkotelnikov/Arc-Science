pub mod arc_hook;
pub mod arc_rules;
pub mod arc_scan;
pub mod grants_net;
pub mod seal_guard;
pub mod sha256;
pub mod vector_assets;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_nist_vectors() {
        assert_eq!(
            sha256::sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256::sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn seal_guard_blocks_traversal_and_sealed_writes() {
        let sealed = ["scripts/seal_guard.py", "brandtext/upstream-manifest.json"];
        let trav = seal_guard::check_seal_guard("../etc/passwd", true, &sealed, None, None);
        assert!(!trav.allowed);
        assert_eq!(trav.code, "ERR_SEAL_TRAVERSAL");

        let wr = seal_guard::check_seal_guard("scripts/seal_guard.py", true, &sealed, None, None);
        assert!(!wr.allowed);
        assert_eq!(wr.code, "ERR_SEALED_WRITE_BLOCKED");

        let rd = seal_guard::check_seal_guard(
            "scripts/seal_guard.py",
            false,
            &sealed,
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
            Some(b"abc"),
        );
        assert!(rd.allowed);
    }

    #[test]
    fn arc_hook_enforces_cammut_and_english_prose() {
        let v1 = arc_hook::evaluate_hook(false, true, "Updated file.", true, true);
        assert!(!v1.allowed);
        assert_eq!(v1.violations, vec!["CAMMUT_RECALL_REQUIRED"]);

        // Cyrillic inside quotes or backticks is allowed; Cyrillic in plain reply prose is flagged.
        let ok_quoted = arc_hook::evaluate_hook(true, true, "Opened \"Пример.txt\" and `код`.", true, true);
        assert!(ok_quoted.allowed);

        let bad_prose = arc_hook::evaluate_hook(true, false, "Привет, готово.", true, true);
        assert!(!bad_prose.allowed);
        assert_eq!(bad_prose.violations, vec!["NON_ENGLISH_PROSE_OUTSIDE_CODE"]);

        // Escaped quotes inside a quoted filename stay masked; an unclosed quote never masks subsequent lines.
        let escaped_quote = arc_hook::evaluate_hook(true, true, "Saved \"файл \\\"привет\\\".txt\" cleanly.", true, true);
        assert!(escaped_quote.allowed);
        let unclosed_quote = arc_hook::evaluate_hook(true, true, "He said \"hello\nПривет мир", true, true);
        assert!(!unclosed_quote.allowed);
        assert_eq!(unclosed_quote.violations, vec!["NON_ENGLISH_PROSE_OUTSIDE_CODE"]);
    }

    #[test]
    fn arc_rules_detects_refused_words_contrasts_clipped_and_slogans() {
        let word = format!("{}{}", "lever", "age");
        let sample = format!(
            "# Build 10x pipelines, fast\nWe {} this system.\nIt is not a wrapper, it is a runtime.\nIts check passes. No model is trained yet.",
            word
        );
        let hits = arc_rules::lint_prose(&sample, true);
        let rules: Vec<&str> = hits.iter().map(|h| h.rule).collect();
        assert!(rules.contains(&"SLOGAN_HEADER"));
        assert!(rules.contains(&"REFUSED_WORD"));
        assert!(rules.contains(&"CONTRAST_NOT_Y"));
        assert!(rules.contains(&"CLIPPED_STATUS"));

        let bom_slogan = "\u{feff}# Build 1\nPlain body sentence.";
        let bom_hits = arc_rules::lint_prose(bom_slogan, true);
        assert_eq!(bom_hits.len(), 1);
        assert_eq!(bom_hits[0].rule, "SLOGAN_HEADER");
        assert_eq!(bom_hits[0].line, 1);

        let clean = "# Validation ladder\nThe check ran across all three themes and passed with zero findings.";
        assert!(arc_rules::lint_prose(clean, true).is_empty());
    }

    #[test]
    fn arc_scan_detects_paths_tokens_blue_and_brand() {
        let win_path = ["C:", "Users", "alice", "secret.txt"].join("\\");
        let pub_path = ["C:", "Users", "Public", "a.txt"].join("\\");
        let placeholder = ["C:", "Users", "<you>", "file.txt"].join("\\");
        let sk_tok = format!("sk-{}", "a1".repeat(15));
        let text = format!(
            "# Молекула\n{} {}\n{}\n{}\ncolor: #2563eb;\n",
            pub_path, win_path, placeholder, sk_tok
        );

        let hits = arc_scan::scan_text(&text, false);
        let classes: Vec<&str> = hits.iter().map(|h| h.class).collect();
        assert_eq!(classes, vec!["windows_home_path", "secret_token", "blue_hex"]);
        assert!(!arc_scan::is_blue_hex("Молекула"));
    }

    #[test]
    fn grants_anchored_and_net_match_golden_behavior() {
        let g_active = grants_net::evaluate_grant("Grant for 30 days", 1_000, 1_000 + 86_400_000, false);
        assert!(g_active.active);
        let g_expired = grants_net::evaluate_grant("Grant for 30 days", 1_000, 1_000 + grants_net::THIRTY_DAYS_MS, false);
        assert!(!g_expired.active);
        let g_revoked = grants_net::evaluate_grant("Grant for 30 days", 1_000, 2_000, true);
        assert!(!g_revoked.active);

        let d = grants_net::anchored_entry_digest("sha256:0000", 1, "claim.record", "{\"id\":\"c1\"}");
        assert!(d.starts_with("sha256:") && d.len() == 71);

        assert!(grants_net::evaluate_net_endpoint("127.0.0.1", 7424, &[]).allowed);
        assert!(!grants_net::evaluate_net_endpoint("0.0.0.0", 7424, &[]).allowed);
        assert!(!grants_net::evaluate_net_endpoint("example.org", 443, &[]).allowed);
        assert!(grants_net::evaluate_net_endpoint("api.semanticscholar.org", 443, &["api.semanticscholar.org"]).allowed);
    }

    #[test]
    fn vector_assets_validates_24x24_stroke_and_rejects_scripts_or_blue() {
        let good = r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><!-- # Молекула --><circle cx="12" cy="12" r="8"/></svg>"#;
        assert!(vector_assets::validate_svg(good).valid);

        let bad = r##"<svg viewBox="0 0 16 16" stroke="#3b82f6"><script>alert(1)</script></svg>"##;
        let res = vector_assets::validate_svg(bad);
        assert!(!res.valid);
        assert!(res.errors.contains(&"INVALID_VIEWBOX_24"));
        assert!(res.errors.contains(&"MISSING_STROKE_WIDTH_1_5"));
        assert!(res.errors.contains(&"FORBIDDEN_SCRIPT"));
        assert!(res.errors.contains(&"FORBIDDEN_BLUE_COLOR"));
    }
}
