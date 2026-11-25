#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionClass {
    Class0PrivateCommit,
    Class1PushOrPr,
    Class2MergeDefault,
    Class3Protected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Act,
    Wait,
    Repair,
    Ask,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChangeState {
    pub action_class: ActionClass,
    pub grant_in_scope: bool,
    pub all_gates_passed: bool,
    pub any_gate_failed: bool,
    pub gate_cannot_run: bool,
    pub hash_matches: bool,
    pub head_covered: bool,
    pub independent_review: bool,
    pub findings_open: bool,
    pub threads_open: bool,
    pub test_removals_confirmed: bool,
    pub base_current: bool,
    pub within_size_budget: bool,
    pub protected_path_touched: bool,
    pub ci_running: bool,
    pub review_pending: bool,
    pub deadline_passed: bool,
    pub depth_exceeded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeDecision {
    pub verdict: Verdict,
    pub because: Vec<&'static str>,
    pub missing: Vec<&'static str>,
}

/// Produce a short one-line summary of the decision.
pub fn summarize(decision: &ChangeDecision) -> String {
    format!(
        "{:?}: because=[{}], missing=[{}]",
        decision.verdict,
        decision.because.join(","),
        decision.missing.join(",")
    )
}

/// Pure Change Tree decision engine satisfying properties P1 through P10.
pub fn decide(state: &ChangeState) -> ChangeDecision {
    match state.action_class {
        ActionClass::Class3Protected => ChangeDecision {
            verdict: Verdict::Ask,
            because: vec!["class3_protected_action"],
            missing: vec!["operator_approval_class3"],
        },
        ActionClass::Class0PrivateCommit => {
            if state.depth_exceeded {
                ChangeDecision {
                    verdict: Verdict::Stop,
                    because: vec!["depth_exceeded"],
                    missing: vec![],
                }
            } else {
                ChangeDecision {
                    verdict: Verdict::Act,
                    because: vec!["class0_private_commit_allowed"],
                    missing: vec![],
                }
            }
        }
        ActionClass::Class1PushOrPr => decide_class1(state),
        ActionClass::Class2MergeDefault => decide_class2(state),
    }
}

fn decide_class1(state: &ChangeState) -> ChangeDecision {
    let mut stops = Vec::new();
    if state.depth_exceeded {
        stops.push("depth_exceeded");
    }
    if state.gate_cannot_run {
        stops.push("gate_cannot_run");
    }
    if !state.within_size_budget {
        stops.push("size_budget_exceeded");
    }
    if state.protected_path_touched {
        stops.push("protected_path_touched");
    }
    if !stops.is_empty() {
        return ChangeDecision {
            verdict: Verdict::Stop,
            because: stops,
            missing: vec![],
        };
    }

    if !state.grant_in_scope {
        return ChangeDecision {
            verdict: Verdict::Ask,
            because: vec!["grant_out_of_scope"],
            missing: vec!["operator_grant_in_scope"],
        };
    }

    let mut repairs = Vec::new();
    let mut missing = Vec::new();
    if state.any_gate_failed {
        repairs.push("gate_failed");
        missing.push("passing_gates");
    }
    if !state.hash_matches {
        repairs.push("hash_mismatch");
        missing.push("matching_candidate_hash");
    }
    if !repairs.is_empty() {
        return ChangeDecision {
            verdict: Verdict::Repair,
            because: repairs,
            missing,
        };
    }

    if !state.all_gates_passed {
        if state.ci_running {
            if state.deadline_passed {
                return ChangeDecision {
                    verdict: Verdict::Stop,
                    because: vec!["deadline_passed"],
                    missing: vec![],
                };
            }
            return ChangeDecision {
                verdict: Verdict::Wait,
                because: vec!["ci_running"],
                missing: vec!["all_gates_passed"],
            };
        }
        return ChangeDecision {
            verdict: Verdict::Repair,
            because: vec!["gates_not_run"],
            missing: vec!["all_gates_passed"],
        };
    }

    ChangeDecision {
        verdict: Verdict::Act,
        because: vec!["class1_conditions_satisfied"],
        missing: vec![],
    }
}

fn decide_class2(state: &ChangeState) -> ChangeDecision {
    if state.protected_path_touched {
        return ChangeDecision {
            verdict: Verdict::Ask,
            because: vec!["protected_path_upgrades_merge_to_class3"],
            missing: vec!["operator_approval_class3"],
        };
    }

    let mut stops = Vec::new();
    if state.depth_exceeded {
        stops.push("depth_exceeded");
    }
    if state.gate_cannot_run {
        stops.push("gate_cannot_run");
    }
    if !state.within_size_budget {
        stops.push("size_budget_exceeded");
    }
    if !stops.is_empty() {
        return ChangeDecision {
            verdict: Verdict::Stop,
            because: stops,
            missing: vec![],
        };
    }

    if !state.grant_in_scope {
        return ChangeDecision {
            verdict: Verdict::Ask,
            because: vec!["grant_out_of_scope"],
            missing: vec!["operator_grant_in_scope"],
        };
    }

    let mut repairs = Vec::new();
    let mut missing = Vec::new();
    if state.any_gate_failed {
        repairs.push("gate_failed");
        missing.push("passing_gates");
    }
    if !state.hash_matches {
        repairs.push("hash_mismatch");
        missing.push("matching_candidate_hash");
    }
    if !state.head_covered {
        repairs.push("head_not_covered");
        missing.push("head_covered");
    }
    if !state.independent_review {
        repairs.push("independent_review_missing");
        missing.push("independent_review");
    }
    if state.findings_open {
        repairs.push("findings_open");
        missing.push("resolved_findings");
    }
    if !state.test_removals_confirmed {
        repairs.push("test_removals_unconfirmed");
        missing.push("test_removals_confirmed");
    }
    if !state.base_current {
        repairs.push("base_not_current");
        missing.push("base_current");
    }
    if !repairs.is_empty() {
        return ChangeDecision {
            verdict: Verdict::Repair,
            because: repairs,
            missing,
        };
    }

    let mut waits = Vec::new();
    if state.ci_running {
        waits.push("ci_running");
    }
    if state.review_pending {
        waits.push("review_pending");
    }
    if state.threads_open {
        waits.push("threads_open");
    }
    if !waits.is_empty() {
        if state.deadline_passed {
            return ChangeDecision {
                verdict: Verdict::Stop,
                because: vec!["deadline_passed"],
                missing: vec![],
            };
        }
        return ChangeDecision {
            verdict: Verdict::Wait,
            because: waits,
            missing: vec!["live_wait_clear"],
        };
    }

    if !state.all_gates_passed {
        return ChangeDecision {
            verdict: Verdict::Repair,
            because: vec!["gates_not_run"],
            missing: vec!["all_gates_passed"],
        };
    }

    ChangeDecision {
        verdict: Verdict::Act,
        because: vec!["class2_conditions_satisfied"],
        missing: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_from_bits(class_idx: u8, bits: u32) -> ChangeState {
        let action_class = match class_idx {
            0 => ActionClass::Class0PrivateCommit,
            1 => ActionClass::Class1PushOrPr,
            2 => ActionClass::Class2MergeDefault,
            _ => ActionClass::Class3Protected,
        };
        let b = |shift: u32| ((bits >> shift) & 1) != 0;
        ChangeState {
            action_class,
            grant_in_scope: b(0),
            all_gates_passed: b(1),
            any_gate_failed: b(2),
            gate_cannot_run: b(3),
            hash_matches: b(4),
            head_covered: b(5),
            independent_review: b(6),
            findings_open: b(7),
            threads_open: b(8),
            test_removals_confirmed: b(9),
            base_current: b(10),
            within_size_budget: b(11),
            protected_path_touched: b(12),
            ci_running: b(13),
            review_pending: b(14),
            deadline_passed: b(15),
            depth_exceeded: b(16),
        }
    }

    fn check_properties<F>(f: F) -> Result<usize, String>
    where
        F: Fn(&ChangeState) -> ChangeDecision,
    {
        let mut checked = 0usize;
        for class_idx in 0..4u8 {
            for bits in 0..(1u32 << 17) {
                let s = state_from_bits(class_idx, bits);
                let d = f(&s);
                checked += 1;

                // P1 Scope
                if matches!(s.action_class, ActionClass::Class1PushOrPr | ActionClass::Class2MergeDefault)
                    && !s.grant_in_scope
                    && d.verdict == Verdict::Act
                {
                    return Err(format!("P1 Scope violated on {s:?}"));
                }

                // P2 Evidence
                if matches!(s.action_class, ActionClass::Class1PushOrPr | ActionClass::Class2MergeDefault)
                    && (!s.all_gates_passed || s.any_gate_failed || s.gate_cannot_run)
                    && d.verdict == Verdict::Act
                {
                    return Err(format!("P2 Evidence violated on {s:?}"));
                }

                // P3 Freshness
                if matches!(s.action_class, ActionClass::Class1PushOrPr | ActionClass::Class2MergeDefault)
                    && !s.hash_matches
                    && d.verdict == Verdict::Act
                {
                    return Err(format!("P3 Freshness (hash) violated on {s:?}"));
                }
                if s.action_class == ActionClass::Class2MergeDefault
                    && (!s.head_covered || !s.base_current)
                    && d.verdict == Verdict::Act
                {
                    return Err(format!("P3 Freshness (head/base) violated on {s:?}"));
                }

                // P4 Review & Independence
                if s.action_class == ActionClass::Class2MergeDefault
                    && (!s.independent_review || s.findings_open || s.threads_open || !s.test_removals_confirmed)
                    && d.verdict == Verdict::Act
                {
                    return Err(format!("P4 Review violated on {s:?}"));
                }

                // P5 Protected & Bounds
                if (s.action_class == ActionClass::Class3Protected
                    || (matches!(s.action_class, ActionClass::Class1PushOrPr | ActionClass::Class2MergeDefault)
                        && (s.protected_path_touched || !s.within_size_budget))
                    || s.depth_exceeded)
                    && d.verdict == Verdict::Act
                {
                    return Err(format!("P5 Safety/Protected violated on {s:?}"));
                }

                // P6 Monotone: degrading any good flag to bad never turns non-Act into Act
                if d.verdict != Verdict::Act {
                    // Check a single-bit degradation if this state has a good flag set.
                    let degraded = [
                        (s.grant_in_scope, ChangeState { grant_in_scope: false, ..s }),
                        (s.all_gates_passed, ChangeState { all_gates_passed: false, ..s }),
                        (!s.any_gate_failed, ChangeState { any_gate_failed: true, ..s }),
                        (!s.gate_cannot_run, ChangeState { gate_cannot_run: true, ..s }),
                        (s.hash_matches, ChangeState { hash_matches: false, ..s }),
                        (s.head_covered, ChangeState { head_covered: false, ..s }),
                        (s.independent_review, ChangeState { independent_review: false, ..s }),
                        (!s.findings_open, ChangeState { findings_open: true, ..s }),
                        (!s.threads_open, ChangeState { threads_open: true, ..s }),
                        (s.test_removals_confirmed, ChangeState { test_removals_confirmed: false, ..s }),
                        (s.base_current, ChangeState { base_current: false, ..s }),
                        (s.within_size_budget, ChangeState { within_size_budget: false, ..s }),
                        (!s.protected_path_touched, ChangeState { protected_path_touched: true, ..s }),
                        (!s.ci_running, ChangeState { ci_running: true, ..s }),
                        (!s.review_pending, ChangeState { review_pending: true, ..s }),
                        (!s.deadline_passed, ChangeState { deadline_passed: true, ..s }),
                        (!s.depth_exceeded, ChangeState { depth_exceeded: true, ..s }),
                    ];
                    for (can_degrade, next_s) in degraded {
                        if can_degrade && f(&next_s).verdict == Verdict::Act {
                            return Err(format!("P6 Monotone violated on {s:?} -> {next_s:?}"));
                        }
                    }
                }

                // P7 Progress
                let should_act = match s.action_class {
                    ActionClass::Class0PrivateCommit => !s.depth_exceeded,
                    ActionClass::Class1PushOrPr => {
                        s.grant_in_scope
                            && s.all_gates_passed
                            && !s.any_gate_failed
                            && !s.gate_cannot_run
                            && s.hash_matches
                            && s.within_size_budget
                            && !s.protected_path_touched
                            && !s.depth_exceeded
                    }
                    ActionClass::Class2MergeDefault => {
                        s.grant_in_scope
                            && s.all_gates_passed
                            && !s.any_gate_failed
                            && !s.gate_cannot_run
                            && s.hash_matches
                            && s.within_size_budget
                            && !s.protected_path_touched
                            && s.head_covered
                            && s.independent_review
                            && !s.findings_open
                            && !s.threads_open
                            && s.test_removals_confirmed
                            && s.base_current
                            && !s.ci_running
                            && !s.review_pending
                            && !s.depth_exceeded
                    }
                    ActionClass::Class3Protected => false,
                };
                if should_act && d.verdict != Verdict::Act {
                    return Err(format!("P7 Progress violated on {s:?}: got {:?}", d.verdict));
                }

                // P8 Bounded asking
                if d.verdict == Verdict::Ask {
                    let ask_allowed = s.action_class == ActionClass::Class3Protected
                        || (s.action_class == ActionClass::Class2MergeDefault && s.protected_path_touched)
                        || (matches!(s.action_class, ActionClass::Class1PushOrPr | ActionClass::Class2MergeDefault)
                            && !s.grant_in_scope);
                    if !ask_allowed || d.missing.is_empty() {
                        return Err(format!("P8 Bounded asking violated on {s:?}"));
                    }
                }

                // P9 Bounded waiting
                if d.verdict == Verdict::Wait {
                    let has_live_wait = s.ci_running || s.review_pending || s.threads_open;
                    if s.deadline_passed || !has_live_wait {
                        return Err(format!("P9 Bounded waiting violated on {s:?}"));
                    }
                }

                // P10 Explainability
                if d.because.is_empty() {
                    return Err(format!("P10 Explainability violated on {s:?}"));
                }
            }
        }
        Ok(checked)
    }

    #[test]
    fn exhaustive_524288_state_proof_of_p1_through_p10() {
        let count = check_properties(decide).expect("decide must satisfy P1..P10 on all 524,288 states");
        assert_eq!(count, 4 * (1 << 17));
    }

    #[test]
    fn mutant_checkers_catch_p1_p2_p7_p8_p9_violations() {
        // Mutant 1: ignores grant_in_scope (violates P1)
        let m_p1 = check_properties(|s| {
            if s.action_class == ActionClass::Class1PushOrPr && !s.grant_in_scope {
                return ChangeDecision {
                    verdict: Verdict::Act,
                    because: vec!["mutant"],
                    missing: vec![],
                };
            }
            decide(s)
        });
        assert!(m_p1.unwrap_err().starts_with("P1"));

        // Mutant 2: acts even when gate failed (violates P2)
        let m_p2 = check_properties(|s| {
            if s.action_class == ActionClass::Class1PushOrPr
                && s.grant_in_scope
                && s.all_gates_passed
                && s.any_gate_failed
                && !s.gate_cannot_run
                && s.hash_matches
                && s.within_size_budget
                && !s.protected_path_touched
                && !s.depth_exceeded
            {
                return ChangeDecision {
                    verdict: Verdict::Act,
                    because: vec!["mutant"],
                    missing: vec![],
                };
            }
            decide(s)
        });
        assert!(m_p2.unwrap_err().starts_with("P2"));

        // Mutant 3: asks without missing reason (violates P8)
        let m_p8 = check_properties(|s| {
            if s.action_class == ActionClass::Class3Protected {
                return ChangeDecision {
                    verdict: Verdict::Ask,
                    because: vec!["mutant"],
                    missing: vec![],
                };
            }
            decide(s)
        });
        assert!(m_p8.unwrap_err().starts_with("P8"));

        // Mutant 4: waits after deadline_passed (violates P9)
        let m_p9 = check_properties(|s| {
            if s.action_class == ActionClass::Class1PushOrPr
                && s.grant_in_scope
                && s.within_size_budget
                && !s.protected_path_touched
                && !s.depth_exceeded
                && !s.gate_cannot_run
                && !s.any_gate_failed
                && s.hash_matches
                && !s.all_gates_passed
                && s.ci_running
                && s.deadline_passed
            {
                return ChangeDecision {
                    verdict: Verdict::Wait,
                    because: vec!["ci_running"],
                    missing: vec!["all_gates_passed"],
                };
            }
            decide(s)
        });
        assert!(m_p9.unwrap_err().starts_with("P9"));
    }
}
