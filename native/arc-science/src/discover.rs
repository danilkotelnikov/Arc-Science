//! Runtime discovery for a launch without a shell around it: the Python that will run
//! the worker, the package it imports, and the sibling native components. Discovery
//! reports what it found and how; it never installs anything and never guesses that a
//! missing piece is present.
use crate::Result;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

/// Wall-clock bound for each probe process; discovery must never hang a launch.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Discovery {
    pub python: Option<PathBuf>,
    pub python_version: Option<String>,
    pub package_path: Option<PathBuf>,
    pub memory_worker: Option<PathBuf>,
    pub svg2png: Option<PathBuf>,
    pub notes: Vec<String>,
}

/// The directory holding this supervisor executable, from which the development
/// layout (`<repo>/native/<crate>/target/<profile>/`) and a bundled layout
/// (`<dir>/` with siblings and `<dir>/lib/python`) are derived.
pub fn executable_directory() -> Option<PathBuf> {
    env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

/// Candidate package roots in preference order: an explicit override, a bundled
/// `lib/python` next to the executable, then the development layout.
pub fn package_candidates(exe_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(explicit) = env::var_os("ARC_PACKAGE_PATH") {
        out.push(PathBuf::from(explicit));
    }
    out.push(exe_dir.join("lib").join("python"));
    // <repo>/native/arc-science/target/release -> <repo>
    if let Some(repo) = exe_dir.ancestors().nth(4) {
        out.push(repo.join("apps").join("arc-science").join("src"));
    }
    out
}

pub fn is_package_root(path: &Path) -> bool {
    path.join("arc_science").join("__init__.py").is_file()
}

/// Candidate paths for a native component: an explicit override, a sibling of this
/// executable, then the development layout of the named crate.
pub fn component_candidates(exe_dir: &Path, crate_name: &str, binary: &str) -> Vec<PathBuf> {
    let name = if cfg!(windows) {
        format!("{binary}.exe")
    } else {
        binary.to_string()
    };
    let mut out = vec![exe_dir.join(&name)];
    if let Some(native) = exe_dir.ancestors().nth(3) {
        out.push(
            native
                .join(crate_name)
                .join("target")
                .join("release")
                .join(&name),
        );
    }
    out
}

fn first_file(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|c| c.is_file())
}

/// Run a probe with a deadline in its own contained tree (job object / process
/// group), draining stdout as it arrives so a noisy program cannot stall the launch;
/// returns trimmed stdout on success. Output is capped at 64 KiB.
fn probe(program: &Path, args: &[&str], env: &[(&str, &Path)]) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("PYTHONUTF8", "1");
    for (key, value) in env {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    let wrapper = process_wrap::std::ProcessGroup::leader();
    #[cfg(windows)]
    let wrapper = process_wrap::std::JobObject;
    let mut child = crate::acquire::spawn(command, wrapper).ok()?;
    let stdout = child.stdout().take()?;
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut out = Vec::new();
        let _ = stdout.take(64 * 1024).read_to_end(&mut out);
        out
    });
    let started = std::time::Instant::now();
    let status = loop {
        #[cfg(windows)]
        let waited = child.inner_mut().try_wait();
        #[cfg(not(windows))]
        let waited = child.try_wait();
        match waited {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() > PROBE_TIMEOUT => {
                let _ = child.start_kill();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => break None,
        }
    };
    let _ = child.wait();
    let out = reader.join().ok()?;
    if !status?.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out).trim().to_string())
}

/// The interpreter the launchers would find, resolved to its real `sys.executable`
/// and required to be 3.11 or newer.
pub fn python() -> (Option<PathBuf>, Option<String>, Vec<String>) {
    let mut notes = Vec::new();
    let launchers: &[(&str, &[&str])] = if cfg!(windows) {
        &[
            ("py", &["-3.12"]),
            ("py", &["-3.11"]),
            ("py", &["-3"]),
            ("python", &[]),
            ("python3", &[]),
        ]
    } else {
        &[
            ("python3.12", &[]),
            ("python3.11", &[]),
            ("python3", &[]),
            ("python", &[]),
        ]
    };
    for (program, prefix) in launchers {
        let Some(program) = crate::process::executable(program, Path::new(".")) else {
            continue;
        };
        let mut args: Vec<&str> = prefix.to_vec();
        args.extend([
            "-X",
            "utf8",
            "-c",
            "import sys;print(sys.executable);print('%d.%d' % sys.version_info[:2])",
        ]);
        let Some(out) = probe(&program, &args, &[]) else {
            notes.push(format!(
                "{} did not answer the version probe",
                program.display()
            ));
            continue;
        };
        let mut lines = out.lines();
        let (Some(exe), Some(version)) = (lines.next(), lines.next()) else {
            continue;
        };
        let supported = version
            .split_once('.')
            .and_then(|(major, minor)| {
                Some((major.parse::<u32>().ok()?, minor.parse::<u32>().ok()?))
            })
            .is_some_and(|(major, minor)| major == 3 && minor >= 11);
        if !supported {
            notes.push(format!(
                "{exe} is Python {version}; 3.11 or newer is required"
            ));
            continue;
        }
        return (Some(PathBuf::from(exe)), Some(version.to_string()), notes);
    }
    notes.push("No Python 3.11+ interpreter answered on PATH".into());
    (None, None, notes)
}

/// Whether the package imports under this interpreter with the candidate on PYTHONPATH.
pub fn import_check(python: &Path, package_path: &Path) -> std::result::Result<String, String> {
    probe(
        python,
        &[
            "-X",
            "utf8",
            "-c",
            "import arc_science;print(getattr(arc_science,'__version__','unknown'))",
        ],
        &[("PYTHONPATH", package_path)],
    )
    .map(|version| format!("arc_science {version}"))
    .ok_or_else(|| {
        format!(
            "arc_science does not import from {}",
            package_path.display()
        )
    })
}

pub fn run() -> Discovery {
    let exe_dir = executable_directory().unwrap_or_else(|| PathBuf::from("."));
    let (python, python_version, mut notes) = python();
    let package_path = package_candidates(&exe_dir)
        .into_iter()
        .find(|c| is_package_root(c));
    if package_path.is_none() {
        notes.push(
            "No arc_science package root next to the executable or in the development layout"
                .into(),
        );
    }
    if let (Some(python), Some(package)) = (&python, &package_path) {
        match import_check(python, package) {
            Ok(detail) => notes.push(detail),
            Err(detail) => notes.push(detail),
        }
    }
    Discovery {
        python,
        python_version,
        package_path,
        memory_worker: first_file(component_candidates(
            &exe_dir,
            "arc-memory",
            "arc-memory-worker",
        )),
        svg2png: first_file(component_candidates(&exe_dir, "arc-svg", "arc-svg2png")),
        notes,
    }
}

/// Make a discovered path project-independent: absolute, with `..` removed.
pub fn absolute(path: &Path) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()?.join(path)
    };
    Ok(fs::canonicalize(&absolute).unwrap_or(absolute))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_candidates_prefer_a_bundle_then_the_development_layout() {
        let exe_dir = Path::new("/repo/native/arc-science/target/release");
        let candidates = package_candidates(exe_dir);
        let tail: Vec<_> = candidates.iter().rev().take(2).rev().collect();
        assert_eq!(tail[0], &exe_dir.join("lib").join("python"));
        assert_eq!(
            tail[1],
            &Path::new("/repo")
                .join("apps")
                .join("arc-science")
                .join("src")
        );
    }

    #[test]
    fn component_candidates_look_beside_the_executable_first() {
        let exe_dir = Path::new("/repo/native/arc-science/target/release");
        let candidates = component_candidates(exe_dir, "arc-memory", "arc-memory-worker");
        let name = if cfg!(windows) {
            "arc-memory-worker.exe"
        } else {
            "arc-memory-worker"
        };
        assert_eq!(candidates[0], exe_dir.join(name));
        assert_eq!(
            candidates[1],
            Path::new("/repo/native")
                .join("arc-memory")
                .join("target")
                .join("release")
                .join(name)
        );
    }

    #[test]
    fn a_package_root_needs_the_package_init() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_package_root(dir.path()));
        fs::create_dir_all(dir.path().join("arc_science")).unwrap();
        fs::write(dir.path().join("arc_science").join("__init__.py"), "").unwrap();
        assert!(is_package_root(dir.path()));
    }
}
