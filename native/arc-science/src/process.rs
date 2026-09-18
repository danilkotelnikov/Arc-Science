use crate::{Result, acquire, config::Config};
use process_wrap::std::ChildWrapper;
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

const BRIDGE_KEYS: [&str; 7] = [
    "ARC_BIOART_CACHE_DIR",
    "ARC_BIOART_MAX_METADATA_BYTES",
    "ARC_BIOART_MAX_FILE_BYTES",
    "ARC_BIOART_MAX_CACHE_BYTES",
    "ARC_BIOART_METADATA_TTL_SECONDS",
    "ARC_BIOART_TIMEOUT_SECONDS",
    "ARC_BIOART_MAX_RETRIES",
];
const POLL: Duration = Duration::from_millis(20);
const CANCEL_GRACE: Duration = Duration::from_secs(2);

fn validate_environment() -> Result<()> {
    for (key, _) in env::vars_os() {
        let key = key.to_string_lossy();
        if key.starts_with("ARC_BIOART_") && !BRIDGE_KEYS.contains(&key.as_ref()) {
            return Err("Unknown ARC_BIOART_ environment setting; remove it before launch".into());
        }
    }
    Ok(())
}

/// Availability means an executable file is present, not that a runtime was qualified.
pub fn executable(name: &str, project: &Path) -> Option<PathBuf> {
    let path = Path::new(name);
    let candidates: Vec<PathBuf> = if path.is_absolute() || path.components().count() > 1 {
        vec![if path.is_absolute() {
            path.to_path_buf()
        } else {
            project.join(path)
        }]
    } else {
        env::var_os("PATH")
            .map(|paths| {
                env::split_paths(&paths)
                    .map(|directory| {
                        if directory.is_absolute() {
                            directory.join(name)
                        } else {
                            project.join(directory).join(name)
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    for candidate in candidates {
        #[cfg(windows)]
        let variants = if candidate.extension().is_none() {
            vec![
                candidate.with_extension("exe"),
                candidate.with_extension("com"),
            ]
        } else {
            vec![candidate]
        };
        #[cfg(not(windows))]
        let variants = vec![candidate];
        for candidate in variants {
            #[cfg(windows)]
            if !candidate
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("com"))
            {
                continue;
            }
            if let Ok(metadata) = fs::metadata(&candidate) {
                if !metadata.is_file() {
                    continue;
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if metadata.permissions().mode() & 0o111 == 0 {
                        continue;
                    }
                }
                // Preserve venv symlink identity; canonicalizing python can select the wrong environment.
                return Some(candidate);
            }
        }
    }
    None
}

pub fn doctor(config: &Config, project: &Path) -> Result<i32> {
    validate_environment()?;
    let python = executable(&config.worker.python, project);
    println!("Project: {}", project.display());
    println!("Python configured: {}", config.worker.python);
    println!(
        "Python executable: {}",
        if python.is_some() {
            "available"
        } else {
            "missing"
        }
    );
    if let Some(path) = &python {
        println!("Python resolved: {}", path.display());
    }
    for (label, program) in [("Blender", "blender"), ("Lean", "lean")] {
        println!(
            "{label} executable on PATH: {} (optional; not executed)",
            if executable(program, project).is_some() {
                "available"
            } else {
                "missing"
            }
        );
    }
    println!(
        "Python package/dependency imports: not probed; use worker -- --help after installing Arc Science"
    );
    println!(
        "Scientific validation: not performed; native supervisor availability is not worker qualification"
    );
    println!(
        "BioArt: delegates to the installed Python provider; cache/runtime qualification is separate from CLI availability"
    );
    println!(
        "Owned BioArt transport: spawned Python child; main-thread POSIX parent deadline covers setup/DNS/headers/body/retries; kills and reaps on cancellation"
    );
    println!(
        "Injected trusted HTTPX clients: in-process, available/unblocked POSIX alarm required; no arbitrary native-code deadline guarantee"
    );
    println!("Network: no requests made; local cache reads do not authorize egress");
    println!(
        "Terminal: noninteractive worker, stdin EOF; stdout/stderr inherited; no PTY or shell"
    );
    Ok(if python.is_some() { 0 } else { 1 })
}

struct ChildGuard(Option<Box<dyn ChildWrapper>>);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut() {
            let _ = child.start_kill();
            let _ = child.wait();
        }
    }
}

fn finish_tree(child: &mut dyn ChildWrapper) -> Result<()> {
    if let Err(error) = child.start_kill() {
        // An already-empty Unix group is normal, including short-lived workers.
        #[cfg(unix)]
        if error.raw_os_error() == Some(3) {
            child.wait()?;
            return Ok(());
        }
        return Err(format!("Unable to terminate worker process tree: {error}").into());
    }
    child.wait()?;
    Ok(())
}

fn exit_code(status: ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        128 + status.signal().unwrap_or(1)
    }
    #[cfg(not(unix))]
    {
        1
    }
}

pub fn run(config: &Config, project: &Path, args: &[OsString]) -> Result<i32> {
    serve(config, project, args, false)
}

/// The desktop owns a pipe connected to our stdin. EOF requests the same tree
/// cancellation as Ctrl-C; ordinary CLI commands keep their existing lifetime.
pub fn serve(
    config: &Config,
    project: &Path,
    args: &[OsString],
    parent_stdin: bool,
) -> Result<i32> {
    validate_environment()?;
    // Before any worker exists: a crash or forced kill of this supervisor must still
    // reap the Python worker and its descendants (kill-on-close job on Windows).
    if let Err(error) = crate::containment::contain_process_tree() {
        eprintln!(
            "Warning: worker tree is not crash-contained ({error}); a forced supervisor exit may leave the worker running"
        );
    }
    let python = executable(&config.worker.python, project).ok_or_else(|| format!("Python executable missing or not executable: {}; install/configure the existing Arc Science worker explicitly", config.worker.python))?;
    let cancelled = Arc::new(AtomicUsize::new(0));
    let signal_count = Arc::clone(&cancelled);
    // Install before spawn: cancellation during handle acquisition is deferred to this loop.
    ctrlc::set_handler(move || {
        signal_count.fetch_add(1, Ordering::SeqCst);
    })?;
    if parent_stdin {
        let parent_closed = Arc::clone(&cancelled);
        thread::spawn(move || {
            use std::io::Read;
            let mut stdin = std::io::stdin().lock();
            let mut bytes = [0; 64];
            loop {
                match stdin.read(&mut bytes) {
                    Ok(0) => break,
                    Ok(_) => (),
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            parent_closed.fetch_add(1, Ordering::SeqCst);
        });
    }
    let mut command = Command::new(python);
    command
        .args(["-m", "arc_science"])
        .args(args)
        .current_dir(project)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .env("ARC_DATA_DIR", &config.worker.data)
        .env(BRIDGE_KEYS[0], &config.bioart.cache_dir);
    for (key, value) in BRIDGE_KEYS[1..].iter().zip([
        config.bioart.max_metadata_bytes,
        config.bioart.max_file_bytes,
        config.bioart.max_cache_bytes,
        config.bioart.metadata_ttl_seconds,
        config.bioart.timeout_seconds,
        config.bioart.max_retries,
    ]) {
        command.env(key, value.to_string());
    }
    #[cfg(unix)]
    let wrapper = process_wrap::std::ProcessGroup::leader();
    #[cfg(windows)]
    let wrapper = process_wrap::std::JobObject;
    let mut guard = ChildGuard(Some(
        acquire::spawn(command, wrapper)
            .map_err(|e| format!("Cannot launch Python executable: {e}"))?,
    ));
    let child = guard.0.as_mut().expect("newly spawned child");
    let mut cancellation_started = None;
    let result = loop {
        let signals = cancelled.load(Ordering::SeqCst);
        if signals > 0 && cancellation_started.is_none() {
            cancellation_started = Some(Instant::now());
            eprintln!("Cancellation requested; stopping Python worker and descendants");
            #[cfg(unix)]
            {
                let _ = child.signal(15);
            }
            #[cfg(windows)]
            {
                child.start_kill()?;
            }
        }
        // process-wrap 9.0 JobObject::try_wait consumes completion-port events.
        // Poll only the leader on Windows, leaving the job event for wait();
        // otherwise a short-lived/cancelled worker can block shutdown forever.
        #[cfg(windows)]
        let status = child.inner_mut().try_wait()?;
        #[cfg(not(windows))]
        let status = child.try_wait()?;
        if let Some(status) = status {
            // The leader exiting does not prove its owned transport exited.
            finish_tree(child.as_mut())?;
            break if cancellation_started.is_some() {
                130
            } else {
                exit_code(status)
            };
        }
        if cancellation_started.is_some_and(|started| started.elapsed() >= CANCEL_GRACE)
            || signals > 1
        {
            finish_tree(child.as_mut())?;
            break 130;
        }
        thread::sleep(POLL);
    };
    guard.0.take();
    Ok(result)
}
