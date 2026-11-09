// Module 5 (grants, anchored, net):
// - 30-day consent grant evaluator
// - Byte-compatible hash-chained ledger digest (matches Node/Python golden vectors)
// - Loopback and allowlist network endpoint guard
use crate::sha256::sha256_hex;

pub const THIRTY_DAYS_MS: u64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantStatus {
    pub active: bool,
    pub reason: &'static str,
    pub expires_at_ms: u64,
}

pub fn evaluate_grant(mode: &str, issued_ms: u64, now_ms: u64, revoked: bool) -> GrantStatus {
    if revoked || mode.eq_ignore_ascii_case("Revoke") {
        return GrantStatus {
            active: false,
            reason: "revoked",
            expires_at_ms: issued_ms,
        };
    }
    if mode.eq_ignore_ascii_case("Single action") {
        return GrantStatus {
            active: now_ms == issued_ms,
            reason: if now_ms == issued_ms { "single_action_valid" } else { "single_action_consumed" },
            expires_at_ms: issued_ms,
        };
    }
    if mode.eq_ignore_ascii_case("Grant for 30 days") {
        let expires = issued_ms.saturating_add(THIRTY_DAYS_MS);
        if now_ms < expires {
            return GrantStatus {
                active: true,
                reason: "active_30d",
                expires_at_ms: expires,
            };
        }
        return GrantStatus {
            active: false,
            reason: "expired_30d",
            expires_at_ms: expires,
        };
    }
    GrantStatus {
        active: false,
        reason: "unknown_mode",
        expires_at_ms: issued_ms,
    }
}

/// Computes the byte-compatible anchored ledger digest:
/// `sha256:<hex(sha256(prev_hash + "|" + seq + "|" + kind + "|" + sha256(canonical_payload)))>`
pub fn anchored_entry_digest(prev_hash: &str, seq: u64, kind: &str, canonical_payload: &str) -> String {
    let payload_hex = sha256_hex(canonical_payload.as_bytes());
    let preimage = format!("{}|{}|{}|{}", prev_hash, seq, kind, payload_hex);
    format!("sha256:{}", sha256_hex(preimage.as_bytes()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetVerdict {
    pub allowed: bool,
    pub reason: &'static str,
}

pub fn evaluate_net_endpoint(host: &str, port: u16, allowed_hosts: &[&str]) -> NetVerdict {
    if port == 0 {
        return NetVerdict { allowed: false, reason: "invalid_port" };
    }
    let clean = host.trim().to_ascii_lowercase();
    if clean.is_empty() || clean == "0.0.0.0" || clean == "::" {
        return NetVerdict { allowed: false, reason: "wildcard_bind_forbidden" };
    }
    if clean == "127.0.0.1" || clean == "::1" {
        return NetVerdict { allowed: true, reason: "loopback" };
    }
    if allowed_hosts.iter().any(|h| h.trim().eq_ignore_ascii_case(&clean)) {
        return NetVerdict { allowed: true, reason: "allowlisted_host" };
    }
    NetVerdict { allowed: false, reason: "unapproved_host" }
}
