//! External links. `target="_blank"` and `window.open` never create a second
//! WebView: an approved `https:` target is handed to the operating system's default
//! browser and everything else is refused. The workbench itself stays local.

/// The URL to hand to the system browser, or `None` to refuse the request.
pub fn external_target(value: &str) -> Option<String> {
    if value.contains('\\') || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let uri: ureq::http::Uri = value.split('#').next()?.parse().ok()?;
    let authority = uri.authority()?;
    if uri.scheme_str() != Some("https")
        || authority.host().is_empty()
        || authority.as_str().contains('@')
    {
        return None;
    }
    Some(value.to_string())
}

/// Open an approved target with the default browser. No shell parses the URL.
#[cfg(windows)]
pub fn open(url: &str) -> Result<(), String> {
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
    let wide = |s: &str| -> Vec<u16> { OsStr::new(s).encode_wide().chain(Some(0)).collect() };
    let (operation, file) = (wide("open"), wide(url));
    // SAFETY: both strings are NUL-terminated and outlive the call; the remaining
    // arguments are documented as optional (null).
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
    // Values above 32 are success; the rest are Win32 error codes.
    if result > 32 {
        Ok(())
    } else {
        Err(format!("ShellExecuteW failed with code {result}"))
    }
}

#[cfg(not(windows))]
pub fn open(url: &str) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let launcher = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut child = Command::new(launcher)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("{launcher}: {error}"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::external_target;

    #[test]
    fn only_clean_https_targets_reach_the_system_browser() {
        for allowed in [
            "https://www.rcsb.org/structure/1DQJ",
            "https://bioart.niaid.nih.gov/discover?q=lysozyme#results",
            "https://example.org",
        ] {
            assert_eq!(external_target(allowed).as_deref(), Some(allowed));
        }
        for refused in [
            "http://www.rcsb.org/structure/1DQJ",
            "https://user:secret@example.org/",
            "https:///no-host",
            "https://example.org/a b",
            "https://example.org/\u{7}",
            "https://example.org\\evil",
            "javascript:alert(1)",
            "file:///C:/Windows/system.ini",
            "data:text/html,x",
            "blob:http://127.0.0.1:8080/id",
            "",
        ] {
            assert_eq!(external_target(refused), None, "must refuse {refused:?}");
        }
    }
}
