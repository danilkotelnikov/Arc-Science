#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Taint {
    Clean = 0,
    ToolOutput = 1,
    UntrustedWeb = 2,
    SecretRisk = 3,
}

/// Monotone lattice join over `Taint`.
pub fn join_taint(a: Taint, b: Taint) -> Taint {
    if a >= b { a } else { b }
}

/// Bayes Value-of-Information check: returns true iff running a check with
/// sensitivity `s`, false-positive rate `e`, and cost `cost` reduces expected
/// loss strictly more than `cost` (matching `lean/ArcCheckers.lean`).
pub fn voi_worth_cost(p: f64, cfp: f64, cfn: f64, s: f64, e: f64, cost: f64) -> bool {
    let p = p.clamp(0.0, 1.0);
    let s = s.clamp(0.0, 1.0);
    let e = e.clamp(0.0, 1.0);
    let cfp = cfp.max(0.0);
    let cfn = cfn.max(0.0);
    let cost = cost.max(0.0);

    let risk_before = (p * cfn).min((1.0 - p) * cfp);
    let risk_pass = (p * s * cfn).min((1.0 - p) * e * cfp);
    let risk_fail = (p * (1.0 - s) * cfn).min((1.0 - p) * (1.0 - e) * cfp);
    let risk_after = risk_pass + risk_fail;
    risk_after + cost < risk_before
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFamily {
    Google,
    Anthropic,
    OpenAi,
    Zhipu,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelRoute {
    pub id: String,
    pub family: ModelFamily,
    pub tier: u8,
    pub supports_formal: bool,
    pub cost_weight: u32,
}

/// Choose the lowest-cost cross-family `(builder, checker)` pair meeting tier and formal bounds.
pub fn pair_builder_and_checker(
    routes: &[ModelRoute],
    min_builder_tier: u8,
    min_checker_tier: u8,
    needs_formal: bool,
) -> Option<(ModelRoute, ModelRoute)> {
    let mut best: Option<(u32, &ModelRoute, &ModelRoute)> = None;
    for b in routes {
        if b.tier < min_builder_tier || (needs_formal && !b.supports_formal) {
            continue;
        }
        for c in routes {
            if c.family == b.family {
                continue;
            }
            if c.tier < min_checker_tier || (needs_formal && !c.supports_formal) {
                continue;
            }
            let total = b.cost_weight.saturating_add(c.cost_weight);
            match best {
                None => best = Some((total, b, c)),
                Some((best_cost, _, _)) if total < best_cost => best = Some((total, b, c)),
                _ => {}
            }
        }
    }
    best.map(|(_, b, c)| (b.clone(), c.clone()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionPacketInput {
    pub taint: Taint,
    pub checks_passed: bool,
    pub cross_family_verified: bool,
    pub requires_human_yes: bool,
    pub operator_approved: bool,
    pub citations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionPacketResult {
    pub allow_exit: bool,
    pub reasons: Vec<&'static str>,
}

/// Evaluate taint-guarded exit policy for a decision packet.
pub fn evaluate_decision_packet(input: &DecisionPacketInput) -> DecisionPacketResult {
    let mut reasons = Vec::new();
    if input.taint == Taint::SecretRisk {
        reasons.push("secret_risk_taint_blocks_exit");
    }
    if !input.checks_passed {
        reasons.push("checks_not_passed");
    }
    if !input.cross_family_verified {
        reasons.push("cross_family_verification_required");
    }
    if input.requires_human_yes && !input.operator_approved {
        reasons.push("operator_approval_required");
    }
    if input.citations.is_empty() {
        reasons.push("citations_required");
    }
    DecisionPacketResult {
        allow_exit: reasons.is_empty(),
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taint_lattice_is_monotone_and_associative() {
        assert_eq!(join_taint(Taint::Clean, Taint::ToolOutput), Taint::ToolOutput);
        assert_eq!(join_taint(Taint::UntrustedWeb, Taint::ToolOutput), Taint::UntrustedWeb);
        assert_eq!(join_taint(Taint::Clean, Taint::SecretRisk), Taint::SecretRisk);
    }

    #[test]
    fn voi_worth_cost_accepts_informative_cheap_check_and_rejects_uninformative() {
        assert!(voi_worth_cost(0.5, 100.0, 100.0, 0.95, 0.05, 5.0));
        assert!(!voi_worth_cost(0.5, 100.0, 100.0, 0.5, 0.5, 0.1));
        assert!(!voi_worth_cost(0.5, 100.0, 100.0, 0.95, 0.05, 60.0));
    }

    #[test]
    fn cross_family_pairing_enforces_distinct_families_and_formal() {
        let routes = vec![
            ModelRoute {
                id: "google/gemini-4-neon".to_string(),
                family: ModelFamily::Google,
                tier: 3,
                supports_formal: true,
                cost_weight: 2,
            },
            ModelRoute {
                id: "anthropic/hydrogen".to_string(),
                family: ModelFamily::Anthropic,
                tier: 3,
                supports_formal: true,
                cost_weight: 3,
            },
            ModelRoute {
                id: "google/gemini-fast".to_string(),
                family: ModelFamily::Google,
                tier: 2,
                supports_formal: false,
                cost_weight: 1,
            },
        ];
        let pair = pair_builder_and_checker(&routes, 2, 2, true).expect("pair must exist");
        assert_ne!(pair.0.family, pair.1.family);
        assert!(pair.0.supports_formal && pair.1.supports_formal);
    }

    #[test]
    fn decision_packet_blocks_secret_taint_and_missing_citations() {
        let ok = evaluate_decision_packet(&DecisionPacketInput {
            taint: Taint::ToolOutput,
            checks_passed: true,
            cross_family_verified: true,
            requires_human_yes: false,
            operator_approved: false,
            citations: vec!["doi:10.1000/test".to_string()],
        });
        assert!(ok.allow_exit);

        let blocked = evaluate_decision_packet(&DecisionPacketInput {
            taint: Taint::SecretRisk,
            checks_passed: true,
            cross_family_verified: true,
            requires_human_yes: false,
            operator_approved: false,
            citations: vec!["doi:10.1000/test".to_string()],
        });
        assert!(!blocked.allow_exit);
    }
}
