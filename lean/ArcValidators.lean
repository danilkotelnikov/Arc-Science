/-
ArcValidators.lean — Machine-checked specifications for `native/arc-validators`
(`seal_guard` and `grants_net`), aligned with `lib/native/validators.mjs`.
All theorems compile under Lean 4.34.1 core with zero `sorry` or non-standard axioms.
-/

namespace ArcValidators

/-! ## Part 1: `seal_guard` — Path traversal, segment-prefix sealing, and digest matching -/

abbrev Segment := String

def hasTraversal (segs : List Segment) : Bool :=
  segs.any (· == "..")

def isSegmentPrefix : List Segment → List Segment → Bool
  | [], _ => true
  | _ :: _, [] => false
  | p :: ps, s :: ss => p == s && isSegmentPrefix ps ss

def pathIsSealed (sealed : List (List Segment)) (target : List Segment) : Bool :=
  sealed.any (fun root => isSegmentPrefix root target)

inductive SealCode where
  | ok
  | errTraversal
  | errSealedWrite
  | errDigestMismatch
  deriving DecidableEq, Repr

structure SealVerdict where
  allowed : Bool
  code : SealCode
  deriving DecidableEq, Repr

def checkSealGuard
    (target : List Segment)
    (isWrite : Bool)
    (sealed : List (List Segment))
    (expectedDigest actualDigest : Option String) : SealVerdict :=
  if hasTraversal target then
    { allowed := false, code := SealCode.errTraversal }
  else if isWrite && pathIsSealed sealed target then
    { allowed := false, code := SealCode.errSealedWrite }
  else
    match expectedDigest, actualDigest with
    | some exp, some act =>
      if act == exp then { allowed := true, code := SealCode.ok }
      else { allowed := false, code := SealCode.errDigestMismatch }
    | _, _ => { allowed := true, code := SealCode.ok }

theorem seal_traversal_denied
    (target : List Segment) (isWrite : Bool) (sealed : List (List Segment))
    (exp act : Option String)
    (htrav : hasTraversal target = true) :
    (checkSealGuard target isWrite sealed exp act).allowed = false := by
  simp [checkSealGuard, htrav]

theorem seal_sealed_write_denied
    (target : List Segment) (sealed : List (List Segment))
    (exp act : Option String)
    (hclean : hasTraversal target = false)
    (hseal : pathIsSealed sealed target = true) :
    (checkSealGuard target true sealed exp act).allowed = false := by
  simp [checkSealGuard, hclean, hseal]

theorem seal_digest_mismatch_denied
    (target : List Segment) (isWrite : Bool) (sealed : List (List Segment))
    (exp act : String)
    (hclean : hasTraversal target = false)
    (hnowrite : (isWrite && pathIsSealed sealed target) = false)
    (hne : (act == exp) = false) :
    (checkSealGuard target isWrite sealed (some exp) (some act)).allowed = false := by
  simp [checkSealGuard, hclean, hnowrite, hne]

theorem seal_segment_prefix_exact
    (p : List Segment) : isSegmentPrefix p p = true := by
  induction p with
  | nil => rfl
  | cons h t ih => simp [isSegmentPrefix, ih]

theorem seal_segment_no_sibling_bleed :
    isSegmentPrefix ["scripts", "seal"] ["scripts", "seal_other"] = false := by
  decide

-- Mutant refutation: naive character-prefix guard false-positives sibling path
def mutantCharPrefix : List Char → List Char → Bool
  | [], _ => true
  | _ :: _, [] => false
  | p :: ps, t :: ts => p == t && mutantCharPrefix ps ts

theorem mutant_flat_prefix_wrong_on_sibling :
    mutantCharPrefix "scripts/seal".toList "scripts/seal_other".toList = true ∧
    isSegmentPrefix ["scripts", "seal"] ["scripts", "seal_other"] = false := by
  decide

-- Non-vacuity witnesses: clean write succeeds, sealed write fails
example : (checkSealGuard ["plugins", "arc-hoh", "lib", "formal.js"] true [["tools", "build.mjs"]] none none).allowed = true := by
  decide

example : (checkSealGuard ["tools", "build.mjs"] true [["tools", "build.mjs"]] none none).allowed = false := by
  decide

/-! ## Part 2: `grants_net` — Timed capability grants and endpoint allowlisting -/

def thirtyDaysMs : Nat := 2592000000

inductive GrantMode where
  | revoke
  | singleAction
  | grant30Days
  | unknown
  deriving DecidableEq, Repr

def evaluateGrant (mode : GrantMode) (issuedMs nowMs : Nat) (revoked : Bool) : Bool :=
  if revoked then false
  else match mode with
    | GrantMode.revoke => false
    | GrantMode.singleAction => nowMs == issuedMs
    | GrantMode.grant30Days => nowMs < issuedMs + thirtyDaysMs
    | GrantMode.unknown => false

theorem grant_revoked_never_active
    (mode : GrantMode) (issuedMs nowMs : Nat) :
    evaluateGrant mode issuedMs nowMs true = false := by
  simp [evaluateGrant]

theorem grant_revoke_mode_never_active
    (issuedMs nowMs : Nat) (revoked : Bool) :
    evaluateGrant GrantMode.revoke issuedMs nowMs revoked = false := by
  cases revoked <;> simp [evaluateGrant]

theorem grant_single_action_consumed_later
    (issuedMs nowMs : Nat) (revoked : Bool)
    (hlater : issuedMs < nowMs) :
    evaluateGrant GrantMode.singleAction issuedMs nowMs revoked = false := by
  have hne : nowMs ≠ issuedMs := Nat.ne_of_gt hlater
  cases revoked
  · simp [evaluateGrant, hne]
  · simp [evaluateGrant]

theorem grant_30d_expired_denied
    (issuedMs nowMs : Nat) (revoked : Bool)
    (hexp : issuedMs + thirtyDaysMs ≤ nowMs) :
    evaluateGrant GrantMode.grant30Days issuedMs nowMs revoked = false := by
  have hnot : ¬ (nowMs < issuedMs + thirtyDaysMs) := Nat.not_lt.mpr hexp
  cases revoked
  · simp [evaluateGrant, hnot]
  · simp [evaluateGrant]

theorem grant_30d_monotone_expiry
    (issuedMs t1 t2 : Nat) (revoked : Bool)
    (hle : t1 ≤ t2)
    (hden : evaluateGrant GrantMode.grant30Days issuedMs t1 revoked = false) :
    evaluateGrant GrantMode.grant30Days issuedMs t2 revoked = false := by
  cases revoked
  · simp [evaluateGrant] at hden ⊢
    omega
  · simp [evaluateGrant]

-- Mutant refutation: ignoring `revoked` lets a revoked grant pass during the window
def mutantGrantIgnoreRevoke (mode : GrantMode) (issuedMs nowMs : Nat) (_revoked : Bool) : Bool :=
  evaluateGrant mode issuedMs nowMs false

theorem mutant_grant_ignore_revoke_unsafe :
    mutantGrantIgnoreRevoke GrantMode.grant30Days 1000 2000 true = true ∧
    evaluateGrant GrantMode.grant30Days 1000 2000 true = false := by
  decide

-- Non-vacuity witness
example : evaluateGrant GrantMode.grant30Days 1000 2000 false = true := by
  decide

/-! ## Part 3: `evaluateNetEndpoint` — Default-deny host/port/wildcard policy -/

def isValidPort (port : Nat) : Bool :=
  1 ≤ port && port ≤ 65535

def isWildcardHost (host : String) : Bool :=
  host == "" || host == "0.0.0.0" || host == "::"

def isLoopbackHost (host : String) : Bool :=
  host == "127.0.0.1" || host == "::1"

def evaluateNetEndpoint (host : String) (port : Nat) (allowedHosts : List String) : Bool :=
  if !isValidPort port then false
  else if isWildcardHost host then false
  else if isLoopbackHost host then true
  else allowedHosts.contains host

theorem net_invalid_port_denied
    (host : String) (port : Nat) (allowed : List String)
    (hbad : port = 0 ∨ port > 65535) :
    evaluateNetEndpoint host port allowed = false := by
  have hp : isValidPort port = false := by
    simp [isValidPort]
    rcases hbad with rfl | hgt
    · decide
    · omega
  simp [evaluateNetEndpoint, hp]

theorem net_wildcard_never_allowed
    (port : Nat) (allowed : List String) :
    evaluateNetEndpoint "0.0.0.0" port allowed = false ∧
    evaluateNetEndpoint "::" port allowed = false ∧
    evaluateNetEndpoint "" port allowed = false := by
  refine ⟨?_, ?_, ?_⟩
  · cases h : isValidPort port <;> simp [evaluateNetEndpoint, isWildcardHost, h]
  · cases h : isValidPort port <;> simp [evaluateNetEndpoint, isWildcardHost, h]
  · cases h : isValidPort port <;> simp [evaluateNetEndpoint, isWildcardHost, h]

theorem net_unlisted_external_denied
    (host : String) (port : Nat) (allowed : List String)
    (hnloop : isLoopbackHost host = false)
    (hnallow : ¬ (host ∈ allowed)) :
    evaluateNetEndpoint host port allowed = false := by
  cases hp : isValidPort port
  · simp [evaluateNetEndpoint, hp]
  · cases hw : isWildcardHost host
    · simp [evaluateNetEndpoint, hp, hw, hnloop, hnallow]
    · simp [evaluateNetEndpoint, hp, hw]

-- Mutant refutation: checking allowlist before wildcard guard admits "0.0.0.0" if misconfigured
def mutantAllowFirst (host : String) (port : Nat) (allowed : List String) : Bool :=
  if !isValidPort port then false
  else allowed.contains host || isLoopbackHost host

theorem mutant_allow_first_unsafe :
    mutantAllowFirst "0.0.0.0" 7424 ["0.0.0.0"] = true ∧
    evaluateNetEndpoint "0.0.0.0" 7424 ["0.0.0.0"] = false := by
  decide

-- Non-vacuity witnesses
example : evaluateNetEndpoint "127.0.0.1" 7424 [] = true := by decide
example : evaluateNetEndpoint "evil.example" 443 ["api.example"] = false := by decide

#print axioms seal_traversal_denied
#print axioms seal_sealed_write_denied
#print axioms seal_digest_mismatch_denied
#print axioms seal_segment_prefix_exact
#print axioms seal_segment_no_sibling_bleed
#print axioms mutant_flat_prefix_wrong_on_sibling
#print axioms grant_revoked_never_active
#print axioms grant_revoke_mode_never_active
#print axioms grant_single_action_consumed_later
#print axioms grant_30d_expired_denied
#print axioms grant_30d_monotone_expiry
#print axioms mutant_grant_ignore_revoke_unsafe
#print axioms net_invalid_port_denied
#print axioms net_wildcard_never_allowed
#print axioms net_unlisted_external_denied
#print axioms mutant_allow_first_unsafe

end ArcValidators
