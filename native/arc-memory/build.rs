//! Embeds the digest of the sources the worker is built from (ARC_MEMORY_SOURCE_DIGEST), so a
//! test locator can refuse a worker built from other sources: a stale build, or one from
//! another checkout sharing the cargo target directory. Mirrored by source_digest() in
//! apps/arc-science/tests/test_memory_client.py.
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read src") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

fn main() {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let mut files = vec![root.join("Cargo.toml"), root.join("Cargo.lock")];
    walk(&root.join("src"), &mut files);
    let mut named: Vec<(String, PathBuf)> = files
        .into_iter()
        .map(|f| {
            (
                f.strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                f,
            )
        })
        .collect();
    named.sort();
    let mut all = Sha256::new();
    for (rel, file) in named {
        let one = hex::encode(Sha256::digest(std::fs::read(file).expect("read source")));
        all.update(format!("{rel}\n{one}\n").as_bytes());
    }
    println!(
        "cargo:rustc-env=ARC_MEMORY_SOURCE_DIGEST={}",
        hex::encode(all.finalize())
    );
    for watched in ["src", "Cargo.toml", "Cargo.lock"] {
        println!("cargo:rerun-if-changed={watched}");
    }
}
