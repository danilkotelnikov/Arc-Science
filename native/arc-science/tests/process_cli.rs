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
            .arg("init")
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
    config["worker"]["python"] = python().into();
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
    for command in ["init", "config", "doctor", "serve", "worker"] {
        assert!(help.contains(command));
    }
}

#[test]
fn worker_preserves_arguments_environment_cwd_and_noninteractive_streams() {
    let temp = fixture();
    let args = [
        "echo",
        "space 日本",
        "$(touch SHELL_MARKER); & echo bad",
        "--project",
        "literal project",
        "--help",
    ];
    let output = success(
        worker(&temp)
            .args(["worker", "--"])
            .args(args)
            .env("ARC_BIOART_TIMEOUT_SECONDS", "99")
            .output()
            .unwrap(),
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
        process::{Child, Stdio},
        thread,
        time::{Duration, Instant},
    };

    fn running(pid: u32) -> bool {
        fs::read_to_string(format!("/proc/{pid}/stat"))
            .ok()
            .is_some_and(|s| {
                s.rsplit_once(") ")
                    .is_some_and(|(_, tail)| !tail.starts_with('Z'))
            })
    }
    struct Cleanup {
        child: Child,
        descendants: Vec<u32>,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            for pid in &self.descendants {
                if running(*pid) {
                    let _ = Command::new("kill")
                        .args(["-KILL", &pid.to_string()])
                        .status();
                }
            }
        }
    }
    fn exercise(mode: &str, signal: Option<&str>) {
        let temp = fixture();
        let child = worker(&temp)
            .args(["worker", "--", mode])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut guard = Cleanup {
            child,
            descendants: Vec::new(),
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
            if let Ok(bytes) = fs::read(temp.path().join("record.json")) {
                if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                    break value;
                }
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            thread::sleep(Duration::from_millis(10));
        };
        guard.descendants = vec![
            value["pid"].as_u64().unwrap() as u32,
            value["child"].as_u64().unwrap() as u32,
        ];
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
        for pid in &guard.descendants {
            while running(*pid) && start.elapsed() < Duration::from_secs(6) {
                thread::sleep(Duration::from_millis(10));
            }
            assert!(!running(*pid), "orphan process {pid}");
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
