//! The native credential boundary. The page never handles a secret: it names a
//! credential and its provider over `window.ipc.postMessage`, the host shows the
//! Windows credential prompt, writes what was typed to the Windows Credential
//! Manager as the generic credential `ArcScience/<name>` (user name = provider,
//! blob = the secret as UTF-8, local-machine persistence) and tells the page only
//! whether it is stored. The service reads it back by the same name (`CredReadW`).
//! Every buffer that held the secret is zeroed after use; nothing here logs,
//! returns or formats its value.

/// One validated request from the page.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Request {
    Store { name: String, provider: String },
    Remove { name: String },
}

/// What the page is told, never the secret. `stored` is false after a removal.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Outcome {
    pub stored: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

impl Outcome {
    pub fn error(reason: impl Into<String>) -> Self {
        Self {
            error: Some(reason.into()),
            ..Self::default()
        }
    }
}

const PROVIDERS: [&str; 4] = ["anthropic", "openai", "gemini", "openclaw"];

/// The same rule as the service (`credential_path`) and the supervisor (`identifier`).
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Parse and validate one IPC message. A reason never echoes the message text.
pub fn parse(body: &str) -> Result<Request, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "the credential message is not JSON")?;
    let text = |key: &str| value.get(key).and_then(serde_json::Value::as_str);
    let kind = match text("kind") {
        Some(kind @ ("store-credential" | "remove-credential")) => kind,
        _ => return Err("kind must be store-credential or remove-credential".into()),
    };
    let name = text("name")
        .filter(|name| valid_name(name))
        .ok_or("name must be 1-80 characters of [A-Za-z0-9._-]")?
        .to_string();
    if kind == "remove-credential" {
        return Ok(Request::Remove { name });
    }
    let provider = text("provider")
        .filter(|provider| PROVIDERS.contains(provider))
        .ok_or("provider must be anthropic, openai, gemini or openclaw")?
        .to_string();
    Ok(Request::Store { name, provider })
}

/// The Credential Manager target the service resolves by name.
pub fn target(name: &str) -> String {
    format!("ArcScience/{name}")
}

/// CREDUI_MAX_CAPTION_LENGTH: a longer caption is refused by the prompt, so a long
/// name is elided and the provider and the attach note stay.
const MAX_CAPTION: usize = 128;

#[cfg_attr(not(windows), allow(dead_code))]
fn caption(name: &str, provider: &str, attached: bool) -> String {
    let note = if attached {
        " (diagnostic attach is on)"
    } else {
        ""
    };
    let full = format!("Arc Science — credential {name} for {provider}{note}");
    let length = full.chars().count();
    if length <= MAX_CAPTION {
        return full;
    }
    // One character under the documented maximum: its inclusiveness is not documented.
    let room = MAX_CAPTION - 1 - (length - name.chars().count()) - 1;
    let short: String = name.chars().take(room).collect();
    format!("Arc Science — credential {short}… for {provider}{note}")
}

#[cfg_attr(not(windows), allow(dead_code))]
fn message(name: &str) -> String {
    format!(
        "Paste the key into the Password field. Arc stores it in your Windows Credential Manager as ArcScience/{name} and never shows it again. The User name field is optional."
    )
}

/// Overwrite a buffer that held the secret; the writes are volatile so they are
/// not elided as dead stores.
#[cfg_attr(not(windows), allow(dead_code))]
fn wipe<T: Copy + Default>(buffer: &mut [T]) {
    for item in buffer.iter_mut() {
        // SAFETY: a volatile write to a live element of the slice.
        unsafe { std::ptr::write_volatile(item, T::default()) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

#[cfg(windows)]
mod win {
    use super::{Outcome, caption, message, target, wipe};
    use std::ffi::{OsStr, c_void};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};

    #[repr(C)]
    struct CreduiInfoW {
        cb_size: u32,
        hwnd_parent: *mut c_void,
        message: *const u16,
        caption: *const u16,
        banner: *mut c_void,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: [u32; 2],
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "credui")]
    unsafe extern "system" {
        fn CredUIPromptForWindowsCredentialsW(
            ui: *const CreduiInfoW,
            auth_error: u32,
            auth_package: *mut u32,
            in_buffer: *const c_void,
            in_size: u32,
            out_buffer: *mut *mut c_void,
            out_size: *mut u32,
            save: *mut i32,
            flags: u32,
        ) -> u32;
        fn CredUnPackAuthenticationBufferW(
            flags: u32,
            buffer: *const c_void,
            size: u32,
            user: *mut u16,
            user_len: *mut u32,
            domain: *mut u16,
            domain_len: *mut u32,
            password: *mut u16,
            password_len: *mut u32,
        ) -> i32;
    }
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
    }
    #[link(name = "ole32")]
    unsafe extern "system" {
        fn CoTaskMemFree(pointer: *mut c_void);
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLastError() -> u32;
    }

    const CREDUIWIN_GENERIC: u32 = 0x1;
    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    const CRED_MAX_CREDENTIAL_BLOB_SIZE: usize = 5 * 512;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    const ERROR_NOT_FOUND: u32 = 1168;
    const ERROR_CANCELLED: u32 = 1223;

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    fn last_error() -> u32 {
        // SAFETY: a plain kernel32 call with no arguments.
        unsafe { GetLastError() }
    }

    /// Show the prompt owned by `owner` (0: centred on the screen), then store what
    /// was typed. The prompt runs its own message loop, so the caller's thread is the
    /// window's thread and stays modal until the operator answers.
    pub fn prompt_and_store(owner: isize, name: &str, provider: &str, attached: bool) -> Outcome {
        let (caption, message) = (
            wide(&caption(name, provider, attached)),
            wide(&message(name)),
        );
        let info = CreduiInfoW {
            cb_size: std::mem::size_of::<CreduiInfoW>() as u32,
            hwnd_parent: owner as *mut c_void,
            message: message.as_ptr(),
            caption: caption.as_ptr(),
            banner: null_mut(),
        };
        let mut package = 0u32;
        let mut buffer: *mut c_void = null_mut();
        let mut size = 0u32;
        // SAFETY: the info block and its NUL-terminated strings outlive the call; no
        // input credential is passed; the out buffer is ours to wipe and free below.
        let code = unsafe {
            CredUIPromptForWindowsCredentialsW(
                &info,
                0,
                &mut package,
                null(),
                0,
                &mut buffer,
                &mut size,
                null_mut(),
                CREDUIWIN_GENERIC,
            )
        };
        match code {
            0 => {}
            ERROR_CANCELLED => {
                return Outcome {
                    cancelled: true,
                    ..Outcome::default()
                };
            }
            code => {
                return Outcome::error(format!(
                    "the Windows credential prompt failed with code {code}"
                ));
            }
        }
        let outcome = unpack_and_write(buffer, size, name, provider);
        if !buffer.is_null() {
            // SAFETY: the prompt allocated `size` bytes at `buffer` with CoTaskMemAlloc;
            // they are wiped before the memory is returned.
            unsafe {
                wipe(std::slice::from_raw_parts_mut(
                    buffer.cast::<u8>(),
                    size as usize,
                ));
                CoTaskMemFree(buffer);
            }
        }
        outcome
    }

    fn unpack_and_write(buffer: *const c_void, size: u32, name: &str, provider: &str) -> Outcome {
        // One-unit buffers ask for the required sizes (in UTF-16 units, NUL included).
        let (mut user, mut domain, mut password) = ([0u16; 1], [0u16; 1], [0u16; 1]);
        let (mut user_len, mut domain_len, mut password_len) = (1u32, 1u32, 1u32);
        // SAFETY: every pointer names a live buffer whose length is passed beside it.
        let sized = unsafe {
            CredUnPackAuthenticationBufferW(
                0,
                buffer,
                size,
                user.as_mut_ptr(),
                &mut user_len,
                domain.as_mut_ptr(),
                &mut domain_len,
                password.as_mut_ptr(),
                &mut password_len,
            )
        };
        wipe(&mut password);
        if sized == 0 && last_error() != ERROR_INSUFFICIENT_BUFFER {
            return Outcome::error(format!(
                "cannot read the entered credential (code {})",
                last_error()
            ));
        }
        let mut user = vec![0u16; user_len.max(1) as usize];
        let mut domain = vec![0u16; domain_len.max(1) as usize];
        let mut password = vec![0u16; password_len.max(1) as usize];
        // SAFETY: as above, with the sizes the first call asked for.
        let ok = unsafe {
            CredUnPackAuthenticationBufferW(
                0,
                buffer,
                size,
                user.as_mut_ptr(),
                &mut user_len,
                domain.as_mut_ptr(),
                &mut domain_len,
                password.as_mut_ptr(),
                &mut password_len,
            )
        };
        let outcome = if ok == 0 {
            Outcome::error(format!(
                "cannot read the entered credential (code {})",
                last_error()
            ))
        } else {
            write(name, provider, &password)
        };
        wipe(&mut password);
        wipe(&mut user);
        wipe(&mut domain);
        outcome
    }

    /// Write the generic credential. The UTF-8 copy is sized up front so the secret
    /// is never left behind in a reallocated buffer.
    fn write(name: &str, provider: &str, password: &[u16]) -> Outcome {
        let end = password
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(password.len());
        let mut secret = Vec::with_capacity(3 * end);
        let mut scratch = [0u8; 4];
        for unit in char::decode_utf16(password[..end].iter().copied()) {
            let Ok(c) = unit else {
                wipe(&mut secret);
                return Outcome::error("the entered key is not valid text");
            };
            secret.extend_from_slice(c.encode_utf8(&mut scratch).as_bytes());
        }
        wipe(&mut scratch);
        let outcome = if secret.is_empty() {
            Outcome::error("nothing was entered in the Password field")
        } else if secret.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE {
            Outcome::error(format!(
                "the key exceeds the Credential Manager limit of {CRED_MAX_CREDENTIAL_BLOB_SIZE} bytes"
            ))
        } else {
            let (mut target, mut user) = (wide(&target(name)), wide(provider));
            let credential = CredentialW {
                flags: 0,
                kind: CRED_TYPE_GENERIC,
                target_name: target.as_mut_ptr(),
                comment: null_mut(),
                last_written: [0; 2],
                blob_size: secret.len() as u32,
                blob: secret.as_mut_ptr(),
                persist: CRED_PERSIST_LOCAL_MACHINE,
                attribute_count: 0,
                attributes: null_mut(),
                target_alias: null_mut(),
                user_name: user.as_mut_ptr(),
            };
            // SAFETY: the structure and every buffer it points to outlive the call.
            if unsafe { CredWriteW(&credential, 0) } != 0 {
                Outcome {
                    stored: true,
                    ..Outcome::default()
                }
            } else {
                Outcome::error(format!("CredWriteW failed with code {}", last_error()))
            }
        };
        wipe(&mut secret);
        outcome
    }

    /// Delete the generic credential; one that is already absent leaves the same
    /// state as a deleted one.
    pub fn remove(name: &str) -> Outcome {
        let target = wide(&target(name));
        // SAFETY: the target is a NUL-terminated UTF-16 string that outlives the call.
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok != 0 || last_error() == ERROR_NOT_FOUND {
            Outcome::default()
        } else {
            Outcome::error(format!("CredDeleteW failed with code {}", last_error()))
        }
    }
}

#[cfg(windows)]
pub use win::{prompt_and_store, remove};

#[cfg(not(windows))]
pub fn prompt_and_store(_owner: isize, _name: &str, _provider: &str, _attached: bool) -> Outcome {
    Outcome::error("credential prompt is available on Windows only")
}

#[cfg(not(windows))]
pub fn remove(_name: &str) -> Outcome {
    Outcome::error("credential prompt is available on Windows only")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_and_remove_messages_are_validated() {
        assert_eq!(
            parse(r#"{"kind":"store-credential","name":"planner-key.v2","provider":"anthropic"}"#),
            Ok(Request::Store {
                name: "planner-key.v2".into(),
                provider: "anthropic".into()
            })
        );
        assert_eq!(
            parse(r#"{"kind":"remove-credential","name":"k","provider":"ignored"}"#),
            Ok(Request::Remove { name: "k".into() })
        );
        for provider in ["openai", "gemini", "openclaw"] {
            assert!(
                parse(&format!(
                    r#"{{"kind":"store-credential","name":"a","provider":"{provider}"}}"#
                ))
                .is_ok()
            );
        }
    }

    #[test]
    fn bad_names_providers_and_kinds_are_refused_without_echo() {
        let long = "a".repeat(81);
        for name in ["", "a b", "a/b", "a\"b", "ä", "..\\x", long.as_str()] {
            let body =
                serde_json::json!({"kind": "store-credential", "name": name, "provider": "openai"});
            let reason = parse(&body.to_string()).unwrap_err();
            assert!(reason.starts_with("name must be"), "{name:?}: {reason}");
            assert!(name.is_empty() || !reason.contains(name));
        }
        assert!(parse(&serde_json::json!({"kind": "store-credential", "name": "a".repeat(80), "provider": "openai"}).to_string()).is_ok());
        for provider in ["", "Anthropic", "azure", "anthropic "] {
            let body =
                serde_json::json!({"kind": "store-credential", "name": "k", "provider": provider});
            assert!(
                parse(&body.to_string())
                    .unwrap_err()
                    .starts_with("provider must be")
            );
        }
        assert!(
            parse(r#"{"kind":"store-credential","name":"k"}"#)
                .unwrap_err()
                .starts_with("provider must be")
        );
        for body in [
            r#"{"kind":"read-credential","name":"k","provider":"openai"}"#,
            r#"{"name":"k","provider":"openai"}"#,
            r#"{"kind":7,"name":"k"}"#,
            "[]",
            "not json",
            "",
        ] {
            let reason = parse(body).unwrap_err();
            assert!(
                reason.starts_with("kind must be") || reason.ends_with("is not JSON"),
                "{body:?}: {reason}"
            );
            assert!(!reason.contains("read-credential"));
        }
    }

    #[test]
    fn target_and_prompt_text_name_the_credential() {
        assert_eq!(target("planner-key"), "ArcScience/planner-key");
        assert_eq!(
            caption("planner-key", "anthropic", false),
            "Arc Science — credential planner-key for anthropic"
        );
        assert_eq!(
            caption("planner-key", "openai", true),
            "Arc Science — credential planner-key for openai (diagnostic attach is on)"
        );
        let long = caption(&"n".repeat(80), "openclaw", true);
        assert_eq!(long.chars().count(), MAX_CAPTION - 1);
        assert!(long.ends_with(" for openclaw (diagnostic attach is on)"));
        assert!(long.contains("… for"));
        assert_eq!(
            caption(&"n".repeat(80), "openai", false).chars().count(),
            116
        );
        assert!(message("k").contains("ArcScience/k and never shows it again"));
        assert!(message("k").ends_with("The User name field is optional."));
    }

    #[test]
    fn wipe_zeroes_every_element() {
        let mut units = vec![0x41u16, 0x42, 0x43];
        let mut bytes = [7u8; 5];
        wipe(&mut units);
        wipe(&mut bytes);
        assert!(units.iter().all(|&u| u == 0) && bytes.iter().all(|&b| b == 0));
        assert_eq!(
            Outcome::error("x"),
            Outcome {
                stored: false,
                cancelled: false,
                error: Some("x".into())
            }
        );
    }
}
