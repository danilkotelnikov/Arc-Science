//! Local startup contract. The public service marker is compatibility, not auth.
use std::{
    collections::BTreeMap,
    ffi::OsString,
    net::IpAddr,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// How much of the supervisor's stderr is kept for a failure report.
const STDERR_TAIL: usize = 16 * 1024;

const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_millis(100);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);
const SERVICE_HEADER: &str = "x-arc-science-service";
const SERVICE_ID: &str = "arc-science-v1";
pub const NATIVE_SESSION_ENV: &str = "ARC_NATIVE_SESSION_SECRET";
/// Set only in the environment of a service process this host starts; a reused service never sees it.
pub const HOST_SESSION_ENV: &str = "ARC_HOST_SESSION";

#[derive(Clone, Debug)]
pub struct LocalUrl {
    pub display: String,
    pub health: String,
    origin: (IpAddr, u16),
}

impl LocalUrl {
    pub fn parse(value: &str) -> Result<Self, String> {
        if value.contains('\\') || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("ARC_DESKTOP_URL contains invalid URL characters".into());
        }
        let uri: ureq::http::Uri = value
            .split('#')
            .next()
            .unwrap_or(value)
            .parse()
            .map_err(|_| "ARC_DESKTOP_URL must be an absolute HTTP URL")?;
        let authority = uri
            .authority()
            .ok_or("ARC_DESKTOP_URL requires an authority")?;
        if uri.scheme_str() != Some("http") || authority.as_str().contains('@') {
            return Err("ARC_DESKTOP_URL requires HTTP without credentials".into());
        }
        let ip: IpAddr = authority
            .host()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse()
            .map_err(|_| "ARC_DESKTOP_URL host must be a numeric loopback IP")?;
        if !ip.is_loopback() {
            return Err("ARC_DESKTOP_URL host must be loopback".into());
        }
        // http::Authority::port() returns None for an invalid/out-of-range port;
        // do not accidentally reinterpret such a URL as port 80.
        let suffix = authority
            .as_str()
            .strip_prefix(authority.host())
            .ok_or("ARC_DESKTOP_URL has an invalid authority")?;
        let port = if suffix.is_empty() {
            80
        } else {
            suffix
                .strip_prefix(':')
                .and_then(|port| port.parse::<u16>().ok())
                .ok_or("ARC_DESKTOP_URL port must be 1..65535")?
        };
        if port == 0 {
            return Err("ARC_DESKTOP_URL port must be 1..65535".into());
        }
        let host = match ip {
            IpAddr::V4(ip) => ip.to_string(),
            IpAddr::V6(ip) => format!("[{ip}]"),
        };
        Ok(Self {
            display: value.into(),
            health: format!("http://{host}:{port}/health"),
            origin: (ip, port),
        })
    }

    #[cfg(test)]
    pub fn origin(&self) -> String {
        let host = match self.origin.0 {
            IpAddr::V4(ip) => ip.to_string(),
            IpAddr::V6(ip) => format!("[{ip}]"),
        };
        format!("http://{host}:{}", self.origin.1)
    }

    pub fn is_api_resource(&self, value: &str) -> bool {
        let Ok(uri) = value.parse::<ureq::http::Uri>() else {
            return false;
        };
        if uri.scheme_str() != Some("http") {
            return false;
        }
        let Some(authority) = uri.authority() else {
            return false;
        };
        let Ok(ip) = authority
            .host()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
        else {
            return false;
        };
        let suffix = match authority.as_str().strip_prefix(authority.host()) {
            Some(suffix) => suffix,
            None => return false,
        };
        let port = if suffix.is_empty() {
            80
        } else {
            match suffix
                .strip_prefix(':')
                .and_then(|port| port.parse::<u16>().ok())
            {
                Some(port) => port,
                None => return false,
            }
        };
        (ip, port) == self.origin
            && (uri.path() == "/api" || uri.path().strip_prefix("/api/").is_some())
    }

    pub fn allows(&self, value: &str) -> bool {
        // Workbench downloads are object URLs with the creating page's origin.
        let target = value.strip_prefix("blob:").unwrap_or(value);
        Self::parse(target).is_ok_and(|url| url.origin == self.origin)
    }
}

#[derive(Debug)]
pub struct Config {
    pub url: LocalUrl,
    pub executable: OsString,
    pub args: Vec<OsString>,
    pub timeout: Duration,
}

impl Config {
    /// Capture once: health, navigation and launch all use the same configuration.
    /// With no launcher environment at all, the shell configures itself through the
    /// native supervisor (a plain double-click).
    pub fn from_env() -> Result<(Self, Option<crate::launch::Plan>), String> {
        let env: BTreeMap<OsString, OsString> = std::env::vars_os().collect();
        let explicit = [
            "ARC_DESKTOP_EXECUTABLE",
            "ARC_DESKTOP_SERVE",
            "ARC_DESKTOP_ARG_COUNT",
        ]
        .iter()
        .any(|key| env.contains_key(std::ffi::OsStr::new(key)));
        if explicit {
            return Ok((Self::parse(&env)?, None));
        }
        let timeout = Self::parse(&env)?.timeout;
        let (config, plan) = crate::launch::self_configure(timeout)?;
        Ok((config, Some(plan)))
    }

    fn parse(env: &BTreeMap<OsString, OsString>) -> Result<Self, String> {
        let string = |key: &str| -> Result<Option<&str>, String> {
            env.get(std::ffi::OsStr::new(key))
                .map(|s| s.to_str().ok_or_else(|| format!("{key} must be Unicode")))
                .transpose()
        };
        let url = LocalUrl::parse(string("ARC_DESKTOP_URL")?.unwrap_or("http://127.0.0.1:8080/"))?;
        let timeout = string("ARC_DESKTOP_TIMEOUT")?
            .unwrap_or("30")
            .parse::<u64>()
            .ok()
            .filter(|seconds| (1..=300).contains(seconds))
            .ok_or("ARC_DESKTOP_TIMEOUT must be an integer from 1 to 300 seconds")?;
        let explicit = env.get(std::ffi::OsStr::new("ARC_DESKTOP_EXECUTABLE"));
        if let Some(legacy) = string("ARC_DESKTOP_SERVE")?
            && (legacy != "arc-science serve" || explicit.is_some())
        {
            return Err("ARC_DESKTOP_SERVE only supports the legacy value 'arc-science serve'; use ARC_DESKTOP_EXECUTABLE and ARC_DESKTOP_ARG_COUNT/ARC_DESKTOP_ARG_0... for literal arguments (no shell quoting)".into());
        }
        let (executable, args) = if let Some(executable) = explicit {
            if executable.is_empty() || executable.to_string_lossy().contains('\0') {
                return Err("ARC_DESKTOP_EXECUTABLE must name one executable".into());
            }
            #[cfg(windows)]
            if std::path::Path::new(executable)
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
            {
                return Err(
                    "ARC_DESKTOP_EXECUTABLE must be a native executable, not a batch script".into(),
                );
            }
            let count = string("ARC_DESKTOP_ARG_COUNT")?
                .and_then(|s| s.parse::<usize>().ok())
                .filter(|count| *count <= 64)
                .ok_or("Set ARC_DESKTOP_ARG_COUNT to 0..64 with an explicit executable")?;
            let args = (0..count)
                .map(|i| {
                    let key = format!("ARC_DESKTOP_ARG_{i}");
                    let value = env
                        .get(std::ffi::OsStr::new(&key))
                        .ok_or_else(|| format!("Missing {key}"))?;
                    if value.to_string_lossy().contains('\0') {
                        return Err(format!("{key} contains NUL"));
                    }
                    Ok(value.clone())
                })
                .collect::<Result<Vec<_>, String>>()?;
            (executable.clone(), args)
        } else {
            if string("ARC_DESKTOP_ARG_COUNT")?.is_some() {
                return Err("ARC_DESKTOP_ARG_COUNT requires ARC_DESKTOP_EXECUTABLE".into());
            }
            ("arc-science".into(), vec!["serve".into()])
        };
        Ok(Self {
            url,
            executable,
            args,
            timeout: Duration::from_secs(timeout),
        })
    }
}

/// Closes the supervisor's stdin to request tree shutdown. Arbitrary commands that
/// do not implement that contract receive only direct-child kill/reap on timeout.
pub struct ServiceGuard {
    pub child: Child,
    stderr: Arc<Mutex<String>>,
}

impl ServiceGuard {
    /// The bounded tail of what the supervisor wrote to stderr so far.
    pub fn stderr_tail(&self) -> String {
        self.stderr.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

impl Drop for ServiceGuard {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let started = Instant::now();
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if started.elapsed() < SHUTDOWN_GRACE => std::thread::sleep(POLL),
                _ => break,
            }
        }
        eprintln!(
            "arc-science-desktop: shutdown grace expired; terminating direct child (descendants require the native supervisor --parent-stdin contract)"
        );
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Strip anything that looks like a credential from text that will be shown: bearer
/// values, `name=value` pairs for secret-like names, and long opaque tokens. The
/// contract says no descendant prints secrets; this is the belt to that suspender.
pub fn redact(text: &str) -> String {
    let secret_name = |name: &str| {
        let name = name.to_ascii_lowercase();
        [
            "token",
            "secret",
            "password",
            "passwd",
            "api_key",
            "apikey",
            "key",
            "authorization",
            "cookie",
        ]
        .iter()
        .any(|needle| name.ends_with(needle))
    };
    let opaque = |word: &str| {
        word.len() >= 32
            && word.chars().all(|c| {
                c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+' | '/' | '=')
            })
            && word.chars().any(|c| c.is_ascii_digit())
    };
    let mut out = Vec::new();
    let mut after_bearer = false;
    for word in text.split_inclusive(char::is_whitespace) {
        let (body, space) = word.split_at(word.trim_end().len());
        let replaced = if after_bearer && body.eq_ignore_ascii_case("bearer") {
            body.to_string() // "Authorization: Bearer x": the value is still ahead
        } else if after_bearer {
            after_bearer = false;
            "[redacted]".to_string()
        } else if body.eq_ignore_ascii_case("bearer")
            || body.strip_suffix([':', '=']).is_some_and(secret_name)
        {
            // The value follows as the next word ("Bearer x", "secret: x").
            after_bearer = true;
            body.to_string()
        } else if let Some((name, _)) = body
            .split_once(['=', ':'])
            .filter(|(name, value)| !value.is_empty() && secret_name(name))
        {
            format!("{name}=[redacted]")
        } else if opaque(body) {
            "[redacted]".to_string()
        } else {
            body.to_string()
        };
        out.push(replaced + space);
    }
    out.concat()
}

fn tail_stderr(stream: Option<impl std::io::Read + Send + 'static>) -> Arc<Mutex<String>> {
    let tail = Arc::new(Mutex::new(String::new()));
    if let Some(mut stream) = stream {
        let sink = Arc::clone(&tail);
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                let n = match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                if let Ok(mut text) = sink.lock() {
                    text.push_str(&String::from_utf8_lossy(&buffer[..n]));
                    if text.len() > STDERR_TAIL {
                        let cut = text.len() - STDERR_TAIL;
                        let boundary = (cut..text.len())
                            .find(|i| text.is_char_boundary(*i))
                            .unwrap_or(cut);
                        text.drain(..boundary);
                    }
                }
            }
        });
    }
    tail
}

pub fn health_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_millis(250)))
        .timeout_global(Some(HEALTH_TIMEOUT))
        .build()
        .into()
}

fn is_healthy(agent: &ureq::Agent, url: &LocalUrl, remaining: Duration) -> Result<bool, String> {
    let response = match agent
        .get(&url.health)
        .config()
        .timeout_global(Some(HEALTH_TIMEOUT.min(remaining)))
        .build()
        .call()
    {
        Ok(response) => response,
        Err(_) => return Ok(false),
    };
    if response.status() != 200
        || response
            .headers()
            .get(SERVICE_HEADER)
            .and_then(|v| v.to_str().ok())
            != Some(SERVICE_ID)
    {
        return Err(format!(
            "{} did not return Arc Science readiness (expected HTTP 200 and {SERVICE_HEADER}: {SERVICE_ID}); refusing to use that listener",
            url.health
        ));
    }
    Ok(true)
}

pub fn start_service(config: &Config) -> Result<Option<ServiceGuard>, String> {
    start_service_with_native_session(config, None)
}

pub fn start_service_with_native_session(
    config: &Config,
    native_session_secret: Option<&str>,
) -> Result<Option<ServiceGuard>, String> {
    let started = Instant::now();
    let agent = health_agent();
    if is_healthy(&agent, &config.url, config.timeout)? {
        return Ok(None);
    }
    if started.elapsed() >= config.timeout {
        return Err(format!(
            "Service readiness timed out after {} seconds",
            config.timeout.as_secs()
        ));
    }
    let mut command = Command::new(&config.executable);
    command.env(HOST_SESSION_ENV, "owned");
    command
        .args(&config.args)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(secret) = native_session_secret {
        command.env(NATIVE_SESSION_ENV, secret);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW for the background worker.
    }
    let mut child = command.spawn().map_err(|e| {
        format!(
            "Cannot start service executable {:?}: {e}",
            config.executable
        )
    })?;
    let stderr = tail_stderr(child.stderr.take());
    let mut guard = ServiceGuard { child, stderr };
    let with_tail = |message: String, guard: &ServiceGuard| {
        let tail = redact(&guard.stderr_tail());
        let tail = tail.trim();
        if tail.is_empty() {
            message
        } else {
            format!("{message}\n{tail}")
        }
    };
    loop {
        if let Some(status) = guard
            .child
            .try_wait()
            .map_err(|e| format!("Cannot inspect service process: {e}"))?
        {
            std::thread::sleep(POLL); // let the stderr reader drain the final lines
            return Err(with_tail(
                format!("Service exited before readiness: {status}"),
                &guard,
            ));
        }
        let remaining = config.timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err(with_tail(
                format!(
                    "Service readiness timed out after {} seconds",
                    config.timeout.as_secs()
                ),
                &guard,
            ));
        }
        if is_healthy(&agent, &config.url, remaining)? {
            if let Some(status) = guard
                .child
                .try_wait()
                .map_err(|e| format!("Cannot inspect service process: {e}"))?
            {
                return Err(with_tail(
                    format!("Service exited during readiness: {status}"),
                    &guard,
                ));
            }
            return Ok(Some(guard));
        }
        std::thread::sleep(POLL.min(config.timeout.saturating_sub(started.elapsed())));
    }
}

#[cfg(test)]
mod tests;
