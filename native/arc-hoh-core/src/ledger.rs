use std::collections::HashSet;

use arc_validators::sha256::sha256_hex;

pub const MAX_CYCLES: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateVerdict {
    Accepted,
    Unmet,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeResult {
    Pass,
    Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FindingSeverity {
    Blocking,
    Major,
    Minor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FindingStatus {
    Open,
    Fixed,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequirementState {
    Verified,
    Failed,
    Unverified,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckReport {
    pub id: String,
    pub command: String,
    pub exit: i32,
    pub excerpt: String,
    pub timed_out: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeReport {
    pub id: String,
    pub description: String,
    pub result: ProbeResult,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreservationReport {
    pub id: String,
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingReport {
    pub id: String,
    pub severity: FindingSeverity,
    pub status: FindingStatus,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequirementReport {
    pub id: String,
    pub state: RequirementState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateInput {
    pub candidate: String,
    pub cycle: u32,
    pub builder: String,
    pub reviewer: String,
    pub checks: Vec<CheckReport>,
    pub probes: Vec<ProbeReport>,
    pub preservation: Vec<PreservationReport>,
    pub findings: Vec<FindingReport>,
    pub requirements: Vec<RequirementReport>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposalContext {
    pub check_digests: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FreezeContext {
    pub candidate: String,
    pub caller: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateContext {
    pub proposal: Option<ProposalContext>,
    pub freeze: Option<FreezeContext>,
    pub file_check_ok: bool,
    pub file_check_reason: Option<String>,
    pub gate_caller: Option<String>,
    pub prose_block_reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateDecision {
    pub verdict: GateVerdict,
    pub reasons: Vec<String>,
}

/// The identity of a check: SHA-256 hex digest of its trimmed text.
pub fn check_digest(text: &str) -> String {
    sha256_hex(text.trim().as_bytes())
}

/// Candidate id over sorted, deduplicated `(posix_path, file_sha256_hex)` pairs,
/// matching `plugins/arc-hoh/lib/gates.js` `hashFiles` byte-for-byte.
pub fn candidate_id_from_pairs(pairs: &[(String, String)]) -> Result<String, String> {
    if pairs.is_empty() {
        return Err("hoh_freeze needs at least one file".to_string());
    }
    let mut normalized: Vec<(String, String)> = pairs
        .iter()
        .map(|(p, sha)| (p.replace('\\', "/"), sha.clone()))
        .collect();
    normalized.sort();
    normalized.dedup();
    let joined = normalized
        .iter()
        .map(|(p, sha)| format!("{p}\0{sha}"))
        .collect::<Vec<String>>()
        .join("\n");
    Ok(format!("sha256:{}", sha256_hex(joined.as_bytes())))
}

/// Hash one ledger entry from `prev_hash` and `canonical_body_json`.
pub fn hash_ledger_entry(prev_hash: &str, canonical_body_json: &str) -> String {
    sha256_hex(format!("{prev_hash}\n{canonical_body_json}").as_bytes())
}

/// Verify an unbroken hash chain starting from `"genesis"`.
/// Returns `Ok(entries.len())` or `Err(1_based_bad_index)`.
pub fn verify_chain(entries: &[(String, String, String)]) -> Result<usize, usize> {
    let mut expected_prev = "genesis";
    for (idx, (prev, body, hash)) in entries.iter().enumerate() {
        if prev != expected_prev {
            return Err(idx + 1);
        }
        if hash_ledger_entry(prev, body) != *hash {
            return Err(idx + 1);
        }
        expected_prev = hash.as_str();
    }
    Ok(entries.len())
}

fn bare_hash(id: &str) -> &str {
    id.strip_prefix("sha256:").unwrap_or(id)
}

/// Pure Rust HoH accept gate.
pub fn decide_gate(input: &GateInput, ctx: &GateContext) -> GateDecision {
    let mut reasons = Vec::new();
    let mut blocked = false;

    if ctx.proposal.is_none() {
        reasons.push("no proposal recorded for this goal".to_string());
    }
    match &ctx.freeze {
        None => reasons.push("no freeze recorded for this goal".to_string()),
        Some(freeze) => {
            if bare_hash(&input.candidate) != bare_hash(&freeze.candidate) {
                reasons.push("candidate hash differs from frozen hash".to_string());
            } else if !ctx.file_check_ok {
                let mut msg = "the files changed after the freeze".to_string();
                if let Some(reason) = &ctx.file_check_reason {
                    if !reason.trim().is_empty() {
                        msg.push_str(": ");
                        msg.push_str(reason.trim());
                    }
                }
                reasons.push(msg);
            }
        }
    }

    for prose_reason in &ctx.prose_block_reasons {
        reasons.push(prose_reason.clone());
    }

    if input.cycle < 1 {
        reasons.push("cycle must be a whole number from 1".to_string());
    } else if input.cycle > MAX_CYCLES {
        blocked = true;
        reasons.push(format!(
            "cycle {} is past the limit of {}: stop and ask the user",
            input.cycle, MAX_CYCLES
        ));
    }

    if input.checks.is_empty() {
        reasons.push("no acceptance checks were reported".to_string());
    }
    let mut reported_digests = HashSet::new();
    for check in &input.checks {
        if check.id.trim().is_empty() {
            reasons.push("a check has no id".to_string());
            continue;
        }
        if check.exit != 0 {
            reasons.push(format!("check {}: exit code {} (needs 0)", check.id, check.exit));
        }
        if check.timed_out {
            reasons.push(format!("check {}: timed out", check.id));
        }
        if check.excerpt.trim().is_empty() {
            reasons.push(format!("check {}: no output excerpt", check.id));
        }
        if check.command.trim().is_empty() {
            reasons.push(format!("check {}: no command", check.id));
        } else {
            reported_digests.insert(check_digest(&check.command));
        }
    }

    if let Some(proposal) = &ctx.proposal {
        for digest in &proposal.check_digests {
            if !reported_digests.contains(digest) {
                reasons.push(format!("proposed check was not reported: {digest}"));
            }
        }
    }

    if input.probes.is_empty() {
        reasons.push("no probes were reported".to_string());
    }
    for probe in &input.probes {
        if probe.id.trim().is_empty() || probe.description.trim().is_empty() {
            reasons.push("a probe needs an id and a description".to_string());
        } else if probe.result != ProbeResult::Pass {
            reasons.push(format!("probe {}: failed", probe.id));
        }
    }

    let builder = input.builder.trim();
    let reviewer = input.reviewer.trim();
    if builder.is_empty() || reviewer.is_empty() {
        reasons.push("builder and reviewer ids are both needed".to_string());
    } else if builder == reviewer {
        reasons.push("builder and reviewer must be different agents".to_string());
    }

    if let Some(freeze) = &ctx.freeze {
        match (&freeze.caller, &ctx.gate_caller) {
            (Some(fc), Some(gc)) if !fc.trim().is_empty() && !gc.trim().is_empty() => {
                if fc.trim() == gc.trim() {
                    reasons.push("freeze caller and gate caller must be different agents".to_string());
                }
            }
            _ => {
                reasons.push("freeze caller and gate caller must both be present".to_string());
            }
        }
    }

    if input.preservation.is_empty() {
        reasons.push("no preservation list was reported".to_string());
    }
    for pres in &input.preservation {
        if !pres.ok {
            reasons.push(format!("preservation {}: not confirmed", pres.id));
        }
    }

    for finding in &input.findings {
        if finding.status == FindingStatus::Rejected {
            let has_reason = finding
                .reason
                .as_deref()
                .map(|r| !r.trim().is_empty())
                .unwrap_or(false);
            if !has_reason {
                reasons.push(format!("finding {}: a rejected finding needs a reason", finding.id));
            }
        }
        if finding.status == FindingStatus::Open {
            match finding.severity {
                FindingSeverity::Blocking => {
                    blocked = true;
                    reasons.push(format!("finding {}: a blocking finding is still open", finding.id));
                }
                FindingSeverity::Major => {
                    reasons.push(format!("finding {}: a major finding is still open", finding.id));
                }
                FindingSeverity::Minor => {}
            }
        }
    }

    if input.requirements.is_empty() {
        reasons.push("no requirements listed".to_string());
    }
    for req in &input.requirements {
        if req.state != RequirementState::Verified {
            reasons.push(format!("requirement {}: {:?}", req.id, req.state));
        }
    }

    let verdict = if reasons.is_empty() {
        GateVerdict::Accepted
    } else if blocked {
        GateVerdict::Blocked
    } else {
        GateVerdict::Unmet
    };

    GateDecision { verdict, reasons }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input_and_context() -> (GateInput, GateContext) {
        let cmd = "cargo test --manifest-path native/Cargo.toml";
        let cand = candidate_id_from_pairs(&[(
            "/repo/native/Cargo.toml".to_string(),
            sha256_hex(b"[workspace]"),
        )])
        .unwrap();
        let input = GateInput {
            candidate: cand.clone(),
            cycle: 1,
            builder: "gemini-4-neon".to_string(),
            reviewer: "hydrogen-checker".to_string(),
            checks: vec![CheckReport {
                id: "c1".to_string(),
                command: cmd.to_string(),
                exit: 0,
                excerpt: "test result: ok".to_string(),
                timed_out: false,
            }],
            probes: vec![ProbeReport {
                id: "p1".to_string(),
                description: "empty file list rejected".to_string(),
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
        };
        let ctx = GateContext {
            proposal: Some(ProposalContext {
                check_digests: vec![check_digest(cmd)],
            }),
            freeze: Some(FreezeContext {
                candidate: cand,
                caller: Some("orchestrator-1".to_string()),
            }),
            file_check_ok: true,
            file_check_reason: None,
            gate_caller: Some("reviewer-2".to_string()),
            prose_block_reasons: vec![],
        };
        (input, ctx)
    }

    #[test]
    fn ledger_chain_verification_detects_tamper() {
        let b1 = r#"{"seq":1,"prev":"genesis","type":"propose"}"#;
        let h1 = hash_ledger_entry("genesis", b1);
        let b2 = format!(r#"{{"seq":2,"prev":"{h1}","type":"freeze"}}"#);
        let h2 = hash_ledger_entry(&h1, &b2);

        let good = vec![
            ("genesis".to_string(), b1.to_string(), h1.clone()),
            (h1.clone(), b2.clone(), h2.clone()),
        ];
        assert_eq!(verify_chain(&good), Ok(2));

        let mut tampered = good.clone();
        tampered[1].1 = r#"{"seq":2,"prev":"tampered","type":"freeze"}"#.to_string();
        assert_eq!(verify_chain(&tampered), Err(2));
    }

    #[test]
    fn gate_accepts_complete_evidence_and_blocks_over_cycle_limit() {
        let (mut input, ctx) = valid_input_and_context();
        let ok = decide_gate(&input, &ctx);
        assert_eq!(ok.verdict, GateVerdict::Accepted);
        assert!(ok.reasons.is_empty());

        input.cycle = 4;
        let over = decide_gate(&input, &ctx);
        assert_eq!(over.verdict, GateVerdict::Blocked);
    }

    #[test]
    fn gate_rejects_self_review_and_open_findings() {
        let (mut input, mut ctx) = valid_input_and_context();
        input.reviewer = input.builder.clone();
        assert_eq!(decide_gate(&input, &ctx).verdict, GateVerdict::Unmet);

        let (mut input2, ctx2) = valid_input_and_context();
        input2.findings.push(FindingReport {
            id: "f1".to_string(),
            severity: FindingSeverity::Blocking,
            status: FindingStatus::Open,
            reason: None,
        });
        assert_eq!(decide_gate(&input2, &ctx2).verdict, GateVerdict::Blocked);

        ctx.prose_block_reasons.push("prose gate blocked README.md".to_string());
        let (input3, _) = valid_input_and_context();
        assert_eq!(decide_gate(&input3, &ctx).verdict, GateVerdict::Unmet);
    }
}
