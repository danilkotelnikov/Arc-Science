/-
ArcCheckers.lean — Machine-checked invariants for the five pure HoH checkers (Card C7, G7.6):
  1. `level_walk_sound`
  2. `context_budget_invariant`
  3. `ledger_chain_tamper`
  4. `file_lease_exclusive`
  5. `ips_score_support`
Compiled under Lean 4.34.1 core with zero `sorry` or non-standard axioms.
-/

namespace ArcCheckers

/-! ## 1. `level_walk_sound`: Evidence DAG monotone level bound -/

-- Rank order: 0 = target, 1 = architecture, 2 = simulated, 3 = published, 4 = measured, 5 = machine-checked
def dagNodeOk (nodeRank : Nat) (depRanks : List Nat) : Prop :=
  ∀ r ∈ depRanks, nodeRank ≤ r

theorem level_walk_sound_trans
    (claimRank midRank rootRank : Nat)
    (h1 : claimRank ≤ midRank)
    (h2 : midRank ≤ rootRank) :
    claimRank ≤ rootRank := by
  omega

theorem level_walk_machine_requires_all_deps
    (r : Nat) (depRanks : List Nat)
    (hok : dagNodeOk 5 depRanks)
    (hr : r ∈ depRanks) :
    5 ≤ r :=
  hok r hr

theorem level_walk_escalation_rejected
    (nodeRank depRank : Nat)
    (hbad : depRank < nodeRank) :
    ¬ dagNodeOk nodeRank [depRank] := by
  intro h
  have := h depRank (by simp)
  omega

example : dagNodeOk 3 [3, 4, 5] := by
  intro r hr
  simp at hr
  omega

/-! ## 2. `context_budget_invariant`: Token/byte prefix and residual cap safety -/

def sumNats : List Nat → Nat
  | [] => 0
  | x :: xs => x + sumNats xs

theorem take_sum_le_sum (k : Nat) (xs : List Nat) :
    sumNats (xs.take k) ≤ sumNats xs := by
  induction k generalizing xs with
  | zero => simp [sumNats]
  | succ k ih =>
    cases xs with
    | nil => simp [sumNats]
    | cons _ xs =>
      simp [List.take, sumNats]
      exact ih xs

theorem context_budget_invariant
    (cap : Nat) (slices : List Nat) (k : Nat)
    (hfit : sumNats slices ≤ cap) :
    sumNats (slices.take k) ≤ cap := by
  exact Nat.le_trans (take_sum_le_sum k slices) hfit

theorem context_budget_step_nonneg_residual
    (rem cost : Nat) (rest : List Nat)
    (hfit : cost + sumNats rest ≤ rem) :
    sumNats rest ≤ rem - cost := by
  omega

example : sumNats ([400, 300, 200].take 2) ≤ 1000 := by
  decide

/-! ## 3. `ledger_chain_tamper`: Injectivity implies payload tamper breaks link verification -/

structure ChainEntry where
  prev : Nat
  payload : Nat
  hash : Nat
  deriving DecidableEq, Repr

def entryLinkOk (compress : Nat → Nat → Nat) (e : ChainEntry) : Prop :=
  e.hash = compress e.prev e.payload

def chainOk (compress : Nat → Nat → Nat) : Nat → List ChainEntry → Prop
  | _, [] => True
  | expectedPrev, e :: es =>
    e.prev = expectedPrev ∧ entryLinkOk compress e ∧ chainOk compress e.hash es

theorem ledger_chain_tamper
    (compress : Nat → Nat → Nat)
    (hinj : ∀ p₁ a₁ p₂ a₂, compress p₁ a₁ = compress p₂ a₂ → p₁ = p₂ ∧ a₁ = a₂)
    (expectedPrev : Nat) (e e' : ChainEntry) (rest : List ChainEntry)
    (hok : chainOk compress expectedPrev (e :: rest))
    (hhash : e'.hash = e.hash)
    (hpayload_ne : e'.payload ≠ e.payload) :
    ¬ chainOk compress expectedPrev (e' :: rest) := by
  intro hbad
  rcases hok with ⟨_, hlink, _⟩
  rcases hbad with ⟨_, hlink', _⟩
  unfold entryLinkOk at hlink hlink'
  have eqComp : compress e'.prev e'.payload = compress e.prev e.payload := by
    rw [← hlink', hhash, hlink]
  have ⟨_, hp⟩ := hinj e'.prev e'.payload e.prev e.payload eqComp
  exact hpayload_ne hp

-- Finite concrete witness: `compress p a = p * 1000 + a`
example :
    let compress := fun p a => p * 1000 + a
    let e := { prev := 7, payload := 42, hash := 7042 : ChainEntry }
    let tampered := { prev := 7, payload := 99, hash := 7042 : ChainEntry }
    entryLinkOk compress e ∧ ¬ entryLinkOk compress tampered := by
  simp [entryLinkOk]

/-! ## 4. `file_lease_exclusive`: Exclusive path ownership invariant -/

abbrev LeaseEntry := String × String

def hasExclusiveLease (leases : List LeaseEntry) (filePath : String) (holder : String) : Prop :=
  ∀ h ∈ leases, h.1 = filePath → h.2 = holder

def leaseTableExclusive (leases : List LeaseEntry) : Prop :=
  ∀ e₁ ∈ leases, ∀ e₂ ∈ leases, e₁.1 = e₂.1 → e₁.2 = e₂.2

def tryAcquireLease (leases : List LeaseEntry) (filePath holder : String) : Option (List LeaseEntry) :=
  if leases.any (fun e => e.1 == filePath && e.2 != holder) then none
  else some ((filePath, holder) :: leases)

theorem any_conflict_false_implies_holder_eq
    (leases : List LeaseEntry) (filePath holder : String)
    (hno : (leases.any (fun e => e.1 == filePath && e.2 != holder)) = false)
    {e : LeaseEntry} (he : e ∈ leases) (hp : e.1 = filePath) :
    e.2 = holder := by
  by_cases hne : e.2 = holder
  · exact hne
  · have hmem : leases.any (fun x => x.1 == filePath && x.2 != holder) = true :=
      List.any_eq_true.mpr ⟨e, he, by simp [hp, hne]⟩
    rw [hno] at hmem
    contradiction

theorem file_lease_exclusive
    (leases leases' : List LeaseEntry) (filePath holder : String)
    (hinv : leaseTableExclusive leases)
    (hacq : tryAcquireLease leases filePath holder = some leases') :
    leaseTableExclusive leases' := by
  cases hcon : leases.any (fun e => e.1 == filePath && e.2 != holder) with
  | true =>
    simp [tryAcquireLease, hcon] at hacq
  | false =>
    simp [tryAcquireLease, hcon] at hacq
    subst hacq
    intro e₁ he₁ e₂ he₂ heq
    simp at he₁ he₂
    rcases he₁ with rfl | he₁ <;> rcases he₂ with rfl | he₂
    · rfl
    · exact (any_conflict_false_implies_holder_eq leases filePath holder hcon he₂ heq.symm).symm
    · exact any_conflict_false_implies_holder_eq leases filePath holder hcon he₁ heq
    · exact hinv e₁ he₁ e₂ he₂ heq

example :
    tryAcquireLease [("formal.js", "builder")] "formal.js" "checker" = none ∧
    (tryAcquireLease [("formal.js", "builder")] "claims.js" "checker").isSome = true := by
  decide

/-! ## 5. `ips_score_support`: Finite-support inverse-propensity condition -/

-- Exact discrete support check: every action with positive target mass pi(a) > 0 must have logging mass mu(a) > 0
def ipsSupportOk {α : Type} (pi mu : α → Nat) (actions : List α) : Prop :=
  ∀ a ∈ actions, 0 < pi a → 0 < mu a

-- Cross-multiplied term avoids division-by-zero by asserting positivity of denominator `mu a`
-- whenever weight `pi a > 0`: `mu a * (pi a * reward a) = pi a * (mu a * reward a)`.
theorem ips_score_support
    {α : Type} (pi mu reward : α → Nat) (actions : List α)
    (hsupp : ipsSupportOk pi mu actions)
    {a : α} (ha : a ∈ actions) (hpos : 0 < pi a) :
    0 < mu a ∧ mu a * (pi a * reward a) = pi a * (mu a * reward a) := by
  exact ⟨hsupp a ha hpos, Nat.mul_left_comm (mu a) (pi a) (reward a)⟩

theorem ips_zero_propensity_violates_support
    {α : Type} (pi mu : α → Nat) (a : α) (actions : List α)
    (ha : a ∈ actions) (hpi : 0 < pi a) (hmu : mu a = 0) :
    ¬ ipsSupportOk pi mu actions := by
  intro h
  have := h a ha hpi
  omega

example : ipsSupportOk (fun i => if i < 2 then 50 else 0) (fun i => if i = 0 then 80 else 20) [0, 1, 2] := by
  intro a _ _
  dsimp
  split <;> omega

#print axioms level_walk_sound_trans
#print axioms level_walk_machine_requires_all_deps
#print axioms level_walk_escalation_rejected
#print axioms take_sum_le_sum
#print axioms context_budget_invariant
#print axioms context_budget_step_nonneg_residual
#print axioms ledger_chain_tamper
#print axioms file_lease_exclusive
#print axioms ips_score_support
#print axioms ips_zero_propensity_violates_support

/-! ## 6. `optimal_decision_rules`: Scaled Bayes VOI non-negativity, pairing, and taint exit guard -/

theorem voi_concavity_min (a1 b1 a2 b2 : Nat) :
    min a1 b1 + min a2 b2 ≤ min (a1 + a2) (b1 + b2) := by
  omega

theorem net_voi_decision_rule (riskBefore riskAfter cost : Nat)
    (h : riskAfter + cost < riskBefore) :
    cost < riskBefore - riskAfter := by
  omega

def pairOkNat (bFam cFam bTier minBTier cTier minCTier : Nat) (formalOk : Bool) : Bool :=
  (bFam != cFam) && (minBTier ≤ bTier) && (minCTier ≤ cTier) && formalOk

theorem cross_family_pair_sound (bFam cFam bTier minBTier cTier minCTier : Nat) (formalOk : Bool)
    (h : pairOkNat bFam cFam bTier minBTier cTier minCTier formalOk = true) :
    bFam ≠ cFam ∧ minBTier ≤ bTier ∧ minCTier ≤ cTier ∧ formalOk = true := by
  simp [pairOkNat] at h
  rcases h with ⟨⟨⟨h1, h2⟩, h3⟩, h4⟩
  exact ⟨h1, h2, h3, h4⟩

def allowExitNat (taint citations checksOk crossFam needsYes : Nat) : Bool :=
  (taint < 3) && (1 ≤ citations) && (checksOk == 1) && ((taint != 2) || (crossFam == 1)) && (needsYes == 0)

theorem decision_exit_guard_monotone (t1 t2 citations checksOk crossFam needsYes : Nat)
    (h : allowExitNat (max t1 t2) citations checksOk crossFam needsYes = true) :
    allowExitNat t1 citations checksOk crossFam needsYes = true := by
  simp [allowExitNat] at h ⊢
  rcases h with ⟨⟨⟨⟨ht, hc⟩, hchk⟩, hcf⟩, hny⟩
  refine ⟨⟨⟨⟨by omega, hc⟩, hchk⟩, ?_⟩, hny⟩
  rcases hcf with hne | hcf1
  · left; intro heq; apply hne; omega
  · right; exact hcf1

theorem secret_taint_blocks_exit (t1 citations checksOk crossFam needsYes : Nat) :
    allowExitNat (max t1 3) citations checksOk crossFam needsYes = false := by
  have hlt : ¬ (max t1 3 < 3) := by omega
  simp [allowExitNat, hlt]

theorem untrusted_web_requires_cross_family (citations checksOk needsYes : Nat) :
    allowExitNat 2 citations checksOk 0 needsYes = false := by
  simp [allowExitNat]

theorem operator_gate_blocks_exit (taint citations checksOk crossFam : Nat) :
    allowExitNat taint citations checksOk crossFam 1 = false := by
  simp [allowExitNat]

example : pairOkNat 1 2 2 1 2 1 true = true ∧ pairOkNat 1 1 2 1 2 1 true = false := by decide
example : allowExitNat (max 0 3) 2 1 1 0 = false ∧ allowExitNat 2 1 1 0 0 = false := by decide

#print axioms voi_concavity_min
#print axioms net_voi_decision_rule
#print axioms cross_family_pair_sound
#print axioms decision_exit_guard_monotone
#print axioms secret_taint_blocks_exit
#print axioms untrusted_web_requires_cross_family
#print axioms operator_gate_blocks_exit

end ArcCheckers
