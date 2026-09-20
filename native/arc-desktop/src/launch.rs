//! Self-configuration for a plain double-click: no launcher script, no environment.
//! The shell finds the native supervisor (an explicit override, a sibling of this
//! executable, the development layout, then PATH), gives it a workspace under the
//! user's local application data, lets it initialise and discover the runtime, and
//! asks it for the startup plan. The desktop never parses the configuration itself.
use crate::startup::{Config, LocalUrl};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

const SUPERVISOR: &str = "arc-science-native";
pub const STEP_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub struct Check {
    pub name: String,
    pub ok: bool,
    pub optional: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub project: PathBuf,
    pub supervisor: PathBuf,
    pub ready: bool,
    pub checks: Vec<Check>,
    pub notes: Vec<String>,
}

fn binary(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Candidate supervisor locations in preference order.
pub fn supervisor_candidates(exe_dir: &Path, override_path: Option<&Path>) -> Vec<PathBuf> {
    let name = binary(SUPERVISOR);
    let mut out = Vec::new();
    if let Some(explicit) = override_path {
        out.push(explicit.to_path_buf());
    }
    out.push(exe_dir.join(&name));
    // <repo>/native/arc-desktop/target/release -> <repo>/native
    if let Some(native) = exe_dir.ancestors().nth(3) {
        out.push(
            native
                .join("arc-science")
                .join("target")
                .join("release")
                .join(&name),
        );
    }
    if let Some(paths) = std::env::var_os("PATH") {
        out.extend(std::env::split_paths(&paths).map(|dir| dir.join(&name)));
    }
    out
}

pub fn find_supervisor() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .ok_or("Cannot locate this executable's directory")?;
    let override_path = std::env::var_os("ARC_DESKTOP_SUPERVISOR").map(PathBuf::from);
    if let Some(explicit) = &override_path
        && !explicit.is_file()
    {
        // An explicit choice is honoured or refused, never silently replaced.
        return Err(format!(
            "ARC_DESKTOP_SUPERVISOR names {}, which is not a file",
            explicit.display()
        ));
    }
    let candidates = supervisor_candidates(&exe_dir, override_path.as_deref());
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| {
            format!(
                "The native supervisor {} was not found beside Arc Science.exe, in the development layout, or on PATH. Build it with `cargo build --release` in native/arc-science or set ARC_DESKTOP_SUPERVISOR.",
                binary(SUPERVISOR)
            )
        })
}

/// The workspace that holds the configuration and data: an explicit override or the
/// user's local application data. It is created when missing and never lives beside
/// the executable.
pub fn workspace() -> Result<PathBuf, String> {
    let project = match std::env::var_os("ARC_DESKTOP_PROJECT") {
        Some(explicit) => PathBuf::from(explicit),
        None => {
            let base = std::env::var_os(if cfg!(windows) {
                "LOCALAPPDATA"
            } else {
                "HOME"
            })
            .ok_or(
                "Neither ARC_DESKTOP_PROJECT nor the local application data directory is available",
            )?;
            PathBuf::from(base)
                .join(if cfg!(windows) {
                    "ArcScience"
                } else {
                    ".arc-science"
                })
                .join("workspace")
        }
    };
    std::fs::create_dir_all(&project)
        .map_err(|e| format!("Cannot create the workspace {}: {e}", project.display()))?;
    Ok(project)
}

fn run_supervisor(supervisor: &Path, args: &[OsString]) -> Result<(String, String), String> {
    let mut command = Command::new(supervisor);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Cannot run the supervisor {}: {e}", supervisor.display()))?;
    let started = std::time::Instant::now();
    let mut child = child;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out = std::thread::spawn(move || read_all(stdout));
    let err = std::thread::spawn(move || read_all(stderr));
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let (out, err) = (
                    out.join().unwrap_or_default(),
                    err.join().unwrap_or_default(),
                );
                if status.success() {
                    return Ok((out, err));
                }
                return Err(format!(
                    "{} {} failed ({status}): {}",
                    supervisor
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(SUPERVISOR),
                    args.iter()
                        .map(|a| a.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" "),
                    err.trim().lines().last().unwrap_or("no detail").trim()
                ));
            }
            Ok(None) if started.elapsed() > STEP_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The supervisor did not answer within 60 seconds".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => return Err(format!("Cannot wait for the supervisor: {e}")),
        }
    }
}

fn read_all(stream: Option<impl std::io::Read>) -> String {
    let mut text = String::new();
    if let Some(mut stream) = stream {
        let _ = stream.read_to_string(&mut text);
    }
    text
}

/// Build the launch configuration: initialise the workspace on first use, then read
/// the supervisor's startup plan.
pub fn self_configure(timeout: Duration) -> Result<(Config, Plan), String> {
    let supervisor = find_supervisor()?;
    let project = workspace()?;
    let mut notes = Vec::new();
    let project_arg: OsString = project.clone().into();
    if !project.join("arc-science.toml").is_file() {
        let (_, err) = run_supervisor(
            &supervisor,
            &[
                "--project".into(),
                project_arg.clone(),
                "init".into(),
                "--auto".into(),
            ],
        )?;
        notes.extend(
            err.lines()
                .map(|l| l.trim_start_matches("discovery: ").to_string())
                .filter(|l| !l.is_empty()),
        );
    }
    let read_plan = |project_arg: OsString| -> Result<serde_json::Value, String> {
        let (out, _) = run_supervisor(
            &supervisor,
            &["--project".into(), project_arg, "startup-plan".into()],
        )?;
        serde_json::from_str(&out)
            .map_err(|e| format!("The startup plan is not readable JSON: {e}"))
    };
    let mut value = read_plan(project_arg.clone())?;
    if value["ready"].as_bool() != Some(true) {
        // A configuration written before discovery existed can still be completed:
        // only empty fields are filled, and the plan is read again.
        if let Ok((applied, _)) = run_supervisor(
            &supervisor,
            &[
                "--project".into(),
                project_arg.clone(),
                "discover".into(),
                "--apply".into(),
            ],
        ) && let Ok(report) = serde_json::from_str::<serde_json::Value>(&applied)
            && report["applied"].as_array().is_some_and(|a| !a.is_empty())
        {
            notes.push(format!(
                "filled {} from discovery",
                report["applied"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
            value = read_plan(project_arg)?;
        }
    }
    let url = LocalUrl::parse(value["url"].as_str().ok_or("The startup plan has no URL")?)?;
    let args = value["serve"]
        .as_array()
        .ok_or("The startup plan has no serve arguments")?
        .iter()
        .map(|a| {
            a.as_str()
                .map(OsString::from)
                .ok_or("Serve arguments must be strings")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let checks = value["checks"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|c| Check {
                    name: c["name"].as_str().unwrap_or("").to_string(),
                    ok: c["ok"].as_bool().unwrap_or(false),
                    optional: c["optional"].as_bool().unwrap_or(false),
                    detail: c["detail"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let plan = Plan {
        project,
        supervisor: supervisor.clone(),
        ready: value["ready"].as_bool().unwrap_or(false),
        checks,
        notes,
    };
    Ok((
        Config {
            url,
            executable: supervisor.into_os_string(),
            args,
            timeout,
        },
        plan,
    ))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

const STYLE: &str = "<style>body{margin:0;font:15px/1.5 system-ui,Segoe UI,sans-serif;color:#17212d;background:#fff}main{max-width:720px;margin:12vh auto;padding:0 24px}h1{font-size:22px;margin:0 0 8px}p{margin:8px 0}ul{padding-left:18px}li{margin:4px 0}.muted{color:#5b6875}.bad{color:#bb3e03}code{font-size:13px}.startup-status{margin:18px 0}.progress-track{position:relative;height:7px;overflow:hidden;border-radius:999px;background:#e7edf2}.progress-track::before{content:\"\";position:absolute;inset:0 auto 0 0;width:38%;border-radius:inherit;background:#315d7c;animation:arc-indeterminate 1.35s ease-in-out infinite}.failure-card{padding:14px 0;border-top:1px solid #e7edf2;border-bottom:1px solid #e7edf2}.recovery-actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.button-link{display:inline-flex;align-items:center;min-height:30px;padding:0 12px;border-radius:5px;background:#315d7c;color:#fff;text-decoration:none;font-size:13px}.button-link.secondary{background:#eef3f6;color:#243542;border:1px solid #d8e1e7}@keyframes arc-indeterminate{0%{transform:translateX(-105%)}100%{transform:translateX(265%)}}@media (prefers-reduced-motion:reduce){.progress-track::before{animation:none;transform:translateX(80%)}}</style>";

#[derive(Debug, Clone, Default)]
pub struct StartupProgress {
    pub operation: String,
    pub elapsed: Option<Duration>,
    pub timeout: Option<Duration>,
    pub timeout_note: Option<String>,
}

fn format_seconds(duration: Duration) -> String {
    let seconds = duration.as_secs();
    if seconds == 1 {
        "1 second".into()
    } else {
        format!("{seconds} seconds")
    }
}

fn progress_html(progress: &StartupProgress) -> String {
    let operation = if progress.operation.trim().is_empty() {
        "Starting the local service"
    } else {
        progress.operation.trim()
    };
    let mut body = format!(
        "<section class=\"startup-status\" aria-label=\"Startup status\"><p>{}</p><div class=\"progress-track\" role=\"progressbar\" aria-label=\"Startup progress\" aria-valuetext=\"{}\"></div>",
        escape(operation),
        escape(operation)
    );
    if progress.elapsed.is_some() || progress.timeout.is_some() {
        body.push_str("<p class=\"muted\">");
        match (
            progress.elapsed,
            progress.timeout,
            progress.timeout_note.as_deref(),
        ) {
            (Some(elapsed), Some(timeout), Some(note)) => body.push_str(&format!(
                "Elapsed {}. {} {}.",
                format_seconds(elapsed),
                format_seconds(timeout),
                escape(note)
            )),
            (Some(elapsed), Some(timeout), None) => body.push_str(&format!(
                "Elapsed {} of {} timeout.",
                format_seconds(elapsed),
                format_seconds(timeout)
            )),
            (Some(elapsed), None, Some(note)) => {
                body.push_str(&format!(
                    "Elapsed {}. {}.",
                    format_seconds(elapsed),
                    escape(note)
                ));
            }
            (Some(elapsed), None, None) => {
                body.push_str(&format!("Elapsed {}.", format_seconds(elapsed)));
            }
            (None, Some(timeout), Some(note)) => {
                body.push_str(&format!("{} {}.", format_seconds(timeout), escape(note)));
            }
            (None, Some(timeout), None) => {
                body.push_str(&format!("Timeout {}.", format_seconds(timeout)));
            }
            (None, None, Some(note)) => body.push_str(&escape(note)),
            (None, None, None) => {}
        }
        body.push_str("</p>");
    }
    body.push_str("</section>");
    body
}

/// The page shown while the local service starts, with optional observed progress.
pub fn starting_page_with_progress(plan: Option<&Plan>, progress: &StartupProgress) -> String {
    let mut body = String::from("<h1>Arc Science</h1>");
    body.push_str(&progress_html(progress));
    if let Some(plan) = plan
        && !plan.ready
    {
        body.push_str("<p class=\"bad\">A readiness check failed; starting anyway so the reason is visible.</p>");
    }
    if let Some(plan) = plan {
        body.push_str("<ul>");
        for check in &plan.checks {
            body.push_str(&format!(
                "<li class=\"{}\">{}: {}</li>",
                if !check.ok {
                    "bad"
                } else if check.optional {
                    "muted"
                } else {
                    ""
                },
                escape(&check.name),
                escape(&check.detail)
            ));
        }
        body.push_str("</ul>");
        body.push_str(&format!(
            "<p class=\"muted\">Workspace <code>{}</code></p>",
            escape(&plan.project.display().to_string())
        ));
    }
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Arc Science</title>{STYLE}</head><body><main>{body}</main></body></html>"
    )
}

/// The page shown when the service could not start; the reason is the whole message.
pub fn failure_page(reason: &str, plan: Option<&Plan>, log_path: Option<&Path>) -> String {
    let mut body = format!(
        "<h1>Arc Science could not start</h1><section class=\"failure-card\" role=\"alert\"><p class=\"bad\">{}</p></section>",
        escape(reason)
    );
    body.push_str("<p class=\"recovery-actions\"><a class=\"button-link\" href=\"arc-science://startup/retry\">Retry</a>");
    if log_path.is_some() {
        body.push_str("<a class=\"button-link secondary\" href=\"arc-science://startup/open-log\">Open redacted startup log</a>");
    }
    body.push_str("</p>");
    if let Some(plan) = plan {
        body.push_str(&format!(
            "<p class=\"muted\">Configuration: <code>{}</code>. Edit it or delete it to discover the runtime again. Supervisor: <code>{}</code>.</p>",
            escape(&plan.project.join("arc-science.toml").display().to_string()),
            escape(&plan.supervisor.display().to_string())
        ));
        if !plan.notes.is_empty() {
            body.push_str("<ul>");
            for note in &plan.notes {
                body.push_str(&format!("<li class=\"muted\">{}</li>", escape(note)));
            }
            body.push_str("</ul>");
        }
    }
    if let Some(log_path) = log_path {
        body.push_str(&format!(
            "<p class=\"muted\">Startup log: <code>{}</code></p>",
            escape(&log_path.display().to_string())
        ));
    }
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Arc Science</title>{STYLE}</head><body><main>{body}</main></body></html>"
    )
}

/// The native handle of the shell window (0 when there is none), for owned dialogs.
#[cfg(windows)]
pub fn window_handle(window: &tao::window::Window) -> isize {
    use tao::platform::windows::WindowExtWindows;
    window.hwnd()
}

#[cfg(not(windows))]
pub fn window_handle(_window: &tao::window::Window) -> isize {
    0
}

/// A native dialog with the reason, so a double-click failure is never silent.
#[cfg(windows)]
pub fn message_box(owner: isize, reason: &str) {
    use std::ffi::{OsStr, c_void};
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(hwnd: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }
    const MB_OK: u32 = 0x0000_0000;
    const MB_ICONERROR: u32 = 0x0000_0010;
    let wide = |s: &str| -> Vec<u16> { OsStr::new(s).encode_wide().chain(Some(0)).collect() };
    let (text, caption) = (wide(reason), wide("Arc Science could not start"));
    // SAFETY: both buffers are NUL-terminated UTF-16 and outlive the call; the owner
    // is either a live window handle of this process or null.
    unsafe {
        MessageBoxW(
            owner as *mut c_void,
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
pub fn message_box(_owner: isize, reason: &str) {
    eprintln!("arc-science-desktop: {reason}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervisor_candidates_prefer_override_sibling_then_development_layout() {
        let exe_dir = Path::new("/repo/native/arc-desktop/target/release");
        let candidates = supervisor_candidates(exe_dir, Some(Path::new("/opt/custom/native")));
        let name = binary(SUPERVISOR);
        assert_eq!(candidates[0], Path::new("/opt/custom/native"));
        assert_eq!(candidates[1], exe_dir.join(&name));
        assert_eq!(
            candidates[2],
            Path::new("/repo/native")
                .join("arc-science")
                .join("target")
                .join("release")
                .join(&name)
        );
    }

    #[test]
    fn pages_escape_untrusted_text() {
        let plan = Plan {
            project: PathBuf::from("C:/ws"),
            supervisor: PathBuf::from("sup"),
            ready: false,
            checks: vec![Check {
                name: "python".into(),
                ok: false,
                optional: false,
                detail: "<missing>".into(),
            }],
            notes: vec!["a & b".into()],
        };
        let starting = starting_page_with_progress(Some(&plan), &StartupProgress::default());
        assert!(starting.contains("python: &lt;missing&gt;") && starting.contains("class=\"bad\""));
        let log_path = Path::new("C:/ArcScience/startup.log");
        let failure = failure_page("<script>x</script>", Some(&plan), Some(log_path));
        assert!(
            failure.contains("&lt;script&gt;x&lt;/script&gt;") && failure.contains("a &amp; b")
        );
        assert!(!failure.contains("<script>"));
        assert!(failure.contains("arc-science://startup/retry"));
        assert!(failure.contains("arc-science://startup/open-log"));
        assert!(failure.contains("startup.log"));
    }

    #[test]
    fn starting_page_has_honest_indeterminate_progress() {
        let page = starting_page_with_progress(None, &StartupProgress::default());
        assert!(page.contains("role=\"progressbar\""));
        assert!(page.contains("Starting the local service"));
        assert!(page.contains("arc-indeterminate"));
        assert!(!page.contains("aria-valuenow"));
        assert!(!page.contains(">100%"));
        assert!(!page.contains("100 percent"));
        assert!(!page.contains("ready"));
    }

    #[test]
    fn starting_page_reports_operation_elapsed_and_timeout_when_supplied() {
        let page = starting_page_with_progress(
            None,
            &StartupProgress {
                operation: "Discovering runtime <paths>".into(),
                elapsed: Some(Duration::from_secs(2)),
                timeout: Some(Duration::from_secs(60)),
                timeout_note: Some("per-step configuration timeout".into()),
            },
        );
        assert!(page.contains("Discovering runtime &lt;paths&gt;"));
        assert!(page.contains("Elapsed 2 seconds. 60 seconds per-step configuration timeout."));
        assert!(page.contains("aria-valuetext=\"Discovering runtime &lt;paths&gt;\""));
        assert!(!page.contains(">2%"));
        assert!(!page.contains(">100%"));
    }

    #[test]
    fn failure_page_keeps_alert_visible_without_startup_progress() {
        let page = failure_page("Supervisor timed out <after launch>", None, None);
        assert!(page.contains("role=\"alert\""));
        assert!(page.contains("Supervisor timed out &lt;after launch&gt;"));
        assert!(page.contains("arc-science://startup/retry"));
        assert!(!page.contains("arc-science://startup/open-log"));
        assert!(!page.contains("role=\"progressbar\""));
    }
}
