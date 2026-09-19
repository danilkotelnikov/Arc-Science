//! Embed the Windows icon and version block with the SDK's own `rc.exe`; no build
//! crate is needed. When the target is not Windows, or no resource compiler is
//! found, the binary still builds and a warning says the resources were skipped.
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=assets/arc-science.rc");
    println!("cargo:rerun-if-changed=assets/arc-science.ico");
    println!("cargo:rerun-if-env-changed=ARC_RC_EXE");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let Some(rc) = resource_compiler() else {
        println!(
            "cargo:warning=rc.exe not found; the executable is built without its icon and version block"
        );
        return;
    };
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let res = out.join("arc-science.res");
    let script = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"))
        .join("assets")
        .join("arc-science.rc");
    let status = Command::new(&rc)
        .arg("/nologo")
        .arg(format!("/fo{}", res.display()))
        .arg(&script)
        .status();
    match status {
        Ok(status) if status.success() => {
            println!("cargo:rustc-link-arg-bins={}", res.display());
        }
        Ok(status) => println!("cargo:warning=rc.exe exited with {status}; resources skipped"),
        Err(error) => println!(
            "cargo:warning=cannot run {}: {error}; resources skipped",
            rc.display()
        ),
    }
}

/// `ARC_RC_EXE`, `rc.exe` on PATH, or the newest Windows 10/11 SDK copy.
fn resource_compiler() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("ARC_RC_EXE") {
        return Some(PathBuf::from(explicit));
    }
    if Command::new("rc.exe").arg("/?").output().is_ok() {
        return Some(PathBuf::from("rc.exe"));
    }
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86") => "x86",
        _ => "x64",
    };
    let kits = std::env::var_os("ProgramFiles(x86)")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"))
        .join("Windows Kits")
        .join("10")
        .join("bin");
    let mut versions: Vec<PathBuf> = std::fs::read_dir(&kits)
        .ok()?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.join(arch).join("rc.exe").is_file())
        .collect();
    versions.sort();
    versions
        .pop()
        .map(|version| version.join(arch).join("rc.exe"))
}
