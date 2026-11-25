#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DistTarget {
    pub triple: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
    pub binary_suffix: &'static str,
    pub archive_format: &'static str,
    pub tls_backend: &'static str,
    pub sandbox_backend: &'static str,
    pub credential_store: &'static str,
}

pub const DIST_TARGETS: [DistTarget; 5] = [
    DistTarget {
        triple: "x86_64-pc-windows-msvc",
        os: "windows",
        arch: "x86_64",
        binary_suffix: ".exe",
        archive_format: ".zip",
        tls_backend: "rustls",
        sandbox_backend: "windows-appcontainer-job",
        credential_store: "windows-credential-manager",
    },
    DistTarget {
        triple: "aarch64-pc-windows-msvc",
        os: "windows",
        arch: "aarch64",
        binary_suffix: ".exe",
        archive_format: ".zip",
        tls_backend: "rustls",
        sandbox_backend: "windows-appcontainer-job",
        credential_store: "windows-credential-manager",
    },
    DistTarget {
        triple: "x86_64-unknown-linux-musl",
        os: "linux",
        arch: "x86_64",
        binary_suffix: "",
        archive_format: ".tar.xz",
        tls_backend: "rustls",
        sandbox_backend: "linux-landlock-seccomp",
        credential_store: "linux-secret-service-or-file",
    },
    DistTarget {
        triple: "aarch64-unknown-linux-musl",
        os: "linux",
        arch: "aarch64",
        binary_suffix: "",
        archive_format: ".tar.xz",
        tls_backend: "rustls",
        sandbox_backend: "linux-landlock-seccomp",
        credential_store: "linux-secret-service-or-file",
    },
    DistTarget {
        triple: "aarch64-apple-darwin",
        os: "macos",
        arch: "aarch64",
        binary_suffix: "",
        archive_format: ".tar.xz",
        tls_backend: "rustls",
        sandbox_backend: "macos-seatbelt",
        credential_store: "macos-keychain",
    },
];

pub fn targets_to_json() -> String {
    let mut out = String::from("[");
    for (idx, t) in DIST_TARGETS.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"triple\":\"{}\",\"os\":\"{}\",\"arch\":\"{}\",\"binary_suffix\":\"{}\",\"archive_format\":\"{}\",\"tls_backend\":\"{}\",\"sandbox_backend\":\"{}\",\"credential_store\":\"{}\"}}",
            t.triple,
            t.os,
            t.arch,
            t.binary_suffix,
            t.archive_format,
            t.tls_backend,
            t.sandbox_backend,
            t.credential_store
        ));
    }
    out.push(']');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_five_target_matrix_covers_windows_arm_linux_and_macos() {
        assert_eq!(DIST_TARGETS.len(), 5);
        let triples: Vec<&str> = DIST_TARGETS.iter().map(|t| t.triple).collect();
        assert_eq!(
            triples,
            vec![
                "x86_64-pc-windows-msvc",
                "aarch64-pc-windows-msvc",
                "x86_64-unknown-linux-musl",
                "aarch64-unknown-linux-musl",
                "aarch64-apple-darwin",
            ]
        );
        for t in DIST_TARGETS {
            assert_eq!(t.tls_backend, "rustls");
            assert!(t.arch == "x86_64" || t.arch == "aarch64");
        }
    }
}
