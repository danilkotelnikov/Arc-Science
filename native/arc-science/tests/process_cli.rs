use serde_json::Value;
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
use tempfile::TempDir;

fn native(project: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_arc-science-native"));
    command.arg("--project").arg(project);
    command
}
fn python() -> String {
    std::env::var("ARC_NATIVE_TEST_PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into())
}
fn fixture() -> TempDir {
    let temp = tempfile::Builder::new()
        .prefix("Arc worker space 日本 ")
        .tempdir()
        .unwrap();
    assert!(
        native(temp.path())
            .args(["init", "--python", &python()])
            .output()
            .unwrap()
            .status
            .success()
    );
    fs::create_dir(temp.path().join("arc_science")).unwrap();
    fs::write(temp.path().join("arc_science/__init__.py"), "").unwrap();
    fs::write(
        temp.path().join("arc_science/__main__.py"),
        include_str!("fixtures/worker.py"),
    )
    .unwrap();
    let path = temp.path().join("arc-science.toml");
    let mut config: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["worker"]["data"] = "data space 日本".into();
    config["bioart"]["timeout_seconds"] = 11.into();
    config["bioart"]["max_retries"] = 0.into();
    fs::write(path, toml::to_string_pretty(&config).unwrap()).unwrap();
    temp
}
fn worker(temp: &TempDir) -> Command {
    let mut command = native(temp.path());
    command.env("PYTHONPATH", temp.path());
    command.env("ARC_NATIVE_RECORD", temp.path().join("record.json"));
    command
}
fn record(temp: &TempDir) -> Value {
    serde_json::from_slice(&fs::read(temp.path().join("record.json")).unwrap()).unwrap()
}
fn success(output: Output) -> Output {
    assert!(output.status.success(), "{output:?}");
    output
}

#[test]
fn help_needs_no_project_or_python() {
    let temp = tempfile::tempdir().unwrap();
    let output = success(
        native(&temp.path().join("missing"))
            .arg("--help")
            .output()
            .unwrap(),
    );
    let help = String::from_utf8(output.stdout).unwrap();
    for command in ["init", "config", "doctor", "serve", "worker", "bioart"] {
        assert!(help.contains(command));
    }
}

#[test]
fn bioart_help_needs_no_project_or_python() {
    let missing = tempfile::tempdir().unwrap().path().join("missing");
    for args in [
        vec!["bioart", "--help"],
        vec!["bioart", "search", "--help"],
        vec!["bioart", "inspect", "--help"],
        vec!["bioart", "fetch", "--help"],
        vec!["bioart", "verify", "--help"],
        vec!["bioart", "import", "--help"],
    ] {
        success(native(&missing).args(args).output().unwrap());
    }
}

#[cfg(not(windows))]
#[test]
fn bioart_search_preserves_offline_snapshot_and_egress_is_opt_in() {
    let temp = fixture();
    let snapshot = "snap shots 日本/$(touch NEVER).html";
    success(
        worker(&temp)
            .args([
                "bioart",
                "search",
                "antibody $(touch SHELL_MARKER); & 日本",
                "--search-html",
                snapshot,
            ])
            .output()
            .unwrap(),
    );
    assert_eq!(
        record(&temp)["args"],
        serde_json::json!([
            "bioart",
            "search",
            "--project",
            temp.path().canonicalize().unwrap(),
            "--search-html=snap shots 日本/$(touch NEVER).html",
            "--",
            "antibody $(touch SHELL_MARKER); & 日本"
        ])
    );
    assert!(!temp.path().join("SHELL_MARKER").exists());

    success(
        worker(&temp)
            .args(["bioart", "search", "antibody", "--allow-egress"])
            .output()
            .unwrap(),
    );
    assert_eq!(
        record(&temp)["args"],
        serde_json::json!([
            "bioart",
            "search",
            "--project",
            temp.path().canonicalize().unwrap(),
            "--allow-egress",
            "--",
            "antibody"
        ])
    );
}

#[cfg(not(windows))]
#[test]
fn bioart_inspect_and_fetch_forward_typed_ids_and_exact_format_spelling() {
    let temp = fixture();
    success(
        worker(&temp)
            .args(["bioart", "inspect", "18", "--allow-egress"])
            .output()
            .unwrap(),
    );
    assert_eq!(
        record(&temp)["args"],
        serde_json::json!([
            "bioart",
            "inspect",
            "--project",
            temp.path().canonicalize().unwrap(),
            "--allow-egress",
            "--",
            "18"
        ])
    );

    success(
        worker(&temp)
            .args(["bioart", "fetch", "18"])
            .output()
            .unwrap(),
    );
    assert_eq!(
        record(&temp)["args"],
        serde_json::json!([
            "bioart",
            "fetch",
            "--project",
            temp.path().canonicalize().unwrap(),
            "--format",
            "SVG",
            "--",
            "18"
        ])
    );

    for format in ["svg", "png", "ai", "eps", "SVG", "PNG", "AI", "EPS"] {
        success(
            worker(&temp)
                .args([
                    "bioart",
                    "fetch",
                    "18",
                    "--representation",
                    "626859",
                    "--format",
                    format,
                    "--allow-egress",
                ])
                .output()
                .unwrap(),
        );
        assert_eq!(
            record(&temp)["args"],
            serde_json::json!([
                "bioart",
                "fetch",
                "--project",
                temp.path().canonicalize().unwrap(),
                "--allow-egress",
                "--representation",
                "626859",
                "--format",
                format,
                "--",
                "18"
            ])
        );
    }
}

#[cfg(not(windows))]
#[test]
fn bioart_verify_and_import_never_accept_egress_and_forward_project_once() {
    let temp = fixture();
    let receipt = "receipt space 日本/$(touch NEVER).json";
    for command in ["verify", "import"] {
        success(
            worker(&temp)
                .args(["bioart", command, receipt])
                .output()
                .unwrap(),
        );
        let value = record(&temp);
        assert_eq!(
            value["args"],
            serde_json::json!([
                "bioart",
                command,
                "--project",
                temp.path().canonicalize().unwrap(),
                "--",
                receipt
            ])
        );
        let args = value["args"].as_array().unwrap();
        assert_eq!(args.iter().filter(|value| *value == "--project").count(), 1);
        assert!(!args.iter().any(|value| value == "--allow-egress"));
        let rejected = worker(&temp)
            .args(["bioart", command, receipt, "--allow-egress"])
            .output()
            .unwrap();
        assert!(!rejected.status.success());
    }
}

#[test]
fn bioart_rejects_malformed_values_before_worker_launch() {
    let temp = fixture();
    for args in [
        vec!["bioart", "inspect", "0"],
        vec!["bioart", "inspect", "-1"],
        vec!["bioart", "inspect", "9007199254740992"],
        vec!["bioart", "fetch", "18", "--representation", "0"],
        vec!["bioart", "fetch", "18", "--format", "JPG"],
        vec![
            "bioart",
            "search",
            "antibody",
            "--search-html",
            "snapshot.html",
            "--allow-egress",
        ],
    ] {
        let _ = fs::remove_file(temp.path().join("record.json"));
        let output = worker(&temp).args(&args).output().unwrap();
        assert!(!output.status.success(), "accepted {args:?}");
        assert!(!temp.path().join("record.json").exists());
    }
}

#[cfg(not(windows))]
#[test]
fn bioart_preserves_leading_hyphen_positionals_and_option_paths_as_data() {
    let temp = fixture();
    success(
        worker(&temp)
            .args([
                "bioart",
                "search",
                "--search-html=-snapshot 日本.html",
                "--",
                "-query $(touch NEVER)",
            ])
            .output()
            .unwrap(),
    );
    assert_eq!(
        record(&temp)["args"],
        serde_json::json!([
            "bioart",
            "search",
            "--project",
            temp.path().canonicalize().unwrap(),
            "--search-html=-snapshot 日本.html",
            "--",
            "-query $(touch NEVER)"
        ])
    );

    success(
        worker(&temp)
            .args(["bioart", "verify", "--", "-receipt 日本.json"])
            .output()
            .unwrap(),
    );
    assert_eq!(
        record(&temp)["args"],
        serde_json::json!([
            "bioart",
            "verify",
            "--project",
            temp.path().canonicalize().unwrap(),
            "--",
            "-receipt 日本.json"
        ])
    );
}

#[cfg(windows)]
#[test]
fn direct_bioart_is_rejected_before_worker_launch_on_windows() {
    let temp = fixture();
    let output = worker(&temp)
        .args([
            "bioart",
            "search",
            "antibody",
            "--search-html",
            "snapshot.html",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("POSIX cache/import")
    );
    assert!(!temp.path().join("record.json").exists());
}

#[test]
fn worker_preserves_arguments_environment_cwd_and_noninteractive_streams() {
    use std::{
        process::Stdio,
        thread,
        time::{Duration, Instant},
    };
    let temp = fixture();
    let args = [
        "echo",
        "space 日本",
        "$(touch SHELL_MARKER); & echo bad",
        "--project",
        "literal project",
        "--help",
    ];
    let mut child = worker(&temp)
        .args(["worker", "--"])
        .args(args)
        .env("ARC_BIOART_TIMEOUT_SECONDS", "99")
        .env("ARC_NATIVE_CONTAINMENT", "untrusted-parent-value")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // Keep the supervisor's input OPEN: inheriting it would block Python's read.
    let input = child.stdin.take().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let completed = loop {
        if child.try_wait().unwrap().is_some() {
            break true;
        }
        if Instant::now() >= deadline {
            break false;
        }
        thread::sleep(Duration::from_millis(10));
    };
    drop(input); // Also release the fixture on a failing inherited-input mutation.
    let output = success(child.wait_with_output().unwrap());
    assert!(
        completed,
        "worker inherited supervisor stdin instead of receiving EOF"
    );
    let value = record(&temp);
    assert_eq!(value["args"], serde_json::json!(args));
    assert!(value["module"].as_str().unwrap().ends_with("__main__.py"));
    assert_eq!(
        Path::new(value["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        temp.path().canonicalize().unwrap()
    );
    assert_eq!(value["stdin"], "");
    assert_eq!(value["env"]["ARC_BIOART_TIMEOUT_SECONDS"], "11");
    assert_eq!(value["env"]["ARC_BIOART_MAX_RETRIES"], "0");
    assert_eq!(value["env"]["ARC_BIOART_MAX_METADATA_BYTES"], "8388608");
    assert_eq!(value["env"]["ARC_BIOART_MAX_FILE_BYTES"], "33554432");
    assert_eq!(value["env"]["ARC_BIOART_MAX_CACHE_BYTES"], "268435456");
    assert_eq!(value["env"]["ARC_BIOART_METADATA_TTL_SECONDS"], "86400");
    #[cfg(unix)]
    assert_eq!(value["env"]["ARC_NATIVE_CONTAINMENT"], "process-group-v1");
    #[cfg(windows)]
    assert_eq!(value["env"]["ARC_NATIVE_CONTAINMENT"], "job-object-v1");
    assert_eq!(
        Path::new(value["env"]["ARC_BIOART_CACHE_DIR"].as_str().unwrap()),
        temp.path()
            .canonicalize()
            .unwrap()
            .join(".arc-science/bioart")
    );
    assert_eq!(
        Path::new(value["env"]["ARC_DATA_DIR"].as_str().unwrap()),
        temp.path().canonicalize().unwrap().join("data space 日本")
    );
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("fixture stdout")
    );
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("fixture stderr")
    );
    assert!(!temp.path().join("SHELL_MARKER").exists());
}

#[test]
fn serve_passes_configured_values_as_separate_arguments() {
    let temp = fixture();
    success(worker(&temp).arg("serve").output().unwrap());
    assert_eq!(
        record(&temp)["args"],
        serde_json::json!([
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            "8080",
            "--data",
            temp.path().canonicalize().unwrap().join("data space 日本")
        ])
    );
}

#[test]
fn worker_propagates_nonzero_exit_and_rejects_missing_arguments() {
    let temp = fixture();
    assert_eq!(
        worker(&temp)
            .args(["worker", "--", "exit", "23"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(23)
    );
    assert!(
        !worker(&temp)
            .arg("worker")
            .output()
            .unwrap()
            .status
            .success()
    );
}

#[test]
fn invalid_unknown_bridge_setting_rejects_before_spawn() {
    let temp = fixture();
    let output = worker(&temp)
        .args(["worker", "--", "echo"])
        .env("ARC_BIOART_SECRET", "not-a-real-secret")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("Unknown ARC_BIOART_")
    );
    assert!(!temp.path().join("record.json").exists());
}

#[test]
fn doctor_reports_local_availability_without_executing_worker_or_validation() {
    let temp = fixture();
    let output = success(worker(&temp).arg("doctor").output().unwrap());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Python executable: available"));
    assert!(text.contains("Scientific validation: not performed"));
    assert!(text.contains("Windows BioArt: unsupported"));
    assert!(text.contains("Blender"));
    assert!(text.contains("Lean"));
    assert!(!temp.path().join("record.json").exists());
}

#[test]
fn missing_python_is_actionable_in_worker_and_doctor() {
    let temp = fixture();
    let path = temp.path().join("arc-science.toml");
    let mut config: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["worker"]["python"] = temp.path().join("missing-python").to_str().unwrap().into();
    fs::write(path, toml::to_string_pretty(&config).unwrap()).unwrap();
    let output = worker(&temp)
        .args(["worker", "--", "echo"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("Python executable")
    );
    let output = worker(&temp).arg("doctor").output().unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("Python executable: missing")
    );
}

#[cfg(unix)]
#[test]
fn relative_python_path_is_resolved_from_project_not_caller() {
    let temp = fixture();
    let executable = Command::new(python())
        .args(["-c", "import sys;print(sys.executable)"])
        .output()
        .unwrap();
    fs::create_dir(temp.path().join("bin space 日本")).unwrap();
    std::os::unix::fs::symlink(
        String::from_utf8(executable.stdout).unwrap().trim(),
        temp.path().join("bin space 日本/python"),
    )
    .unwrap();
    let path = temp.path().join("arc-science.toml");
    let mut config: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["worker"]["python"] = "bin space 日本/python".into();
    fs::write(path, toml::to_string_pretty(&config).unwrap()).unwrap();
    success(
        worker(&temp)
            .args(["worker", "--", "echo"])
            .output()
            .unwrap(),
    );
}

#[cfg(unix)]
#[test]
fn signal_exit_is_reported_as_128_plus_signal() {
    let temp = fixture();
    assert_eq!(
        worker(&temp)
            .args(["worker", "--", "signal"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(143)
    );
}

#[cfg(target_os = "linux")]
mod cancellation {
    use super::*;
    use std::{
        io::{self, Read},
        os::unix::fs::OpenOptionsExt,
        process::{Child, Stdio},
        thread,
        time::{Duration, Instant},
    };

    struct Cleanup {
        child: Child,
        descendants: Vec<u32>,
        spawned: std::path::PathBuf,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            // Give the real supervisor its normal group-cleanup path even if
            // setup/readiness failed before the test learned the worker PIDs.
            if self.child.try_wait().ok().flatten().is_none() {
                let _ = nix::sys::signal::kill(
                    nix::unistd::Pid::from_raw(self.child.id() as i32),
                    nix::sys::signal::Signal::SIGTERM,
                );
                let deadline = Instant::now() + Duration::from_secs(3);
                while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
            if let Ok(bytes) = fs::read(&self.spawned)
                && let Ok(pids) = serde_json::from_slice::<Vec<u32>>(&bytes)
            {
                self.descendants.extend(pids);
            }
            for pid in &self.descendants {
                // Failure cleanup never interprets inaccessible /proc as death.
                let _ = nix::sys::signal::kill(
                    nix::unistd::Pid::from_raw(*pid as i32),
                    nix::sys::signal::Signal::SIGKILL,
                );
            }
        }
    }
    fn exercise(mode: &str, signal: Option<&str>) {
        let temp = fixture();
        let endpoint = temp.path().join("lifetime.fifo");
        assert!(
            Command::new(python())
                .args(["-c", "import os,sys; os.mkfifo(sys.argv[1])"])
                .arg(&endpoint)
                .status()
                .unwrap()
                .success()
        );
        let mut lifetime = fs::OpenOptions::new()
            .read(true)
            .custom_flags(nix::libc::O_NONBLOCK)
            .open(&endpoint)
            .unwrap();
        let child = worker(&temp)
            .args(["worker", "--", mode])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut guard = Cleanup {
            child,
            descendants: Vec::new(),
            spawned: temp.path().join("record.spawned"),
        };
        let start = Instant::now();
        while !temp.path().join("record.json").exists() {
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "fixture did not start"
            );
            thread::sleep(Duration::from_millis(10));
        }
        let value = loop {
            if let Ok(bytes) = fs::read(temp.path().join("record.json"))
                && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
            {
                break value;
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            thread::sleep(Duration::from_millis(10));
        };
        guard.descendants = vec![
            value["pid"].as_u64().unwrap() as u32,
            value["child"].as_u64().unwrap() as u32,
        ];
        // The grandchild opens its own writer after exec; no other process has
        // a copy. Its PID message proves the observer saw a live writer first.
        let mut ready = Vec::new();
        loop {
            let mut byte = [0];
            match lifetime.read(&mut byte) {
                Ok(1) => {
                    ready.push(byte[0]);
                    if byte[0] == b'\n' {
                        break;
                    }
                }
                Ok(_) => panic!("descendant never supplied a live handshake"),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => panic!("lifetime read failed: {error}"),
            }
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "no live handshake"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            String::from_utf8(ready)
                .unwrap()
                .trim()
                .parse::<u32>()
                .unwrap(),
            guard.descendants[1]
        );
        // Leader exit is gated until the live observer has received readiness.
        fs::write(temp.path().join("release"), "ready observed").unwrap();
        if let Some(signal) = signal {
            assert!(
                Command::new("kill")
                    .args([signal, &guard.child.id().to_string()])
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let status = loop {
            if let Some(status) = guard.child.try_wait().unwrap() {
                break status;
            }
            assert!(
                start.elapsed() < Duration::from_secs(6),
                "supervisor did not stop"
            );
            thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(status.code(), Some(if signal.is_some() { 130 } else { 7 }));
        let eof_deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match lifetime.read(&mut [0]) {
                Ok(0) => break,
                Ok(_) => panic!("unexpected data after live handshake"),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => panic!("lifetime read failed: {error}"),
            }
            assert!(
                Instant::now() < eof_deadline,
                "live descendant retained its writer"
            );
            thread::sleep(Duration::from_millis(10));
        }
        if mode == "tree" {
            assert_eq!(
                fs::read_to_string(temp.path().join("record.cleaned")).unwrap(),
                "reaped"
            );
        }
    }
    #[test]
    fn ctrl_c_allows_python_to_reap_its_transport() {
        exercise("tree", Some("-INT"));
    }
    #[test]
    fn sigterm_force_kills_unresponsive_process_tree() {
        exercise("stubborn-tree", Some("-TERM"));
    }
    #[test]
    fn leader_exit_does_not_abandon_descendant() {
        exercise("exit-tree", None);
    }
}
