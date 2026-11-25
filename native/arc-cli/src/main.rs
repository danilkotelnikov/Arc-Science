#![forbid(unsafe_code)]

mod targets;

use std::env;
use std::fs;
use std::process::ExitCode;

use arc_hoh_core::change_tree::{decide as decide_change_tree, ActionClass, ChangeState, Verdict};
use arc_hoh_core::decision::{
    evaluate_decision_packet, join_taint, voi_worth_cost, DecisionPacketInput, Taint,
};
use arc_hoh_core::ledger::{
    candidate_id_from_pairs, check_digest, decide_gate, CheckReport, FreezeContext, GateContext,
    GateInput, GateVerdict, PreservationReport, ProbeReport, ProbeResult, ProposalContext,
    RequirementReport, RequirementState,
};
use arc_validators::arc_rules::lint_prose;
use arc_validators::sha256::sha256_hex;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 2);
    out.push('"');
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn cmd_version() -> ExitCode {
    println!(
        "{{\"name\":\"arc\",\"version\":{},\"dsh_dependency\":false,\"host_os\":{},\"host_arch\":{}}}",
        json_escape(VERSION),
        json_escape(env::consts::OS),
        json_escape(env::consts::ARCH)
    );
    ExitCode::SUCCESS
}

fn cmd_targets() -> ExitCode {
    println!("{}", targets::targets_to_json());
    ExitCode::SUCCESS
}

fn cmd_check_sha256(text: &str) -> ExitCode {
    let digest = sha256_hex(text.as_bytes());
    println!("{{\"sha256\":{}}}", json_escape(&digest));
    ExitCode::SUCCESS
}

fn cmd_check_candidate(files: &[String]) -> ExitCode {
    let mut pairs = Vec::with_capacity(files.len());
    for file in files {
        match fs::read(file) {
            Ok(bytes) => pairs.push((file.clone(), sha256_hex(&bytes))),
            Err(err) => {
                eprintln!("error reading {}: {}", file, err);
                return ExitCode::from(2);
            }
        }
    }
    match candidate_id_from_pairs(&pairs) {
        Ok(candidate) => {
            println!("{{\"candidate\":{}}}", json_escape(&candidate));
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("error: {}", err);
            ExitCode::from(1)
        }
    }
}

fn cmd_check_prose(file_path: &str) -> ExitCode {
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(err) => {
            eprintln!("error reading {}: {}", file_path, err);
            return ExitCode::from(2);
        }
    };
    let hits = lint_prose(&content, true);
    let mut items = Vec::with_capacity(hits.len());
    for h in &hits {
        items.push(format!(
            "{{\"line\":{},\"rule\":{},\"detail\":{}}}",
            h.line,
            json_escape(h.rule),
            json_escape(&h.detail)
        ));
    }
    println!(
        "{{\"ok\":{},\"count\":{},\"findings\":[{}]}}",
        hits.is_empty(),
        hits.len(),
        items.join(",")
    );
    if hits.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn run_selftest() -> Result<(), &'static str> {
    // 1. SHA-256 NIST vector
    if sha256_hex(b"abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
        return Err("sha256_nist_vector_failed");
    }

    // 2. HoH accept gate check
    let cmd = "cargo test --manifest-path native/Cargo.toml";
    let cand = candidate_id_from_pairs(&[(
        "/repo/native/Cargo.toml".to_string(),
        sha256_hex(b"abc"),
    )])
    .map_err(|_| "candidate_id_failed")?;
    let gate = decide_gate(
        &GateInput {
            candidate: cand.clone(),
            cycle: 1,
            builder: "builder-a".to_string(),
            reviewer: "reviewer-b".to_string(),
            checks: vec![CheckReport {
                id: "c1".to_string(),
                command: cmd.to_string(),
                exit: 0,
                excerpt: "ok".to_string(),
                timed_out: false,
            }],
            probes: vec![ProbeReport {
                id: "p1".to_string(),
                description: "spot probe".to_string(),
                result: ProbeResult::Pass,
            }],
            preservation: vec![PreservationReport {
                id: "pr1".to_string(),
                ok: true,
            }],
            findings: vec![],
            requirements: vec![RequirementReport {
                id: "r1".to_string(),
                state: RequirementState::Verified,
            }],
        },
        &GateContext {
            proposal: Some(ProposalContext {
                check_digests: vec![check_digest(cmd)],
            }),
            freeze: Some(FreezeContext {
                candidate: cand,
                caller: Some("orch".to_string()),
            }),
            file_check_ok: true,
            file_check_reason: None,
            gate_caller: Some("rev".to_string()),
            prose_block_reasons: vec![],
        },
    );
    if gate.verdict != GateVerdict::Accepted {
        return Err("hoh_gate_selftest_failed");
    }

    // 3. Change Tree spot check
    let ct_ok = decide_change_tree(&ChangeState {
        action_class: ActionClass::Class2MergeDefault,
        grant_in_scope: true,
        all_gates_passed: true,
        any_gate_failed: false,
        gate_cannot_run: false,
        hash_matches: true,
        head_covered: true,
        independent_review: true,
        findings_open: false,
        threads_open: false,
        test_removals_confirmed: true,
        base_current: true,
        within_size_budget: true,
        protected_path_touched: false,
        ci_running: false,
        review_pending: false,
        deadline_passed: false,
        depth_exceeded: false,
    });
    if ct_ok.verdict != Verdict::Act {
        return Err("change_tree_act_failed");
    }
    let ct_ask = decide_change_tree(&ChangeState {
        action_class: ActionClass::Class3Protected,
        grant_in_scope: true,
        all_gates_passed: true,
        any_gate_failed: false,
        gate_cannot_run: false,
        hash_matches: true,
        head_covered: true,
        independent_review: true,
        findings_open: false,
        threads_open: false,
        test_removals_confirmed: true,
        base_current: true,
        within_size_budget: true,
        protected_path_touched: true,
        ci_running: false,
        review_pending: false,
        deadline_passed: false,
        depth_exceeded: false,
    });
    if ct_ask.verdict != Verdict::Ask {
        return Err("change_tree_ask_failed");
    }

    // 4. Taint + VOI check
    if join_taint(Taint::Clean, Taint::SecretRisk) != Taint::SecretRisk {
        return Err("taint_join_failed");
    }
    if !voi_worth_cost(0.5, 100.0, 100.0, 0.95, 0.05, 5.0) {
        return Err("voi_check_failed");
    }
    let pkt = evaluate_decision_packet(&DecisionPacketInput {
        taint: Taint::SecretRisk,
        checks_passed: true,
        cross_family_verified: true,
        requires_human_yes: false,
        operator_approved: false,
        citations: vec!["doi:10.1000/test".to_string()],
    });
    if pkt.allow_exit {
        return Err("secret_taint_exit_guard_failed");
    }

    // 5. 5-target matrix check
    if targets::DIST_TARGETS.len() != 5 {
        return Err("target_matrix_count_failed");
    }

    Ok(())
}

fn cmd_selftest() -> ExitCode {
    match run_selftest() {
        Ok(()) => {
            println!(
                "{{\"ok\":true,\"version\":{},\"dsh_dependency\":false,\"targets\":{}}}",
                json_escape(VERSION),
                targets::DIST_TARGETS.len()
            );
            ExitCode::SUCCESS
        }
        Err(reason) => {
            println!("{{\"ok\":false,\"error\":{}}}", json_escape(reason));
            ExitCode::from(1)
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("version") => cmd_version(),
        Some("targets") => cmd_targets(),
        Some("check-sha256") => match args.get(1) {
            Some(text) => cmd_check_sha256(text),
            None => {
                eprintln!("usage: arc check-sha256 <text>");
                ExitCode::from(2)
            }
        },
        Some("check-candidate") => {
            if args.len() < 2 {
                eprintln!("usage: arc check-candidate <file1> [file2 ...]");
                ExitCode::from(2)
            } else {
                cmd_check_candidate(&args[1..])
            }
        }
        Some("check-prose") => match args.get(1) {
            Some(file) => cmd_check_prose(file),
            None => {
                eprintln!("usage: arc check-prose <file>");
                ExitCode::from(2)
            }
        },
        Some("selftest") => cmd_selftest(),
        _ => {
            eprintln!("usage: arc <version|targets|check-sha256|check-prose|selftest>");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selftest_passes_all_five_checks() {
        assert_eq!(run_selftest(), Ok(()));
    }
}
