use arc_science_native::config;
use std::{
    fs,
    process::{Command, Output},
};
use tempfile::TempDir;

fn run(project: &std::path::Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_arc-science-native"))
        .arg("--project")
        .arg(project)
        .args(args)
        .output()
        .unwrap()
}
fn init() -> TempDir {
    let temp = tempfile::Builder::new()
        .prefix("Arc space 日本 ")
        .tempdir()
        .unwrap();
    let output = run(temp.path(), &["init"]);
    assert!(output.status.success(), "{:?}", output);
    temp
}

#[test]
fn init_persists_one_explicit_unicode_executable_without_running_it() {
    let temp = tempfile::tempdir().unwrap();
    let selected = "venv space 日本/py$(touch NEVER_EXECUTED); &";
    let output = run(temp.path(), &["init", "--python", selected]);
    assert!(output.status.success(), "{output:?}");
    assert!(!temp.path().join("NEVER_EXECUTED").exists());
    let config: toml::Value =
        toml::from_str(&fs::read_to_string(temp.path().join("arc-science.toml")).unwrap()).unwrap();
    assert_eq!(config["worker"]["python"].as_str(), Some(selected));

    let original = fs::read(temp.path().join("arc-science.toml")).unwrap();
    assert!(
        !run(temp.path(), &["init", "--python", "another/python"])
            .status
            .success()
    );
    assert_eq!(
        original,
        fs::read(temp.path().join("arc-science.toml")).unwrap()
    );
}

#[test]
fn init_rejects_invalid_python_before_creating_config() {
    for selected in ["", "   ", "../venv/bin/python"] {
        let temp = tempfile::tempdir().unwrap();
        assert!(
            !run(temp.path(), &["init", "--python", selected])
                .status
                .success(),
            "accepted {selected:?}"
        );
        assert!(!temp.path().join("arc-science.toml").exists());
    }

    let temp = tempfile::tempdir().unwrap();
    assert!(config::initialize(temp.path(), Some("bin\0python")).is_err());
    assert!(!temp.path().join("arc-science.toml").exists());
}

#[test]
fn init_rejects_lexical_directory_python_without_consuming_config() {
    #[cfg(windows)]
    let invalid = ["venv/", "venv/.", "venv\\", "venv\\."];
    #[cfg(not(windows))]
    let invalid = ["venv/", "venv/."];

    for selected in invalid {
        let temp = tempfile::tempdir().unwrap();
        let output = run(temp.path(), &["init", "--python", selected]);
        assert!(!output.status.success(), "accepted {selected:?}");
        assert!(
            String::from_utf8(output.stderr)
                .unwrap()
                .contains("executable"),
            "missing actionable error for {selected:?}"
        );
        assert!(!temp.path().join("arc-science.toml").exists());
    }
}

#[test]
fn init_help_names_a_venv_interpreter_path() {
    let temp = tempfile::tempdir().unwrap();
    let output = run(temp.path(), &["init", "--help"]);
    assert!(output.status.success(), "{output:?}");
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("Python executable or venv interpreter path"));
    assert!(!help.contains("Python executable or venv path"));
}

#[test]
fn init_uses_platform_python_default() {
    let temp = init();
    let config: toml::Value =
        toml::from_str(&fs::read_to_string(temp.path().join("arc-science.toml")).unwrap()).unwrap();
    assert_eq!(
        config["worker"]["python"].as_str(),
        Some(if cfg!(windows) { "python" } else { "python3" })
    );
}
fn mutate(temp: &TempDir, from: &str, to: &str) {
    let path = temp.path().join("arc-science.toml");
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "fixture missing {from}");
    fs::write(path, text.replace(from, to)).unwrap();
}

#[test]
fn initialization_is_exclusive_and_defaults_validate() {
    let temp = init();
    let path = temp.path().join("arc-science.toml");
    let original = fs::read(&path).unwrap();
    assert!(run(temp.path(), &["config"]).status.success());
    assert!(!run(temp.path(), &["init"]).status.success());
    assert_eq!(original, fs::read(path).unwrap());
    let config: toml::Value = toml::from_str(std::str::from_utf8(&original).unwrap()).unwrap();
    assert_eq!(config["worker"]["port"].as_integer(), Some(8080));
    assert_eq!(
        config["bioart"]["max_metadata_bytes"].as_integer(),
        Some(8388608)
    );
}

#[test]
fn missing_config_and_project_fail_without_creation() {
    let temp = tempfile::tempdir().unwrap();
    assert!(!run(temp.path(), &["config"]).status.success());
    assert!(!run(&temp.path().join("absent"), &["init"]).status.success());
    assert!(!temp.path().join("arc-science.toml").exists());
}

#[test]
fn rejects_unknown_fields_schema_ports_hosts_and_limits() {
    for (from, to) in [
        ("schema_version = 1", "schema_version = 2"),
        ("schema_version = 1", "schema_version = 1\nsecret = 'no'"),
        ("port = 8080", "port = 0"),
        ("port = 8080", "port = 65536"),
        ("port = 8080", "port = 8080\nsecret = 'no'"),
        ("host = \"127.0.0.1\"", "host = '0.0.0.0'"),
        ("host = \"127.0.0.1\"", "host = 'localhost'"),
        (
            "max_metadata_bytes = 8388608",
            "max_metadata_bytes = 67108865",
        ),
        ("max_file_bytes = 33554432", "max_file_bytes = 134217729"),
        (
            "max_cache_bytes = 268435456",
            "max_cache_bytes = 4294967297",
        ),
        (
            "metadata_ttl_seconds = 86400",
            "metadata_ttl_seconds = 604801",
        ),
        ("timeout_seconds = 30", "timeout_seconds = 121"),
        ("max_retries = 2", "max_retries = 3"),
        ("timeout_seconds = 30", "timeout_seconds = 0"),
        ("timeout_seconds = 30", "timeout_seconds = 1.0"),
        ("timeout_seconds = 30", "timeout_seconds = true"),
        ("max_retries = 2", "max_retries = -1"),
        ("max_retries = 2", "max_retries = 2\nsecret = 'no'"),
        (
            "cache_dir = \".arc-science/bioart\"",
            "cache_dir = '../outside'",
        ),
        ("cache_dir = \".arc-science/bioart\"", "cache_dir = '.'"),
        (
            if cfg!(windows) {
                "python = \"python\""
            } else {
                "python = \"python3\""
            },
            "python = ''",
        ),
    ] {
        let temp = init();
        mutate(&temp, from, to);
        assert!(
            !run(temp.path(), &["config"]).status.success(),
            "accepted {to}"
        );
    }
}

#[test]
fn paths_resolve_to_selected_unicode_project_and_loopback_ipv6_is_allowed() {
    let temp = init();
    mutate(&temp, "host = \"127.0.0.1\"", "host = '::1'");
    mutate(&temp, "max_retries = 2", "max_retries = 0");
    let output = run(temp.path(), &["config"]);
    assert!(output.status.success(), "{:?}", output);
    let config: toml::Value = toml::from_str(std::str::from_utf8(&output.stdout).unwrap()).unwrap();
    assert_eq!(
        std::path::Path::new(config["worker"]["data"].as_str().unwrap()),
        temp.path().canonicalize().unwrap().join("data")
    );
    assert_eq!(
        std::path::Path::new(config["bioart"]["cache_dir"].as_str().unwrap()),
        temp.path()
            .canonicalize()
            .unwrap()
            .join(".arc-science/bioart")
    );
}

#[cfg(unix)]
#[test]
fn cache_symlink_is_not_canonicalized_into_acceptance() {
    let temp = init();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), temp.path().join(".arc-science")).unwrap();
    assert!(!run(temp.path(), &["config"]).status.success());
}
