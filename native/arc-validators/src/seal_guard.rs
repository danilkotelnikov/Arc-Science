// Module 1 (seal_guard): Pre-tool guard checking path traversal, sealed file lists, and SHA-256 integrity.
use crate::sha256::sha256_hex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealCheckResult {
    pub allowed: bool,
    pub code: &'static str,
    pub detail: String,
    pub actual_sha256: Option<String>,
}

fn normalize_rel(p: &str) -> String {
    p.replace('\\', "/").trim().trim_start_matches("./").to_ascii_lowercase()
}

pub fn has_path_traversal(target_path: &str) -> bool {
    let unified = target_path.replace('\\', "/");
    unified.split('/').any(|seg| seg == "..")
}

pub fn check_seal_guard(
    target_path: &str,
    is_write: bool,
    sealed_paths: &[&str],
    expected_sha256: Option<&str>,
    content: Option<&[u8]>,
) -> SealCheckResult {
    if has_path_traversal(target_path) {
        return SealCheckResult {
            allowed: false,
            code: "ERR_SEAL_TRAVERSAL",
            detail: format!("path traversal refused: {}", target_path),
            actual_sha256: None,
        };
    }

    let norm_target = normalize_rel(target_path);
    let is_sealed = sealed_paths.iter().any(|s| {
        let ns = normalize_rel(s);
        norm_target == ns || norm_target.starts_with(&format!("{}/", ns.trim_end_matches('/')))
    });

    if is_write && is_sealed {
        return SealCheckResult {
            allowed: false,
            code: "ERR_SEALED_WRITE_BLOCKED",
            detail: format!("sealed path cannot be modified without approval: {}", target_path),
            actual_sha256: None,
        };
    }

    if let (Some(expected), Some(bytes)) = (expected_sha256, content) {
        let actual = sha256_hex(bytes);
        let clean_expected = expected.trim().strip_prefix("sha256:").unwrap_or(expected.trim());
        if !actual.eq_ignore_ascii_case(clean_expected) {
            return SealCheckResult {
                allowed: false,
                code: "ERR_SEAL_DIGEST_MISMATCH",
                detail: format!("sealed digest mismatch for {}", target_path),
                actual_sha256: Some(actual),
            };
        }
        return SealCheckResult {
            allowed: true,
            code: "OK",
            detail: "sealed digest verified".to_string(),
            actual_sha256: Some(actual),
        };
    }

    SealCheckResult {
        allowed: true,
        code: "OK",
        detail: "seal guard passed".to_string(),
        actual_sha256: content.map(sha256_hex),
    }
}
