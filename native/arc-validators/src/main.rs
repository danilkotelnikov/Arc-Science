// CLI entrypoint for arc-validators (Phase 6 N8 golden-vector and runtime verification).
use std::env;
use std::io::{self, Read};

use arc_validators::{arc_hook, arc_rules, arc_scan, grants_net, seal_guard, sha256, vector_assets};

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

fn read_stdin() -> String {
    let mut buf = String::new();
    let _ = io::stdin().read_to_string(&mut buf);
    buf
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("help");

    match cmd {
        "sha256" => {
            let input = args.get(1).cloned().unwrap_or_else(read_stdin);
            println!("{{\"sha256\":\"{}\"}}", sha256::sha256_hex(input.as_bytes()));
        }
        "seal-guard" => {
            let target = args.get(1).map(|s| s.as_str()).unwrap_or("");
            let is_write = args.get(2).map(|s| s == "write").unwrap_or(true);
            let sealed_csv = args.get(3).map(|s| s.as_str()).unwrap_or("");
            let sealed: Vec<&str> = if sealed_csv.is_empty() {
                Vec::new()
            } else {
                sealed_csv.split(',').collect()
            };
            let res = seal_guard::check_seal_guard(target, is_write, &sealed, None, None);
            println!(
                "{{\"allowed\":{},\"code\":\"{}\",\"detail\":\"{}\"}}",
                res.allowed,
                res.code,
                json_escape(&res.detail)
            );
        }
        "arc-hook" => {
            let recalled = args.get(1).map(|s| s == "true").unwrap_or(false);
            let substantive = args.get(2).map(|s| s == "true").unwrap_or(false);
            let reply = read_stdin();
            let v = arc_hook::evaluate_hook(recalled, substantive, &reply, true, true);
            let viol = v
                .violations
                .iter()
                .map(|x| format!("\"{}\"", x))
                .collect::<Vec<_>>()
                .join(",");
            println!("{{\"allowed\":{},\"violations\":[{}]}}", v.allowed, viol);
        }
        "arc-rules" => {
            let slide_mode = args.get(1).map(|s| s == "--slide").unwrap_or(false);
            let text = read_stdin();
            let hits = arc_rules::lint_prose(&text, slide_mode);
            let items = hits
                .iter()
                .map(|h| format!("{{\"line\":{},\"rule\":\"{}\"}}", h.line, h.rule))
                .collect::<Vec<_>>()
                .join(",");
            println!("{{\"ok\":{},\"findings\":[{}]}}", hits.is_empty(), items);
        }
        "arc-scan" => {
            let check_brand = args.get(1).map(|s| s == "--brand").unwrap_or(false);
            let text = read_stdin();
            let hits = arc_scan::scan_text(&text, check_brand);
            let items = hits
                .iter()
                .map(|h| format!("{{\"line\":{},\"class\":\"{}\"}}", h.line, h.class))
                .collect::<Vec<_>>()
                .join(",");
            println!("{{\"clean\":{},\"hits\":[{}]}}", hits.is_empty(), items);
        }
        "grant-check" => {
            let mode = args.get(1).map(|s| s.as_str()).unwrap_or("Grant for 30 days");
            let issued: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let now: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
            let revoked = args.get(4).map(|s| s == "true").unwrap_or(false);
            let st = grants_net::evaluate_grant(mode, issued, now, revoked);
            println!(
                "{{\"active\":{},\"reason\":\"{}\",\"expiresAtMs\":{}}}",
                st.active, st.reason, st.expires_at_ms
            );
        }
        "anchored-digest" => {
            let prev = args.get(1).map(|s| s.as_str()).unwrap_or("sha256:genesis");
            let seq: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let kind = args.get(3).map(|s| s.as_str()).unwrap_or("event");
            let payload = args.get(4).cloned().unwrap_or_else(read_stdin);
            let digest = grants_net::anchored_entry_digest(prev, seq, kind, &payload);
            println!("{{\"digest\":\"{}\"}}", digest);
        }
        "net-guard" => {
            let host = args.get(1).map(|s| s.as_str()).unwrap_or("");
            let port: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let allow_csv = args.get(3).map(|s| s.as_str()).unwrap_or("");
            let allow: Vec<&str> = if allow_csv.is_empty() {
                Vec::new()
            } else {
                allow_csv.split(',').collect()
            };
            let v = grants_net::evaluate_net_endpoint(host, port, &allow);
            println!("{{\"allowed\":{},\"reason\":\"{}\"}}", v.allowed, v.reason);
        }
        "vector-svg" => {
            let svg = read_stdin();
            let res = vector_assets::validate_svg(&svg);
            let errs = res
                .errors
                .iter()
                .map(|e| format!("\"{}\"", e))
                .collect::<Vec<_>>()
                .join(",");
            println!("{{\"valid\":{},\"errors\":[{}]}}", res.valid, errs);
        }
        _ => {
            eprintln!("usage: arc-validators <sha256|seal-guard|arc-hook|arc-rules|arc-scan|grant-check|anchored-digest|net-guard|vector-svg>");
            std::process::exit(2);
        }
    }
}
