//! Native Rust host for the local Arc Science workbench. See README for lifecycle limits.
// A windowed application: a double-click opens no console. When started from a
// console (the launcher, `--check-startup`), that console is attached for output.
#![cfg_attr(windows, windows_subsystem = "windows")]
mod credential;
mod external;
mod launch;
mod startup;
use startup::{Config, LocalUrl, ServiceGuard, start_service, start_service_with_native_session};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use std::{
    fs::{OpenOptions, create_dir_all},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, WindowBuilder};
use wry::WebViewBuilder;

const SNOGGO: &[u8] = include_bytes!("../assets/snoggo-icon.svg");

/// Shell events delivered to the event loop from WebView callbacks and the
/// service-start thread.
enum Shell {
    /// The startup page gets a truthful elapsed-time refresh while the service starts.
    StartupTick(launch::StartupProgress),
    /// Configuration is known; the starting page can show its checks.
    Planned {
        plan: Option<launch::Plan>,
        progress: launch::StartupProgress,
    },
    /// The local service answered its health check; the workbench can load.
    Ready {
        url: String,
        guard: Option<ServiceGuard>,
        native_session: Option<NativeSession>,
    },
    /// The local service could not start; the reason is shown, never swallowed.
    Failed(String, Option<launch::Plan>),
    /// Failure-page retry: spawn this executable once as a fresh process, then exit.
    RetryStartup,
    /// Failure-page recovery: open the app-owned redacted startup log.
    OpenStartupLog,
    /// A download finished; the page is told so it can show the outcome, because
    /// the WebView hosts no download UI of its own here.
    DownloadFinished {
        file: Option<String>,
        folder: Option<String>,
        success: bool,
    },
    /// The page asked the host to store or remove a credential by name (IPC from the
    /// service origin); a malformed message carries its reason and is reported back.
    Credential(Result<credential::Request, String>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RecoveryAction {
    Retry,
    OpenLog,
}

/// Development-only diagnostic attach. With `ARC_DESKTOP_DIAGNOSTIC_ATTACH=1` the
/// WebView opens the Chromium DevTools protocol on an ephemeral loopback port so a
/// Playwright client can drive this very window (`connectOverCDP`). The port and
/// this process id are written to `<app data>/diagnostic-attach.json` and to the
/// window title, so the mode is never silent. It exposes the WebView, its network
/// traffic and therefore the native session header to any local process that can
/// reach the port: an operator enables it for one development run and nothing else.
struct DiagnosticAttach {
    port: u16,
    record: PathBuf,
    published: bool,
}

/// Only the literal `1` enables the attach; any other value is a configuration error
/// rather than a silent no.
fn diagnostic_attach_requested(value: Option<&std::ffi::OsStr>) -> Result<bool, String> {
    match value {
        None => Ok(false),
        Some(value) if value == "1" => Ok(true),
        Some(_) => Err("ARC_DESKTOP_DIAGNOSTIC_ATTACH accepts only the value 1 (development-only WebView attach)".into()),
    }
}

/// The DevTools switch WebView2 receives, with the defaults Wry would otherwise pass
/// on its own (they are replaced, not extended, by additional arguments): the feature
/// switches and the autoplay policy Wry sets when autoplay is left enabled.
fn diagnostic_browser_args(port: u16) -> String {
    format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --remote-debugging-port={port}"
    )
}

/// Whether the DevTools endpoint itself answers on the loopback port (its
/// `/json/version` names a browser WebSocket), polled for a bounded time. A bare
/// listener that won the released port is not enough.
fn devtools_answering(port: u16, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    let agent = startup::health_agent();
    loop {
        if let Ok(mut response) = agent
            .get(&format!("http://127.0.0.1:{port}/json/version"))
            .call()
            && response.status() == 200
            && let Ok(body) = response.body_mut().read_to_string()
            && body.contains("webSocketDebuggerUrl")
        {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Whether a process with this id is still running (Windows: the process can be
/// opened and has not exited).
#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn GetExitCodeProcess(handle: *mut std::ffi::c_void, code: *mut u32) -> i32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;
    // SAFETY: plain kernel32 calls with a handle we open and close ourselves.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code = 0u32;
        let alive = GetExitCodeProcess(handle, &mut code) != 0 && code == STILL_ACTIVE;
        CloseHandle(handle);
        alive
    }
}

#[cfg(not(windows))]
fn process_alive(_pid: u32) -> bool {
    false
}

/// The process id named by an existing attach record, when the record is readable.
fn recorded_pid(record: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(record).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .get("pid")?
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
}

impl DiagnosticAttach {
    fn enable() -> Result<Option<Self>, String> {
        if !diagnostic_attach_requested(
            std::env::var_os("ARC_DESKTOP_DIAGNOSTIC_ATTACH").as_deref(),
        )? {
            return Ok(None);
        }
        // An ephemeral port from the OS; the listener is released at once and the
        // WebView2 browser process binds the same number (loopback only) moments later.
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("Cannot choose a diagnostic attach port: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Cannot read the diagnostic attach port: {error}"))?
            .port();
        drop(listener);
        let record = app_data_directory()?.join("diagnostic-attach.json");
        // One attached window at a time: the diagnostic profile is shared, and WebView2
        // would otherwise fold a second attached window into the first browser process.
        if let Some(pid) = recorded_pid(&record)
            && pid != std::process::id()
            && process_alive(pid)
        {
            return Err(format!(
                "Another Arc Science window (pid {pid}) already has the diagnostic attach open; close it first"
            ));
        }
        let _ = std::fs::remove_file(&record);
        Ok(Some(Self {
            port,
            record,
            published: false,
        }))
    }

    /// A profile of its own, so the attached browser process is never shared with an
    /// ordinary window (WebView2 shares one browser per user data folder). A profile
    /// that cannot be created fails the attach rather than falling back to the default.
    fn profile_directory(&self) -> Result<PathBuf, String> {
        let directory = app_data_directory()?.join("webview-diagnostic");
        std::fs::create_dir_all(&directory).map_err(|error| {
            format!(
                "Cannot create the diagnostic WebView profile {}: {error}",
                directory.display()
            )
        })?;
        Ok(directory)
    }

    /// Write the record only once the DevTools endpoint answers; a client that reads
    /// the record then still checks the listener's owner chain against `pid`.
    fn publish(&mut self) -> Result<(), String> {
        if !devtools_answering(self.port, Duration::from_secs(10)) {
            return Err(format!(
                "The diagnostic attach endpoint 127.0.0.1:{} did not answer /json/version",
                self.port
            ));
        }
        let body = serde_json::json!({
            "port": self.port,
            "pid": std::process::id(),
            "endpoint": format!("http://127.0.0.1:{}", self.port),
            "warning": "development-only; exposes the WebView and its requests to local processes",
        });
        std::fs::write(&self.record, body.to_string())
            .map_err(|error| format!("Cannot write {}: {error}", self.record.display()))?;
        self.published = true;
        Ok(())
    }
}

impl Drop for DiagnosticAttach {
    fn drop(&mut self) {
        if self.published {
            let _ = std::fs::remove_file(&self.record);
        }
    }
}

fn failure_recovery_action(target: &str, enabled: bool) -> Option<RecoveryAction> {
    if !enabled {
        return None;
    }
    match target {
        "arc-science://startup/retry" => Some(RecoveryAction::Retry),
        "arc-science://startup/open-log" => Some(RecoveryAction::OpenLog),
        _ => None,
    }
}

#[derive(Debug)]
struct StartupDisplay {
    operation: String,
    timeout: Option<Duration>,
    timeout_note: Option<String>,
}

fn startup_progress(
    operation: &str,
    started: Instant,
    timeout: Option<Duration>,
    timeout_note: Option<&str>,
    now: Instant,
) -> launch::StartupProgress {
    launch::StartupProgress {
        operation: operation.into(),
        elapsed: Some(now.saturating_duration_since(started)),
        timeout,
        timeout_note: timeout_note.map(str::to_owned),
    }
}

fn spawn_startup_ticker(
    proxy: EventLoopProxy<Shell>,
    running: Arc<AtomicBool>,
    display: Arc<Mutex<StartupDisplay>>,
    started: Instant,
) {
    std::thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
            let (operation, timeout, timeout_note) = display
                .lock()
                .map(|state| {
                    (
                        state.operation.clone(),
                        state.timeout,
                        state.timeout_note.clone(),
                    )
                })
                .unwrap_or_else(|_| ("Starting the local service".into(), None, None));
            if proxy
                .send_event(Shell::StartupTick(startup_progress(
                    &operation,
                    started,
                    timeout,
                    timeout_note.as_deref(),
                    Instant::now(),
                )))
                .is_err()
            {
                break;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

#[derive(Clone, Debug)]
struct NativeSession {
    url: LocalUrl,
    secret: String,
}

#[derive(Clone, Debug)]
struct NativeSessionSecret(String);

impl NativeSessionSecret {
    fn generate() -> Result<Self, String> {
        let mut bytes = [0u8; 32];
        fill_os_random(&mut bytes)?;
        Ok(Self(hex(&bytes)))
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(TABLE[(byte >> 4) as usize] as char);
        out.push(TABLE[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(windows)]
fn fill_os_random(bytes: &mut [u8]) -> Result<(), String> {
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn SystemFunction036(buffer: *mut u8, length: u32) -> u8;
    }
    if bytes.len() > u32::MAX as usize {
        return Err("Native session secret buffer is too large".into());
    }
    // SAFETY: the pointer and length describe the live mutable byte slice, and
    // RtlGenRandom writes exactly that buffer or returns failure.
    let ok = unsafe { SystemFunction036(bytes.as_mut_ptr(), bytes.len() as u32) };
    if ok == 0 {
        return Err("The operating system random generator failed".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn fill_os_random(bytes: &mut [u8]) -> Result<(), String> {
    use std::io::Read;
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(bytes))
        .map_err(|e| format!("The operating system random generator failed: {e}"))
}

#[cfg(windows)]
fn install_native_session_handler(
    webview: &wry::WebView,
    active: Arc<Mutex<Option<NativeSession>>>,
) -> Result<bool, String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler, take_pwstr,
    };
    use windows::core::{HSTRING, PWSTR};
    use wry::WebViewExtWindows;

    let webview = webview.webview();
    let filter = HSTRING::from("*");
    for context in [
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE,
    ] {
        // SAFETY: WebView2 owns the COM object; the filter and context are valid
        // for the duration of each call. The callback below re-checks the exact
        // configured loopback API URL before mutating headers.
        unsafe {
            webview
                .AddWebResourceRequestedFilter(&filter, context)
                .map_err(|e| format!("Cannot register the native-session request filter: {e}"))?;
        }
    }

    let mut token = 0;
    // SAFETY: the callback captures only Send-safe Arc state and returns quickly
    // on WebView2's UI thread. The COM event source retains the handler after
    // registration; the token is only needed for removal, which this host does
    // by tearing down the whole WebView on exit.
    unsafe {
        webview
            .add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let request = args.Request()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    let secret = active.lock().ok().and_then(|slot| {
                        slot.as_ref().and_then(|session| {
                            session
                                .url
                                .is_api_resource(&uri)
                                .then(|| session.secret.clone())
                        })
                    });
                    if let Some(secret) = secret {
                        request.Headers()?.SetHeader(
                            &HSTRING::from("X-Arc-Native-Session"),
                            &HSTRING::from(secret),
                        )?;
                    }
                    Ok(())
                })),
                &mut token,
            )
            .map_err(|e| format!("Cannot register the native-session request handler: {e}"))?;
    }
    Ok(true)
}

#[cfg(not(windows))]
fn install_native_session_handler(
    _webview: &wry::WebView,
    _active: Arc<Mutex<Option<NativeSession>>>,
) -> Result<bool, String> {
    Ok(false)
}

/// A JavaScript string literal (or `null`) for text that came from the file system.
fn js_string(value: Option<&str>) -> String {
    let Some(value) = value else {
        return "null".into();
    };
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() || c == '\u{2028}' || c == '\u{2029}' => {
                out.push_str(&format!("\\u{{{:x}}}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The `arc-credential` window event: the outcome only, never the secret. `kind`
/// and `name` are null when the message itself was refused.
fn credential_event_script(
    kind: Option<&str>,
    name: Option<&str>,
    provider: Option<&str>,
    outcome: &credential::Outcome,
) -> String {
    format!(
        "window.dispatchEvent(new CustomEvent('arc-credential', {{detail: {{kind: {}, name: {}, provider: {}, stored: {}, cancelled: {}, error: {}}}}}))",
        js_string(kind),
        js_string(name),
        js_string(provider),
        outcome.stored,
        outcome.cancelled,
        js_string(outcome.error.as_deref())
    )
}

/// Rasterize the Snöggo mark to a `size`×`size` transparent RGBA buffer, cropped to
/// its bounding box so the mark fills the square with no white (or empty) padding.
fn render_icon_rgba(size: u32) -> Option<Vec<u8>> {
    let tree = resvg::usvg::Tree::from_data(SNOGGO, &resvg::usvg::Options::default()).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size, size)?;
    let bbox = tree.root().abs_bounding_box();
    let scale = (size as f32 / bbox.width()).min(size as f32 / bbox.height());
    let tx = (size as f32 - bbox.width() * scale) / 2.0 - bbox.x() * scale;
    let ty = (size as f32 - bbox.height() * scale) / 2.0 - bbox.y() * scale;
    let transform = resvg::tiny_skia::Transform::from_row(scale, 0.0, 0.0, scale, tx, ty);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Some(pixmap.data().to_vec())
}

fn snoggo_icon() -> Option<Icon> {
    let size: u32 = 256;
    Icon::from_rgba(render_icon_rgba(size)?, size, size).ok()
}

fn app_data_directory() -> Result<PathBuf, String> {
    let base = std::env::var_os(if cfg!(windows) {
        "LOCALAPPDATA"
    } else {
        "HOME"
    })
    .ok_or("The local application data directory is not available")?;
    let directory = PathBuf::from(base).join(if cfg!(windows) {
        "ArcScience"
    } else {
        ".arc-science"
    });
    create_dir_all(&directory).map_err(|error| {
        format!(
            "Cannot create application data directory {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory)
}

/// Browser profile (cache, storage) under the user's local application data, so it
/// is never written beside the executable, which an installed copy cannot write.
fn profile_directory() -> Option<std::path::PathBuf> {
    let directory = app_data_directory().ok()?.join("webview");
    match std::fs::create_dir_all(&directory) {
        Ok(()) => Some(directory),
        Err(error) => {
            eprintln!("arc-science-desktop: using the default browser profile location ({error})");
            None
        }
    }
}

fn startup_log_path() -> Option<PathBuf> {
    app_data_directory()
        .ok()
        .map(|directory| directory.join("startup.log"))
}

fn append_startup_log(path: Option<&Path>, line: &str) {
    let Some(path) = path else {
        return;
    };
    let safe = startup::redact(line);
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{safe}");
    }
}

fn reset_startup_log(path: Option<&Path>) {
    let Some(path) = path else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
    {
        let _ = writeln!(
            file,
            "Arc Science startup log (redacted). No raw secrets or shell commands are recorded."
        );
    }
}

fn open_owned_path(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::{OsStr, c_void};
        use std::os::windows::ffi::OsStrExt;
        use std::ptr::{null, null_mut};
        #[link(name = "shell32")]
        unsafe extern "system" {
            fn ShellExecuteW(
                hwnd: *mut c_void,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show: i32,
            ) -> isize;
        }
        const SW_SHOWNORMAL: i32 = 1;
        let wide = |s: &OsStr| -> Vec<u16> { s.encode_wide().chain(Some(0)).collect() };
        let operation = wide(OsStr::new("open"));
        let file = wide(path.as_os_str());
        // SAFETY: both strings are NUL-terminated and outlive the call; no shell
        // command line is composed, and optional arguments are null.
        let result = unsafe {
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                null(),
                null(),
                SW_SHOWNORMAL,
            )
        };
        if result > 32 {
            Ok(())
        } else {
            Err(format!(
                "Windows could not open {} (ShellExecuteW returned {result})",
                path.display()
            ))
        }
    }
    #[cfg(not(windows))]
    {
        let launcher = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        let mut child = Command::new(launcher)
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("{launcher}: {error}"))?;
        std::thread::spawn(move || child.wait());
        Ok(())
    }
}

fn relaunch_self_once() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| {
        format!("Cannot locate the current Arc Science executable for retry: {error}")
    })?;
    Command::new(&exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Cannot relaunch {}: {error}", exe.display()))?;
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let check_only = args.as_slice() == ["--check-startup"];
    if !args.is_empty() && !check_only {
        return Err("Usage: arc-science-desktop [--check-startup]; configure via ARC_DESKTOP_* environment variables".into());
    }
    if check_only {
        // Headless readiness stays service-first: nothing to show, only to verify.
        let (config, _) = Config::from_env()?;
        let service = start_service(&config)?;
        println!(
            "Arc Science is ready. {}",
            if service.is_some() {
                "The service was started by this check and is shut down on exit."
            } else {
                "An existing service answered and is left running."
            }
        );
        return Ok(());
    }

    // Window first: the operator sees the starting state at once; configuration,
    // discovery and the service start all run on one thread, and any failure lands
    // in the window and a native dialog instead of a console nobody sees.
    let mut service: Option<ServiceGuard> = None;
    let event_loop = EventLoopBuilder::<Shell>::with_user_event().build();
    let shell = event_loop.create_proxy();
    let recovery_shell = event_loop.create_proxy();
    let startup_log = startup_log_path();
    reset_startup_log(startup_log.as_deref());
    append_startup_log(startup_log.as_deref(), "Startup: opening native window");
    let attach = DiagnosticAttach::enable()?;
    let title = match &attach {
        Some(attach) => format!(
            "Arc Science — diagnostic attach on 127.0.0.1:{}",
            attach.port
        ),
        None => "Arc Science".to_string(),
    };
    let mut window = WindowBuilder::new()
        .with_title(&title)
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 860.0));
    if let Some(icon) = snoggo_icon() {
        window = window.with_window_icon(Some(icon));
    }
    let window = window
        .build(&event_loop)
        .map_err(|e| format!("Cannot create desktop window: {e}"))?;
    // The service origin is known only once configuration ran; until the workbench
    // is loaded, only the inline starting and failure pages may navigate, and after
    // that only the service origin (downloads keep the page's origin).
    let origin: Arc<Mutex<Option<startup::LocalUrl>>> = Arc::new(Mutex::new(None));
    let native_session: Arc<Mutex<Option<NativeSession>>> = Arc::new(Mutex::new(None));
    let workbench_loaded = Arc::new(AtomicBool::new(false));
    let startup_started = Instant::now();
    let startup_display = Arc::new(Mutex::new(StartupDisplay {
        operation: "Preparing the workspace".into(),
        timeout: Some(launch::STEP_TIMEOUT),
        timeout_note: Some("per-step configuration timeout".into()),
    }));
    let startup_running = Arc::new(AtomicBool::new(true));
    let recovery_available = Arc::new(AtomicBool::new(false));
    let (nav_origin, nav_loaded) = (Arc::clone(&origin), Arc::clone(&workbench_loaded));
    let nav_recovery = Arc::clone(&recovery_available);
    let (ipc_origin, ipc_shell, ipc_log) = (
        Arc::clone(&origin),
        event_loop.create_proxy(),
        startup_log.clone(),
    );
    let mut context = wry::WebContext::new(match &attach {
        Some(attach) => Some(attach.profile_directory()?),
        None => profile_directory(),
    });
    let initial_progress = startup_progress(
        "Preparing the workspace",
        startup_started,
        Some(launch::STEP_TIMEOUT),
        Some("per-step configuration timeout"),
        startup_started,
    );
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_html(launch::starting_page_with_progress(None, &initial_progress));
    #[cfg(windows)]
    let builder = match &attach {
        Some(attach) => {
            use wry::WebViewBuilderExtWindows;
            append_startup_log(
                startup_log.as_deref(),
                &format!(
                    "Startup: development diagnostic attach enabled on 127.0.0.1:{} (WebView and its requests are exposed to local processes)",
                    attach.port
                ),
            );
            builder.with_additional_browser_args(diagnostic_browser_args(attach.port))
        }
        None => builder,
    };
    #[cfg(not(windows))]
    if attach.is_some() {
        return Err("ARC_DESKTOP_DIAGNOSTIC_ATTACH is supported on Windows WebView2 only".into());
    }
    let webview = builder
        .with_navigation_handler(move |target| {
            if let Some(action) =
                failure_recovery_action(target.as_str(), nav_recovery.load(Ordering::SeqCst))
            {
                match action {
                    RecoveryAction::Retry => {
                        let _ = recovery_shell.send_event(Shell::RetryStartup);
                        return false;
                    }
                    RecoveryAction::OpenLog => {
                        let _ = recovery_shell.send_event(Shell::OpenStartupLog);
                        return false;
                    }
                }
            }
            if nav_loaded.load(Ordering::SeqCst) {
                nav_origin
                    .lock()
                    .ok()
                    .and_then(|o| o.as_ref().map(|o| o.allows(&target)))
                    .unwrap_or(false)
            } else {
                target == "about:blank" || target.starts_with("data:")
            }
        })
        .with_ipc_handler(move |request| {
            // Only a page from the service origin may ask; the body of anything else
            // is untrusted text and is neither parsed nor logged.
            let uri = request.uri();
            let allowed = ipc_origin
                .lock()
                .ok()
                .and_then(|o| o.as_ref().map(|o| o.allows(&uri.to_string())))
                .unwrap_or(false);
            if !allowed {
                let line = format!(
                    "Credential: refused an IPC message from {}://{}",
                    uri.scheme_str().unwrap_or("?"),
                    uri.authority().map_or("?", |a| a.as_str())
                );
                eprintln!("arc-science-desktop: {line}");
                append_startup_log(ipc_log.as_deref(), &line);
                return;
            }
            let _ = ipc_shell.send_event(Shell::Credential(credential::parse(request.body())));
        })
        .with_download_completed_handler(move |_uri, path, success| {
            let text = |p: Option<&std::path::Path>| p.and_then(|p| p.to_str()).map(str::to_owned);
            let _ = shell.send_event(Shell::DownloadFinished {
                file: text(
                    path.as_deref()
                        .and_then(|p| p.file_name())
                        .map(std::path::Path::new),
                ),
                folder: text(path.as_deref().and_then(|p| p.parent())),
                success,
            });
        })
        .with_new_window_req_handler(|target, _| {
            match external::external_target(&target) {
                Some(url) => {
                    if let Err(error) = external::open(&url) {
                        eprintln!(
                            "arc-science-desktop: cannot open {url} in the system browser: {error}"
                        );
                    }
                }
                None => eprintln!("arc-science-desktop: refused a new window for {target}"),
            }
            wry::NewWindowResponse::Deny
        })
        .build(&window)
        .map_err(|e| format!("Cannot initialize desktop WebView: {e}"))?;
    let mut attach = attach;
    if let Some(attach) = attach.as_mut() {
        attach.publish()?;
        append_startup_log(
            startup_log.as_deref(),
            &format!(
                "Startup: diagnostic attach listening on 127.0.0.1:{}; record published",
                attach.port
            ),
        );
    }
    let native_session_available =
        match install_native_session_handler(&webview, Arc::clone(&native_session)) {
            Ok(available) => available,
            Err(error) => {
                eprintln!("arc-science-desktop: {error}; native unlock disabled");
                false
            }
        };
    {
        let starter = event_loop.create_proxy();
        spawn_startup_ticker(
            event_loop.create_proxy(),
            Arc::clone(&startup_running),
            Arc::clone(&startup_display),
            startup_started,
        );
        let origin = Arc::clone(&origin);
        let display = Arc::clone(&startup_display);
        let running = Arc::clone(&startup_running);
        let log_path = startup_log.clone();
        std::thread::spawn(move || {
            append_startup_log(log_path.as_deref(), "Startup: preparing the workspace");
            let (config, plan) = match Config::from_env() {
                Ok(found) => found,
                Err(reason) => {
                    running.store(false, Ordering::SeqCst);
                    append_startup_log(
                        log_path.as_deref(),
                        &format!("Startup failed during configuration: {reason}"),
                    );
                    let _ = starter.send_event(Shell::Failed(reason, None));
                    return;
                }
            };
            append_startup_log(
                log_path.as_deref(),
                &format!(
                    "Startup: configuration ready; service readiness timeout is {} seconds",
                    config.timeout.as_secs()
                ),
            );
            if let Ok(mut slot) = origin.lock() {
                *slot = Some(config.url.clone());
            }
            if let Ok(mut state) = display.lock() {
                state.operation = "Starting the local service".into();
                state.timeout = Some(config.timeout);
                state.timeout_note = Some("service readiness timeout".into());
            }
            let _ = starter.send_event(Shell::Planned {
                plan: plan.clone(),
                progress: startup_progress(
                    "Starting the local service",
                    startup_started,
                    Some(config.timeout),
                    Some("service readiness timeout"),
                    Instant::now(),
                ),
            });
            let secret = if native_session_available {
                NativeSessionSecret::generate().ok()
            } else {
                None
            };
            let outcome = match start_service_with_native_session(
                &config,
                secret.as_ref().map(NativeSessionSecret::as_str),
            ) {
                Ok(guard) => {
                    let native_session = match (guard.is_some(), secret) {
                        (true, Some(secret)) => Some(NativeSession {
                            url: config.url.clone(),
                            secret: secret.0,
                        }),
                        _ => None,
                    };
                    Shell::Ready {
                        url: config.url.display.clone(),
                        guard,
                        native_session,
                    }
                }
                Err(reason) => Shell::Failed(reason, plan),
            };
            match &outcome {
                Shell::Ready { .. } => {
                    append_startup_log(log_path.as_deref(), "Startup: service became ready");
                }
                Shell::Failed(reason, _) => {
                    append_startup_log(
                        log_path.as_deref(),
                        &format!("Startup failed while starting service: {reason}"),
                    );
                }
                _ => {}
            }
            running.store(false, Ordering::SeqCst);
            let _ = starter.send_event(outcome);
        });
    }
    let window_handle = launch::window_handle(&window);
    // tao's event loop never returns, so the attach record is dropped on the close
    // paths explicitly rather than at the end of scope.
    let mut attach_record = attach;
    let mut startup_plan: Option<launch::Plan> = None;
    let mut startup_terminal = false;
    event_loop.run(move |event, _target, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                service.take();
                attach_record.take();
                startup_running.store(false, Ordering::SeqCst);
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(Shell::StartupTick(progress)) => {
                if !startup_terminal {
                    let _ = webview
                        .load_html(&launch::starting_page_with_progress(startup_plan.as_ref(), &progress));
                }
            }
            Event::UserEvent(Shell::Planned { plan, progress }) => {
                startup_plan = plan;
                if !startup_terminal {
                    let _ = webview.load_html(&launch::starting_page_with_progress(
                        startup_plan.as_ref(),
                        &progress,
                    ));
                }
            }
            Event::UserEvent(Shell::Ready {
                url,
                guard,
                native_session: ready_native_session,
            }) => {
                startup_terminal = true;
                startup_running.store(false, Ordering::SeqCst);
                recovery_available.store(false, Ordering::SeqCst);
                service = guard;
                if let Ok(mut slot) = native_session.lock() {
                    *slot = ready_native_session;
                }
                workbench_loaded.store(true, Ordering::SeqCst);
                if let Err(error) = webview.load_url(&url) {
                    let reason = format!("Cannot load the workbench at {url}: {error}");
                    eprintln!("arc-science-desktop: {reason}");
                    append_startup_log(startup_log.as_deref(), &reason);
                    workbench_loaded.store(false, Ordering::SeqCst);
                    recovery_available.store(true, Ordering::SeqCst);
                    if let Ok(mut slot) = native_session.lock() {
                        *slot = None;
                    }
                    let _ = webview.load_html(&launch::failure_page(
                        &reason,
                        None,
                        startup_log.as_deref(),
                    ));
                    let (owner, text) = (window_handle, reason);
                    std::thread::spawn(move || launch::message_box(owner, &text));
                }
            }
            Event::UserEvent(Shell::Failed(reason, plan)) => {
                startup_terminal = true;
                startup_running.store(false, Ordering::SeqCst);
                recovery_available.store(true, Ordering::SeqCst);
                if let Ok(mut slot) = native_session.lock() {
                    *slot = None;
                }
                eprintln!("arc-science-desktop: {reason}");
                append_startup_log(startup_log.as_deref(), &format!("Startup failed: {reason}"));
                let _ = webview.load_html(&launch::failure_page(
                    &reason,
                    plan.as_ref(),
                    startup_log.as_deref(),
                ));
                // The dialog is owned by the window and shown from its own thread, so
                // the failure page still paints behind it.
                let (owner, text) = (window_handle, reason.clone());
                std::thread::spawn(move || launch::message_box(owner, &text));
            }
            Event::UserEvent(Shell::RetryStartup) => {
                if recovery_available.load(Ordering::SeqCst) {
                    append_startup_log(startup_log.as_deref(), "Recovery: retry requested");
                    match relaunch_self_once() {
                        Ok(()) => {
                            append_startup_log(
                                startup_log.as_deref(),
                                "Recovery: fresh process launched; exiting current window",
                            );
                            service.take();
                            attach_record.take();
                            *control_flow = ControlFlow::Exit;
                        }
                        Err(error) => {
                            append_startup_log(
                                startup_log.as_deref(),
                                &format!("Recovery retry failed: {error}"),
                            );
                            let (owner, text) = (window_handle, error);
                            std::thread::spawn(move || launch::message_box(owner, &text));
                        }
                    }
                }
            }
            Event::UserEvent(Shell::OpenStartupLog) => {
                if recovery_available.load(Ordering::SeqCst)
                    && let Some(path) = startup_log.as_deref()
                {
                    append_startup_log(startup_log.as_deref(), "Recovery: open log requested");
                    if let Err(error) = open_owned_path(path) {
                        append_startup_log(
                            startup_log.as_deref(),
                            &format!("Recovery open log failed: {error}"),
                        );
                        let (owner, text) = (window_handle, error);
                        std::thread::spawn(move || launch::message_box(owner, &text));
                    }
                }
            }
            Event::UserEvent(Shell::DownloadFinished {
                file,
                folder,
                success,
            }) => {
                let script = format!(
                    "window.dispatchEvent(new CustomEvent('arc-download', {{detail: {{file: {}, folder: {}, success: {success}}}}}))",
                    js_string(file.as_deref()),
                    js_string(folder.as_deref())
                );
                if let Err(error) = webview.evaluate_script(&script) {
                    eprintln!("arc-science-desktop: cannot report a download to the page: {error}");
                }
            }
            Event::UserEvent(Shell::Credential(request)) => {
                // The prompt is modal to this window and runs on this thread.
                let (kind, name, provider, outcome) = match request {
                    Ok(credential::Request::Store { name, provider }) => {
                        let outcome = credential::prompt_and_store(
                            window_handle,
                            &name,
                            &provider,
                            attach_record.is_some(),
                        );
                        (Some("store-credential"), Some(name), Some(provider), outcome)
                    }
                    Ok(credential::Request::Remove { name }) => {
                        let outcome = credential::remove(&name);
                        (Some("remove-credential"), Some(name), None, outcome)
                    }
                    Err(reason) => (None, None, None, credential::Outcome::error(reason)),
                };
                let result = match (&outcome.error, outcome.cancelled, outcome.stored) {
                    (Some(error), _, _) => format!("failed: {error}"),
                    (None, true, _) => "cancelled".into(),
                    (None, false, true) => "stored".into(),
                    (None, false, false) => "removed".into(),
                };
                append_startup_log(
                    startup_log.as_deref(),
                    &format!(
                        "Credential: {} {} {result}",
                        kind.unwrap_or("message"),
                        name.as_deref().unwrap_or("-")
                    ),
                );
                let script =
                    credential_event_script(kind, name.as_deref(), provider.as_deref(), &outcome);
                if let Err(error) = webview.evaluate_script(&script) {
                    eprintln!("arc-science-desktop: cannot report a credential outcome to the page: {error}");
                }
            }
            _ => {}
        }
    });
}

/// Attach the parent console when there is one, so text output still reaches the
/// shell that started us; a double-click has no parent console and shows nothing.
#[cfg(windows)]
fn attach_parent_console() {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    // SAFETY: a plain Win32 call with no pointers; failure only means no console.
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

fn main() -> std::process::ExitCode {
    #[cfg(windows)]
    attach_parent_console();
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            // Only window creation itself can fail here; even that is never silent.
            eprintln!("arc-science-desktop: {error}");
            if std::env::args_os().nth(1).is_none() {
                launch::message_box(0, &error);
            }
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_report_is_a_safe_javascript_literal() {
        assert_eq!(js_string(None), "null");
        assert_eq!(js_string(Some("1dqj-collage.svg")), "\"1dqj-collage.svg\"");
        assert_eq!(
            js_string(Some(r"C:\Users\a b\Downloads")),
            r#""C:\\Users\\a b\\Downloads""#
        );
        assert_eq!(
            js_string(Some("x\"</script>\n\u{2028}\u{7}")),
            r#""x\"</script>\n\u{2028}\u{7}""#
        );
    }

    #[test]
    fn credential_report_is_a_safe_javascript_literal_without_the_secret() {
        let stored = credential::Outcome {
            stored: true,
            cancelled: false,
            error: None,
        };
        assert_eq!(
            credential_event_script(
                Some("store-credential"),
                Some("planner-key"),
                Some("anthropic"),
                &stored
            ),
            "window.dispatchEvent(new CustomEvent('arc-credential', {detail: {kind: \"store-credential\", name: \"planner-key\", provider: \"anthropic\", stored: true, cancelled: false, error: null}}))"
        );
        // A name is validated before it gets here; even so, quotes cannot end the literal.
        let hostile = credential_event_script(
            Some("remove-credential"),
            Some("k\"}}));alert(1);//"),
            None,
            &credential::Outcome::error("CredDeleteW failed with code 5"),
        );
        assert!(hostile.contains(r#"name: "k\"}}));alert(1);//", provider: null"#));
        assert!(hostile.ends_with(r#"error: "CredDeleteW failed with code 5"}}))"#));
        assert_eq!(hostile.matches("dispatchEvent").count(), 1);
        let refused = credential_event_script(
            None,
            None,
            None,
            &credential::Outcome::error("kind must be store-credential or remove-credential"),
        );
        assert!(refused.contains("kind: null, name: null, provider: null, stored: false, cancelled: false, error: \"kind must be"));
    }

    #[test]
    fn native_session_secret_is_hex_without_page_metacharacters() {
        assert_eq!(hex(&[0x00, 0x7f, 0x80, 0xff]), "007f80ff");
        let first = NativeSessionSecret::generate().expect("secret generated");
        let second = NativeSessionSecret::generate().expect("secret generated");
        for secret in [first.as_str(), second.as_str()] {
            assert_eq!(secret.len(), 64);
            assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(!secret.contains(['"', '\'', '<', '>', '&', '/', '\\']));
        }
        assert_ne!(first.as_str(), second.as_str());
    }

    #[test]
    fn startup_progress_uses_elapsed_time_and_config_timeout() {
        let started = Instant::now();
        let progress = startup_progress(
            "Starting the local service",
            started,
            Some(Duration::from_secs(45)),
            Some("service readiness timeout"),
            started + Duration::from_secs(3),
        );
        assert_eq!(progress.operation, "Starting the local service");
        assert_eq!(progress.elapsed, Some(Duration::from_secs(3)));
        assert_eq!(progress.timeout, Some(Duration::from_secs(45)));
        assert_eq!(
            progress.timeout_note.as_deref(),
            Some("service readiness timeout")
        );
    }

    #[test]
    fn diagnostic_attach_is_opt_in_and_literal() {
        assert_eq!(diagnostic_attach_requested(None), Ok(false));
        assert_eq!(
            diagnostic_attach_requested(Some(std::ffi::OsStr::new("1"))),
            Ok(true)
        );
        assert!(diagnostic_attach_requested(Some(std::ffi::OsStr::new("true"))).is_err());
        assert!(diagnostic_attach_requested(Some(std::ffi::OsStr::new(""))).is_err());
        let args = diagnostic_browser_args(4321);
        assert!(args.contains("--remote-debugging-port=4321"));
        assert!(
            args.starts_with("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection ")
        );
        assert!(args.contains("--autoplay-policy=no-user-gesture-required"));
    }

    #[test]
    fn diagnostic_record_is_published_only_for_a_devtools_endpoint() {
        // A port nobody listens on: publish refuses and writes no record.
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let record = std::env::temp_dir().join(format!("arc-attach-test-{port}.json"));
        let mut attach = DiagnosticAttach {
            port,
            record: record.clone(),
            published: false,
        };
        assert!(!devtools_answering(port, Duration::from_millis(300)));
        assert!(attach.publish().is_err());
        assert!(!record.exists());
        // A bare listener that answers nothing DevTools-like is not enough either.
        let bare = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        attach.port = bare.local_addr().unwrap().port();
        assert!(attach.publish().is_err());
        drop(bare);
        // Something that answers /json/version like a DevTools endpoint: published, then removed.
        let endpoint = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        attach.port = endpoint.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            for stream in endpoint.incoming().take(3) {
                let mut stream = stream.unwrap();
                let mut buffer = [0u8; 1024];
                let _ = stream.read(&mut buffer);
                let body = "{\"Browser\":\"fake\",\"webSocketDebuggerUrl\":\"ws://127.0.0.1/devtools/browser/x\"}";
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
            }
        });
        attach.publish().unwrap();
        let text = std::fs::read_to_string(&record).unwrap();
        assert!(text.contains(&format!("\"port\":{}", attach.port)));
        assert!(text.contains(&format!("\"pid\":{}", std::process::id())));
        drop(attach);
        assert!(!record.exists());
    }

    #[test]
    fn a_live_attach_record_belongs_to_a_running_process() {
        let record =
            std::env::temp_dir().join(format!("arc-attach-pid-test-{}.json", std::process::id()));
        std::fs::write(
            &record,
            format!("{{\"pid\":{},\"port\":1}}", std::process::id()),
        )
        .unwrap();
        assert_eq!(recorded_pid(&record), Some(std::process::id()));
        assert!(process_alive(std::process::id()) == cfg!(windows));
        // A pid that cannot exist is not alive.
        assert!(!process_alive(u32::MAX - 1));
        let _ = std::fs::remove_file(&record);
        assert_eq!(recorded_pid(&record), None);
    }

    #[test]
    fn recovery_actions_are_failure_gated() {
        assert_eq!(
            failure_recovery_action("arc-science://startup/retry", true),
            Some(RecoveryAction::Retry)
        );
        assert_eq!(
            failure_recovery_action("arc-science://startup/open-log", true),
            Some(RecoveryAction::OpenLog)
        );
        assert_eq!(
            failure_recovery_action("arc-science://startup/retry", false),
            None
        );
        assert_eq!(failure_recovery_action("https://example.org", true), None);
        assert_eq!(
            failure_recovery_action("arc-science://startup/open-log?x=1", true),
            None
        );
    }

    #[test]
    fn startup_log_is_redacted_before_disk_write() {
        let path = std::env::temp_dir().join(format!(
            "arc-startup-test-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time moves forward")
                .as_nanos()
        ));
        reset_startup_log(Some(&path));
        append_startup_log(
            Some(&path),
            "Authorization: Bearer sk-ant-abcdef0123456789 token=abc123 plain words stay",
        );
        let text = std::fs::read_to_string(&path).expect("startup log readable");
        let _ = std::fs::remove_file(&path);
        assert!(text.contains("plain words stay"));
        assert!(text.contains("Bearer [redacted]"));
        assert!(text.contains("token=[redacted]"));
        assert!(!text.contains("sk-ant-abcdef0123456789"));
        assert!(!text.contains("abc123"));
    }

    #[test]
    fn icon_has_no_white_padding() {
        let size = 128u32;
        let rgba = render_icon_rgba(size).expect("icon renders");
        let alpha = |x: u32, y: u32| rgba[((y * size + x) * 4 + 3) as usize];
        // No background rect: all four corners are fully transparent (not cream/white).
        for (x, y) in [(0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)] {
            assert_eq!(
                alpha(x, y),
                0,
                "corner ({x},{y}) must be transparent, not padded"
            );
        }
        // Cropped tight: the mark touches opposite edges on at least one axis.
        let row_has = |y: u32| (0..size).any(|x| alpha(x, y) > 0);
        let col_has = |x: u32| (0..size).any(|y| alpha(x, y) > 0);
        assert!(
            (row_has(0) && row_has(size - 1)) || (col_has(0) && col_has(size - 1)),
            "mark must reach opposite icon edges (no margin)"
        );
        // The puddles inside the mark are white and opaque, not see-through.
        let pixel = |x: u32, y: u32| {
            let i = ((y * size + x) * 4) as usize;
            (rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])
        };
        for (x, y) in [(40, 35), (32, 32), (70, 95)] {
            assert_eq!(
                pixel(x, y),
                (255, 255, 255, 255),
                "puddle at ({x},{y}) must be white"
            );
        }
        assert_eq!(pixel(64, 64).3, 255, "the mark itself is opaque");
    }
}
