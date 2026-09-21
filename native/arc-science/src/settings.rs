//! Operator settings, owned here: one typed schema, one validator, one writer.
//!
//! `settings.toml` sits beside `arc-science.toml`. The Python service reads it
//! through `settings show` and changes it only through `settings replace`, which
//! validates the whole document, checks the revision the caller saw, and replaces
//! the file atomically. Nothing in this file is a credential: seats name a
//! credential file or a CLI login, never a key.
use crate::Result;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub const SETTINGS_FILE: &str = "settings.toml";
pub const PROVIDERS: [&str; 4] = ["anthropic", "openai", "gemini", "openclaw"];
pub const EFFORTS: [&str; 6] = ["minimal", "low", "medium", "high", "xhigh", "max"];
pub const AUTH: [&str; 2] = ["api_key", "cli"];
pub const ROLES: [&str; 5] = ["planner", "reviewer", "falsifier", "vision", "prose"];
/// (provider, transport) -> the efforts that transport can express; the same table as
/// `exploration/effort.py` SUPPORTED. An empty list means no control: only "medium"
/// is accepted and the provider default applies.
pub const EFFORTS_BY_TRANSPORT: [(&str, &str, &[&str]); 7] = [
    (
        "anthropic",
        "api",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "anthropic",
        "cli",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    ("openai", "api", &EFFORTS),
    ("openai", "cli", &EFFORTS),
    ("gemini", "api", &["minimal", "low", "medium", "high"]),
    ("gemini", "cli", &[]),
    ("openclaw", "api", &[]),
];
/// Exit status of `settings replace` when the caller's revision is stale.
pub const STALE_REVISION_STATUS: i32 = 3;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub schema_version: u32,
    pub seats: Seats,
    pub providers: Providers,
    #[serde(default)]
    pub mcp_servers: Vec<McpServer>,
    #[serde(default)]
    pub acp_agents: Vec<AcpAgent>,
    pub prose: ProseSettings,
    pub blender: BlenderSettings,
    pub viewer: ViewerSettings,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Seats {
    pub planner: Seat,
    pub reviewer: Seat,
    pub falsifier: Seat,
    pub vision: Seat,
    pub prose: Seat,
}

/// One model seat: which provider answers, which model, how hard it thinks, and
/// how it authenticates (a credential file by name, or the operator's own CLI login).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Seat {
    /// One of PROVIDERS, or empty for an unconfigured seat.
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_effort")]
    pub effort: String,
    #[serde(default = "default_auth")]
    pub auth: String,
    /// Name of the credential file the service holds for this seat (never the key).
    #[serde(default)]
    pub credential: String,
}

fn default_effort() -> String {
    "medium".into()
}
fn default_auth() -> String {
    "api_key".into()
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Providers {
    pub anthropic: Provider,
    pub openai: Provider,
    pub gemini: Provider,
    pub openclaw: Provider,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Provider {
    /// HTTPS endpoint for the standard API route (loopback HTTP allowed for OpenClaw).
    #[serde(default)]
    pub endpoint: String,
    /// Executable name or path of the CLI that carries the operator's OAuth login.
    #[serde(default)]
    pub cli: String,
    /// OpenClaw only: the isolated, tool-less agent to address.
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub isolated: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpServer {
    pub name: String,
    /// "stdio" (a local command) or "http" (a URL).
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub url: String,
    /// Whether missions may send data to this server (it is egress for http, and
    /// a local process for stdio that may itself reach the network).
    #[serde(default)]
    pub consent: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AcpAgent {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Missions may send data to this agent (a consultation leaves the process).
    #[serde(default)]
    pub consent: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProseSettings {
    /// Third-party detection may run (each request still needs its own consent).
    pub detection: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BlenderSettings {
    pub default_preset: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ViewerSettings {
    pub representation: String,
    pub colouring: String,
    pub assembly: String,
    pub background: String,
}

impl Default for Settings {
    fn default() -> Self {
        let seat = |model: &str| Seat {
            provider: String::new(),
            model: model.into(),
            effort: "medium".into(),
            auth: "api_key".into(),
            credential: String::new(),
        };
        Self {
            schema_version: 1,
            seats: Seats {
                planner: seat(""),
                reviewer: seat(""),
                falsifier: seat(""),
                vision: seat(""),
                prose: seat(""),
            },
            providers: Providers {
                anthropic: Provider {
                    endpoint: "https://api.anthropic.com/v1/messages".into(),
                    cli: "claude".into(),
                    agent_id: String::new(),
                    isolated: false,
                },
                openai: Provider {
                    endpoint: "https://api.openai.com/v1/responses".into(),
                    cli: "codex".into(),
                    agent_id: String::new(),
                    isolated: false,
                },
                gemini: Provider {
                    endpoint: "https://generativelanguage.googleapis.com/v1beta".into(),
                    cli: "gemini".into(),
                    agent_id: String::new(),
                    isolated: false,
                },
                openclaw: Provider {
                    endpoint: String::new(),
                    cli: String::new(),
                    agent_id: String::new(),
                    isolated: true,
                },
            },
            mcp_servers: Vec::new(),
            acp_agents: Vec::new(),
            prose: ProseSettings { detection: true },
            blender: BlenderSettings {
                default_preset: "publication_white".into(),
            },
            viewer: ViewerSettings {
                representation: "cartoon".into(),
                colouring: "chain".into(),
                assembly: "asymmetric_unit".into(),
                background: "white".into(),
            },
        }
    }
}

fn identifier(value: &str, what: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(format!("{what} must be 1-80 characters of [A-Za-z0-9._-]").into());
    }
    Ok(())
}

fn https_or_loopback(value: &str, what: &str, loopback_http: bool) -> Result<()> {
    if value.chars().any(|c| c.is_whitespace() || c.is_control()) || value.contains('@') {
        return Err(format!("{what} must be a URL without spaces or credentials").into());
    }
    if value.starts_with("https://") && value.len() > 8 {
        return Ok(());
    }
    if loopback_http && is_loopback_http(value) {
        return Ok(());
    }
    Err(format!(
        "{what} must be an https URL{}",
        if loopback_http {
            " or a loopback http URL"
        } else {
            ""
        }
    )
    .into())
}

fn valid_port(port: &str) -> bool {
    port.parse::<u16>().is_ok_and(|p| p != 0)
}

/// `http://` with an authority that is exactly a loopback host (with an optional
/// port): `localhost.evil.example` or `127.0.0.1.evil.example` are not loopback.
fn is_loopback_http(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("http://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = if let Some(bracketed) = authority.strip_prefix('[') {
        // "[::1]" or "[::1]:port" and nothing else after the bracket.
        let Some((inside, after)) = bracketed.split_once(']') else {
            return false;
        };
        if !(after.is_empty() || after.strip_prefix(':').is_some_and(valid_port)) {
            return false;
        }
        inside
    } else {
        match authority.rsplit_once(':') {
            Some((h, port)) if valid_port(port) => h,
            Some(_) => return false,
            None => authority,
        }
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

impl Settings {
    /// Everything a document must satisfy to be written.
    pub fn validate(&self) -> Result<()> {
        self.validate_schema()?;
        self.validate_transports()
    }

    /// Shape and enumerations: what a file must satisfy to be read at all. A file
    /// written before a transport rule existed still loads; readiness reports the
    /// offending seat and the workbench refuses to save it unchanged.
    pub fn validate_schema(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err("Unsupported settings schema_version; expected 1".into());
        }
        for (role, seat) in [
            ("planner", &self.seats.planner),
            ("reviewer", &self.seats.reviewer),
            ("falsifier", &self.seats.falsifier),
            ("vision", &self.seats.vision),
            ("prose", &self.seats.prose),
        ] {
            if !seat.provider.is_empty() && !PROVIDERS.contains(&seat.provider.as_str()) {
                return Err(format!(
                    "seats.{role}.provider must be one of {}",
                    PROVIDERS.join(", ")
                )
                .into());
            }
            if !EFFORTS.contains(&seat.effort.as_str()) {
                return Err(
                    format!("seats.{role}.effort must be one of {}", EFFORTS.join(", ")).into(),
                );
            }
            if !AUTH.contains(&seat.auth.as_str()) {
                return Err(format!("seats.{role}.auth must be one of {}", AUTH.join(", ")).into());
            }
            if !seat.provider.is_empty() {
                if seat.model.is_empty()
                    || seat.model.len() > 120
                    || seat.model.chars().any(char::is_whitespace)
                {
                    return Err(format!(
                        "seats.{role}.model must name one model when a provider is set"
                    )
                    .into());
                }
                if seat.provider == "openclaw" && seat.auth == "cli" {
                    return Err(
                        format!("seats.{role}: OpenClaw has no CLI login; use api_key").into(),
                    );
                }
                if seat.auth == "api_key" && !seat.credential.is_empty() {
                    identifier(&seat.credential, &format!("seats.{role}.credential"))?;
                }
            }
        }
        self.validate_providers_and_connectors()
    }

    /// What each seat's transport can express: the effort levels it carries and the
    /// seats it can serve at all. Enforced when a document is written.
    pub fn validate_transports(&self) -> Result<()> {
        for (role, seat) in [
            ("planner", &self.seats.planner),
            ("reviewer", &self.seats.reviewer),
            ("falsifier", &self.seats.falsifier),
            ("vision", &self.seats.vision),
            ("prose", &self.seats.prose),
        ] {
            if !seat.provider.is_empty() {
                if role == "vision" && seat.auth == "cli" {
                    return Err(
                        "seats.vision.auth must be api_key: visual review is not available \
                                through a CLI login"
                            .into(),
                    );
                }
                let transport = if seat.auth == "cli" { "cli" } else { "api" };
                let login = if seat.auth == "cli" {
                    "cli login"
                } else {
                    "API credential"
                };
                let accepted = EFFORTS_BY_TRANSPORT
                    .iter()
                    .find(|(p, t, _)| *p == seat.provider && *t == transport)
                    .map(|(_, _, e)| *e)
                    .unwrap_or(&[]);
                if accepted.is_empty() && seat.effort != "medium" {
                    return Err(format!(
                        "seats.{role}.effort must stay medium: {} {login} has no effort control \
                         (the provider default applies)",
                        seat.provider
                    )
                    .into());
                }
                if !accepted.is_empty() && !accepted.contains(&seat.effort.as_str()) {
                    return Err(format!(
                        "seats.{role}.effort {} is not accepted for {} {login}; accepted: {}",
                        seat.effort,
                        seat.provider,
                        accepted.join(", ")
                    )
                    .into());
                }
            }
        }
        Ok(())
    }

    fn validate_providers_and_connectors(&self) -> Result<()> {
        for (name, provider) in [
            ("anthropic", &self.providers.anthropic),
            ("openai", &self.providers.openai),
            ("gemini", &self.providers.gemini),
            ("openclaw", &self.providers.openclaw),
        ] {
            if !provider.endpoint.is_empty() {
                https_or_loopback(
                    &provider.endpoint,
                    &format!("providers.{name}.endpoint"),
                    name == "openclaw",
                )?;
            }
            if provider.cli.contains('\0') || provider.cli.len() > 512 {
                return Err(format!("providers.{name}.cli must name one executable").into());
            }
            if name == "openclaw" && !provider.agent_id.is_empty() {
                identifier(&provider.agent_id, "providers.openclaw.agent_id")?;
            }
            if name != "openclaw" && !provider.agent_id.is_empty() {
                return Err(format!("providers.{name}.agent_id applies to OpenClaw only").into());
            }
        }
        let openclaw_seats = [
            &self.seats.planner,
            &self.seats.reviewer,
            &self.seats.falsifier,
            &self.seats.vision,
            &self.seats.prose,
        ]
        .into_iter()
        .any(|seat| seat.provider == "openclaw");
        if openclaw_seats && !self.providers.openclaw.isolated {
            return Err("OpenClaw seats require providers.openclaw.isolated = true".into());
        }
        let mut names = std::collections::BTreeSet::new();
        for server in &self.mcp_servers {
            identifier(&server.name, "mcp_servers[].name")?;
            if !names.insert(server.name.clone()) {
                return Err(format!("mcp_servers: duplicate name {}", server.name).into());
            }
            match server.transport.as_str() {
                "stdio" => {
                    if server.command.is_empty() || server.command.contains('\0') {
                        return Err(
                            format!("mcp_servers[{}]: stdio needs a command", server.name).into(),
                        );
                    }
                    if !server.url.is_empty() {
                        return Err(
                            format!("mcp_servers[{}]: stdio has no url", server.name).into()
                        );
                    }
                }
                "http" => {
                    https_or_loopback(
                        &server.url,
                        &format!("mcp_servers[{}].url", server.name),
                        true,
                    )?;
                    if !server.command.is_empty() {
                        return Err(
                            format!("mcp_servers[{}]: http has no command", server.name).into()
                        );
                    }
                }
                _ => {
                    return Err(format!(
                        "mcp_servers[{}].transport must be stdio or http",
                        server.name
                    )
                    .into());
                }
            }
            if server.args.len() > 64
                || server
                    .args
                    .iter()
                    .any(|a| a.contains('\0') || a.len() > 1024)
            {
                return Err(
                    format!("mcp_servers[{}]: too many or invalid args", server.name).into(),
                );
            }
        }
        let mut agents = std::collections::BTreeSet::new();
        for agent in &self.acp_agents {
            identifier(&agent.name, "acp_agents[].name")?;
            if !agents.insert(agent.name.clone()) {
                return Err(format!("acp_agents: duplicate name {}", agent.name).into());
            }
            if agent.command.is_empty() || agent.command.contains('\0') {
                return Err(format!("acp_agents[{}]: command required", agent.name).into());
            }
            if agent.args.len() > 64
                || agent
                    .args
                    .iter()
                    .any(|a| a.contains('\0') || a.len() > 1024)
            {
                return Err(format!("acp_agents[{}]: too many or invalid args", agent.name).into());
            }
        }
        identifier(&self.blender.default_preset, "blender.default_preset")?;
        for (name, value) in [
            ("representation", &self.viewer.representation),
            ("colouring", &self.viewer.colouring),
            ("assembly", &self.viewer.assembly),
            ("background", &self.viewer.background),
        ] {
            identifier(value, &format!("viewer.{name}"))?;
        }
        Ok(())
    }

    /// Read the file, creating the default when it does not exist yet.
    pub fn load_or_create(project: &Path) -> Result<(Self, Vec<u8>)> {
        let path = project.join(SETTINGS_FILE);
        if !path.exists() {
            let content = toml::to_string_pretty(&Settings::default())?;
            write_atomically(project, content.as_bytes())?;
        }
        let bytes = fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let text = String::from_utf8(bytes.clone()).map_err(|_| "settings.toml is not UTF-8")?;
        let settings: Settings = toml::from_str(&text)?;
        settings.validate_schema()?;
        Ok((settings, bytes))
    }

    /// Validate a whole replacement document and write it if the caller saw the
    /// current revision. Returns the new snapshot. The read, the check and the
    /// write happen under a lock file, so two concurrent replacements cannot both
    /// pass the check on one revision.
    pub fn replace(
        project: &Path,
        document: &str,
        if_revision: Option<&str>,
    ) -> Result<(Self, Vec<u8>)> {
        let _lock = Lock::acquire(project)?;
        let (_, current) = Self::load_or_create(project)?;
        if let Some(expected) = if_revision
            && expected != revision(&current)
        {
            return Err(StaleRevision.into());
        }
        let settings: Settings = serde_json::from_str(document)
            .or_else(|_| toml::from_str::<Settings>(document))
            .map_err(|e| {
                format!("settings document is neither valid JSON nor TOML for the schema: {e}")
            })?;
        settings.validate()?;
        let content = toml::to_string_pretty(&settings)?;
        write_atomically(project, content.as_bytes())?;
        Ok((settings, content.into_bytes()))
    }
}

/// An exclusive-create lock file beside the settings; removed on drop. A lock older
/// than 30 s belongs to a dead process and is taken over.
struct Lock(std::path::PathBuf);

impl Lock {
    fn acquire(project: &Path) -> Result<Self> {
        let path = project.join(format!("{SETTINGS_FILE}.lock"));
        let started = std::time::Instant::now();
        loop {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    use std::io::Write;
                    let _ = write!(file, "{}", std::process::id());
                    return Ok(Self(path));
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if let Ok(meta) = fs::metadata(&path)
                        && meta
                            .modified()
                            .ok()
                            .and_then(|m| m.elapsed().ok())
                            .is_some_and(|age| age.as_secs() > 30)
                    {
                        let _ = fs::remove_file(&path);
                        continue;
                    }
                    if started.elapsed() > std::time::Duration::from_secs(5) {
                        return Err("settings are locked by another change; try again".into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(15));
                }
                Err(e) => return Err(format!("Cannot lock settings: {e}").into()),
            }
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[derive(Debug)]
pub struct StaleRevision;

impl std::fmt::Display for StaleRevision {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("settings changed since they were read; reload and try again")
    }
}

impl std::error::Error for StaleRevision {}

fn write_atomically(project: &Path, content: &[u8]) -> Result<()> {
    let path = project.join(SETTINGS_FILE);
    let temporary = project.join(format!("{SETTINGS_FILE}.{}.tmp", std::process::id()));
    fs::write(&temporary, content)?;
    fs::rename(&temporary, &path).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        format!("Cannot replace {}: {e}", path.display())
    })?;
    Ok(())
}

/// The revision the service echoes back: SHA-256 of the file bytes, so the Python
/// side can compute the same value from the same bytes.
pub fn revision(bytes: &[u8]) -> String {
    sha256_hex(bytes)
}

/// SHA-256 (FIPS 180-4), written out so no crate is needed for one digest.
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = data.to_vec();
    let bit_length = (data.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());
    for block in message.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }
    h.iter().map(|word| format!("{word:08x}")).collect()
}

/// The JSON snapshot the service consumes.
pub fn snapshot(settings: &Settings, bytes: &[u8], project: &Path) -> serde_json::Value {
    serde_json::json!({
        "settings": settings,
        "revision": revision(bytes),
        "path": project.join(SETTINGS_FILE).display().to_string(),
        "schema": {
            "providers": PROVIDERS,
            "efforts": EFFORTS,
            "auth": AUTH,
            "roles": ROLES,
            "efforts_by_transport": EFFORTS_BY_TRANSPORT
                .iter()
                .map(|(p, t, e)| (format!("{p}:{t}"), serde_json::json!(e)))
                .collect::<serde_json::Map<_, _>>(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_the_reference_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn defaults_validate_and_round_trip_through_toml() {
        let settings = Settings::default();
        settings.validate().unwrap();
        let text = toml::to_string_pretty(&settings).unwrap();
        let back: Settings = toml::from_str(&text).unwrap();
        assert_eq!(back, settings);
    }

    #[test]
    fn validation_rejects_what_the_schema_forbids() {
        let mut s = Settings::default();
        s.seats.planner.provider = "anthropic".into();
        assert!(
            s.validate()
                .unwrap_err()
                .to_string()
                .contains("seats.planner.model")
        );
        s.seats.planner.model = "claude-opus-5".into();
        s.seats.planner.effort = "turbo".into();
        assert!(s.validate().unwrap_err().to_string().contains("effort"));
        s.seats.planner.effort = "high".into();
        s.validate().unwrap();
        s.seats.vision.provider = "openclaw".into();
        s.seats.vision.model = "x".into();
        s.seats.vision.auth = "cli".into();
        assert!(
            s.validate()
                .unwrap_err()
                .to_string()
                .contains("no CLI login")
        );
        s.seats.vision.auth = "api_key".into();
        s.providers.openclaw.isolated = false;
        assert!(
            s.validate().unwrap_err().to_string().contains("isolated"),
            "every OpenClaw seat needs isolation, not only the planner"
        );
        s.providers.openclaw.isolated = true;
        s.providers.openai.endpoint = "http://example.com".into();
        assert!(s.validate().unwrap_err().to_string().contains("https"));
        s.providers.openai.endpoint = "https://api.openai.com/v1/responses".into();
        s.mcp_servers.push(McpServer {
            name: "tools".into(),
            transport: "http".into(),
            command: String::new(),
            args: vec![],
            url: "http://127.0.0.1:9000/mcp".into(),
            consent: false,
            enabled: true,
        });
        s.validate().unwrap();
        for deceptive in [
            "http://localhost.evil.example/mcp",
            "http://127.0.0.1.evil.example/",
            "http://localhost@evil/",
            "http://[::1]x/",
        ] {
            s.mcp_servers[0].url = deceptive.into();
            assert!(
                s.validate().is_err(),
                "{deceptive} must not pass as loopback"
            );
        }
        for bad_port in [
            "http://127.0.0.1:/",
            "http://127.0.0.1:0/",
            "http://127.0.0.1:70000/",
            "http://localhost:x/",
        ] {
            s.mcp_servers[0].url = bad_port.into();
            assert!(s.validate().is_err(), "{bad_port} must not pass");
        }
        for genuine in [
            "http://localhost:9000/mcp",
            "http://[::1]:9000/",
            "http://127.0.0.1/",
        ] {
            s.mcp_servers[0].url = genuine.into();
            s.validate().unwrap();
        }
        s.mcp_servers[0].url = "http://127.0.0.1:9000/mcp".into();
        s.mcp_servers.push(s.mcp_servers[0].clone());
        assert!(s.validate().unwrap_err().to_string().contains("duplicate"));
        s.mcp_servers.pop();
        s.mcp_servers[0].transport = "stdio".into();
        assert!(
            s.validate()
                .unwrap_err()
                .to_string()
                .contains("needs a command")
        );
    }

    #[test]
    fn effort_is_checked_per_provider_and_transport() {
        let mut s = Settings::default();
        s.seats.planner.model = "m".into();
        for (provider, auth, effort, expected) in [
            (
                "gemini",
                "cli",
                "high",
                "seats.planner.effort must stay medium: gemini cli login has no effort control \
                 (the provider default applies)",
            ),
            (
                "openclaw",
                "api_key",
                "low",
                "seats.planner.effort must stay medium: openclaw API credential has no effort \
                 control (the provider default applies)",
            ),
            (
                "anthropic",
                "api_key",
                "minimal",
                "seats.planner.effort minimal is not accepted for anthropic API credential; \
                 accepted: low, medium, high, xhigh, max",
            ),
            (
                "gemini",
                "api_key",
                "max",
                "seats.planner.effort max is not accepted for gemini API credential; accepted: \
                 minimal, low, medium, high",
            ),
        ] {
            s.seats.planner.provider = provider.into();
            s.seats.planner.auth = auth.into();
            s.seats.planner.effort = effort.into();
            assert_eq!(s.validate().unwrap_err().to_string(), expected);
        }
        for (provider, auth, effort) in [
            ("gemini", "cli", "medium"),
            ("openclaw", "api_key", "medium"),
            ("anthropic", "api_key", "xhigh"),
            ("openai", "cli", "minimal"),
            ("gemini", "api_key", "minimal"),
        ] {
            s.seats.planner.provider = provider.into();
            s.seats.planner.auth = auth.into();
            s.seats.planner.effort = effort.into();
            s.validate()
                .unwrap_or_else(|e| panic!("{provider} {auth} {effort}: {e}"));
        }
        // An unconfigured seat only needs a known effort word.
        s.seats.planner.provider = String::new();
        s.seats.planner.effort = "max".into();
        s.validate().unwrap();
        s.seats.planner.effort = "turbo".into();
        assert!(s.validate().is_err());
    }

    #[test]
    fn schema_lists_efforts_by_transport() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, bytes) = Settings::load_or_create(dir.path()).unwrap();
        let schema = snapshot(&settings, &bytes, dir.path())["schema"].clone();
        let table = schema["efforts_by_transport"].as_object().unwrap();
        let keys: Vec<_> = table.keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            [
                "anthropic:api",
                "anthropic:cli",
                "gemini:api",
                "gemini:cli",
                "openai:api",
                "openai:cli",
                "openclaw:api",
            ]
        );
        assert_eq!(table["gemini:cli"], serde_json::json!([]));
        assert_eq!(
            table["anthropic:api"],
            serde_json::json!(["low", "medium", "high", "xhigh", "max"])
        );
        assert_eq!(table["openai:api"], serde_json::json!(EFFORTS));
    }

    #[test]
    fn concurrent_replacements_on_one_revision_let_exactly_one_through() {
        let dir = tempfile::tempdir().unwrap();
        let (base, bytes) = Settings::load_or_create(dir.path()).unwrap();
        let seen = revision(&bytes);
        let handles: Vec<_> = (0..6)
            .map(|i| {
                let (project, seen, mut doc) =
                    (dir.path().to_path_buf(), seen.clone(), base.clone());
                std::thread::spawn(move || {
                    doc.blender.default_preset = format!("preset_{i}");
                    Settings::replace(&project, &serde_json::to_string(&doc).unwrap(), Some(&seen))
                        .is_ok()
                })
            })
            .collect();
        let successes = handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|ok| *ok)
            .count();
        assert_eq!(
            successes, 1,
            "one writer wins, the rest see a stale revision"
        );
        assert!(!dir.path().join("settings.toml.lock").exists());
    }

    #[test]
    fn replace_checks_the_revision_and_writes_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let (first, bytes) = Settings::load_or_create(dir.path()).unwrap();
        assert_eq!(first, Settings::default());
        let stale = revision(b"something else");
        let mut edited = first.clone();
        edited.seats.planner.provider = "openai".into();
        edited.seats.planner.model = "gpt-5.6".into();
        let document = serde_json::to_string(&edited).unwrap();
        let error = Settings::replace(dir.path(), &document, Some(&stale)).unwrap_err();
        assert!(error.downcast_ref::<StaleRevision>().is_some());
        let (written, new_bytes) =
            Settings::replace(dir.path(), &document, Some(&revision(&bytes))).unwrap();
        assert_eq!(written.seats.planner.model, "gpt-5.6");
        assert_ne!(revision(&new_bytes), revision(&bytes));
        assert_eq!(Settings::load_or_create(dir.path()).unwrap().0, written);
        assert!(!dir.path().join("settings.toml.tmp").exists());
        // An invalid document changes nothing.
        let bad = document.replace("\"gpt-5.6\"", "\"\"");
        assert!(Settings::replace(dir.path(), &bad, None).is_err());
        assert_eq!(Settings::load_or_create(dir.path()).unwrap().0, written);
    }

    #[test]
    fn a_file_written_before_a_transport_rule_still_loads_but_cannot_be_saved_unchanged() {
        // gemini + cli + high predates the per-transport effort rule: the owner reads it
        // (readiness reports the seat) and refuses to write it back until it is fixed.
        let dir = tempfile::tempdir().unwrap();
        let mut old = Settings::default();
        old.seats.planner.provider = "gemini".into();
        old.seats.planner.model = "gemini-2.5-pro".into();
        old.seats.planner.auth = "cli".into();
        old.seats.planner.effort = "high".into();
        let content = toml::to_string_pretty(&old).unwrap();
        write_atomically(dir.path(), content.as_bytes()).unwrap();
        let (loaded, bytes) = Settings::load_or_create(dir.path()).unwrap();
        assert_eq!(loaded, old);
        let document = serde_json::to_string(&loaded).unwrap();
        let error = Settings::replace(dir.path(), &document, Some(&revision(&bytes))).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("seats.planner.effort must stay medium")
        );
        let mut fixed = loaded.clone();
        fixed.seats.planner.effort = "medium".into();
        Settings::replace(
            dir.path(),
            &serde_json::to_string(&fixed).unwrap(),
            Some(&revision(&bytes)),
        )
        .unwrap();
        // A vision seat over a CLI login is refused on write, as the service refuses it at run time.
        let mut vision = Settings::default();
        vision.seats.vision.provider = "anthropic".into();
        vision.seats.vision.model = "claude-opus-5".into();
        vision.seats.vision.auth = "cli".into();
        assert!(vision.validate_schema().is_ok());
        assert!(
            vision
                .validate()
                .unwrap_err()
                .to_string()
                .contains("seats.vision.auth must be api_key")
        );
    }
}
