use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
};

fn env(values: &[(&str, &str)]) -> BTreeMap<OsString, OsString> {
    values
        .iter()
        .map(|(k, v)| ((*k).into(), (*v).into()))
        .collect()
}

fn peer(response: &str) -> (LocalUrl, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = LocalUrl::parse(&format!(
        "http://{}/nested/route?view=memory",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    let response = response.to_string();
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = [0; 4096];
        let n = stream.read(&mut bytes).unwrap();
        stream.write_all(response.as_bytes()).unwrap();
        String::from_utf8_lossy(&bytes[..n]).into_owned()
    });
    (url, thread)
}

#[test]
fn root_health_and_numeric_loopback_only() {
    let url = LocalUrl::parse("http://127.0.0.1:8081/diagnostics?x=1#panel").unwrap();
    assert_eq!(url.health, "http://127.0.0.1:8081/health");
    assert_eq!(
        LocalUrl::parse("http://[::1]:8081/path").unwrap().health,
        "http://[::1]:8081/health"
    );
    for invalid in [
        "https://127.0.0.1/",
        "http://localhost/",
        "http://example.org/",
        "http://192.168.1.1/",
        "http://127.0.0.1@evil.test/",
        "http://name@127.0.0.1/",
        "file:///test",
        "/local",
        "http://127.0.0.1:0/",
        "http://127.0.0.1:999999/",
        "http://127.0.0.1\\@evil.test/",
        "http://127.0.0.1:\n80/",
    ] {
        assert!(LocalUrl::parse(invalid).is_err(), "must reject {invalid:?}");
    }
}

#[test]
fn navigation_requires_same_origin_but_preserves_object_downloads() {
    let url = LocalUrl::parse("http://127.0.0.1:8080/").unwrap();
    for allowed in [
        "http://127.0.0.1:8080/path?q=1#view",
        "blob:http://127.0.0.1:8080/3abf",
    ] {
        assert!(url.allows(allowed), "must allow {allowed}");
    }
    for denied in [
        "http://127.0.0.1:8081/",
        "https://127.0.0.1:8080/",
        "http://127.0.0.2:8080/",
        "http://localhost:8080/",
        "https://example.org/",
        "javascript:alert(1)",
        "data:text/html,test",
        "file:///file",
        "blob:https://example.org/id",
        "blob:null/id",
        "http://127.0.0.1:8080.evil.test/",
    ] {
        assert!(!url.allows(denied), "must block {denied}");
    }
}

#[test]
fn argument_vector_preserves_spaces_empty_strings_and_quotes() {
    let config = Config::parse(&env(&[
        (
            "ARC_DESKTOP_EXECUTABLE",
            "C:\\Program Files\\Arc Science\\worker.exe",
        ),
        ("ARC_DESKTOP_ARG_COUNT", "3"),
        ("ARC_DESKTOP_ARG_0", "C:\\Users\\A Person\\data"),
        ("ARC_DESKTOP_ARG_1", ""),
        ("ARC_DESKTOP_ARG_2", "literal \"quote\"; $()"),
    ]))
    .unwrap();
    assert_eq!(
        config.executable,
        OsString::from("C:\\Program Files\\Arc Science\\worker.exe")
    );
    assert_eq!(
        config.args,
        ["C:\\Users\\A Person\\data", "", "literal \"quote\"; $()"].map(OsString::from)
    );
    assert_eq!(
        Config::parse(&env(&[("ARC_DESKTOP_SERVE", "arc-science serve")]))
            .unwrap()
            .args,
        vec![OsString::from("serve")]
    );
    for values in [
        vec![(
            "ARC_DESKTOP_SERVE",
            "\"C:\\Program Files\\python.exe\" -m arc_science",
        )],
        vec![("ARC_DESKTOP_EXECUTABLE", "python")],
        vec![("ARC_DESKTOP_TIMEOUT", "0")],
        vec![("ARC_DESKTOP_TIMEOUT", "garbage")],
        vec![
            ("ARC_DESKTOP_EXECUTABLE", "python"),
            ("ARC_DESKTOP_ARG_COUNT", "1"),
        ],
    ] {
        assert!(Config::parse(&env(&values)).is_err());
    }
}

#[test]
fn health_agent_never_uses_proxy_or_redirects() {
    let agent = health_agent();
    assert!(agent.config().proxy().is_none());
    assert_eq!(agent.config().max_redirects(), 0);
}

#[test]
fn readiness_requires_exact_status_and_identity_and_uses_root_path() {
    for (response, ready) in [
        (
            "HTTP/1.1 200 OK\r\nX-Arc-Science-Service: arc-science-v1\r\nContent-Length: 0\r\n\r\n",
            true,
        ),
        ("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", false),
        (
            "HTTP/1.1 200 OK\r\nX-Arc-Science-Service: other\r\nContent-Length: 0\r\n\r\n",
            false,
        ),
        (
            "HTTP/1.1 204 OK\r\nX-Arc-Science-Service: arc-science-v1\r\nContent-Length: 0\r\n\r\n",
            false,
        ),
        (
            "HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/\r\nX-Arc-Science-Service: arc-science-v1\r\nContent-Length: 0\r\n\r\n",
            false,
        ),
    ] {
        let (url, thread) = peer(response);
        assert_eq!(
            is_healthy(&health_agent(), &url, Duration::from_secs(1)).unwrap_or(false),
            ready
        );
        assert!(
            thread
                .join()
                .unwrap()
                .starts_with("GET /health HTTP/1.1\r\n")
        );
    }
}

#[test]
fn healthy_service_is_reused_without_attempting_to_spawn() {
    let (url, thread) = peer(
        "HTTP/1.1 200 OK\r\nX-Arc-Science-Service: arc-science-v1\r\nContent-Length: 0\r\n\r\n",
    );
    let config = Config {
        url,
        executable: "does-not-exist-arc-science".into(),
        args: vec![],
        timeout: Duration::from_secs(1),
    };
    assert!(start_service(&config).unwrap().is_none());
    thread.join().unwrap();
}

#[test]
fn a_foreign_listener_fails_without_spawning() {
    let (url, thread) = peer("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    let config = Config {
        url,
        executable: "does-not-exist-arc-science".into(),
        args: vec![],
        timeout: Duration::from_secs(1),
    };
    assert!(
        start_service(&config)
            .err()
            .unwrap()
            .contains("refusing to use that listener")
    );
    thread.join().unwrap();
}

#[test]
fn health_probe_obeys_remaining_deadline_on_stalled_peer() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = LocalUrl::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let thread = std::thread::spawn(move || {
        let (_stream, _) = listener.accept().unwrap();
        std::thread::sleep(Duration::from_millis(400));
    });
    let start = Instant::now();
    assert!(!is_healthy(&health_agent(), &url, Duration::from_millis(80)).unwrap());
    assert!(start.elapsed() < Duration::from_millis(350));
    thread.join().unwrap();
}

fn closed_port_config() -> Config {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = LocalUrl::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    drop(listener);
    Config {
        url,
        executable: std::env::current_exe().unwrap().into_os_string(),
        args: vec!["--list".into()],
        timeout: Duration::from_secs(1),
    }
}

#[test]
fn startup_reports_spawn_failure() {
    let mut config = closed_port_config();
    config.executable = "arc-nonexistent-executable-928ab".into();
    assert!(
        start_service(&config)
            .err()
            .unwrap()
            .contains("Cannot start service executable")
    );
}

#[test]
fn startup_reports_early_child_exit() {
    let config = closed_port_config();
    assert!(
        start_service(&config)
            .err()
            .unwrap()
            .contains("Service exited before readiness")
    );
}

#[test]
fn startup_timeout_closes_owned_parent_pipe_and_reaps() {
    let mut config = closed_port_config();
    config.args = [
        "--exact",
        "startup::tests::parent_pipe_fixture",
        "--ignored",
    ]
    .map(OsString::from)
    .into();
    config.timeout = Duration::from_millis(300);
    let start = Instant::now();
    assert!(
        start_service(&config)
            .err()
            .unwrap()
            .contains("Service readiness timed out")
    );
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "cooperative child must exit on EOF without kill grace"
    );
}

#[test]
#[ignore = "subprocess fixture: waits for the owning test to close stdin"]
fn parent_pipe_fixture() {
    let mut bytes = vec![];
    std::io::stdin().read_to_end(&mut bytes).unwrap();
}

#[test]
fn shown_stderr_never_carries_a_credential() {
    let text = "Authorization: Bearer sk-ant-abcdef0123456789 token=abc123 API_KEY=xyz9 plain words stay\nsecret: hidden 0123456789abcdef0123456789abcdef0123";
    let shown = redact(text);
    assert!(!shown.contains("sk-ant-abcdef0123456789"));
    assert!(shown.contains("Bearer [redacted]"));
    assert!(shown.contains("token=[redacted]") && shown.contains("API_KEY=[redacted]"));
    assert!(shown.contains("secret: [redacted]"));
    assert!(shown.contains("plain words stay"));
    assert!(!shown.contains("0123456789abcdef0123456789abcdef0123"));
    assert_eq!(
        redact("Service exited before readiness: exit code: 1"),
        "Service exited before readiness: exit code: 1"
    );
}
