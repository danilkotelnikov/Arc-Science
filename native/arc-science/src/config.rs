use crate::Result;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    net::IpAddr,
    path::{Component, Path, PathBuf},
};

pub const CONFIG_FILE: &str = "arc-science.toml";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub schema_version: u32,
    pub worker: Worker,
    pub bioart: BioArt,
    /// Native components the worker uses when present; each is optional and the
    /// service degrades explicitly without it.
    #[serde(default)]
    pub components: Components,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Worker {
    pub python: String,
    pub data: PathBuf,
    pub host: String,
    pub port: u16,
    /// Directory that holds the `arc_science` package (put on PYTHONPATH); None means
    /// the interpreter already has it installed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_path: Option<PathBuf>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Components {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_worker: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub svg2png: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blender_python: Option<PathBuf>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BioArt {
    pub cache_dir: PathBuf,
    pub max_metadata_bytes: u64,
    pub max_file_bytes: u64,
    pub max_cache_bytes: u64,
    pub metadata_ttl_seconds: u64,
    pub timeout_seconds: u64,
    pub max_retries: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: 1,
            worker: Worker {
                python: if cfg!(windows) { "python" } else { "python3" }.into(),
                data: "data".into(),
                host: "127.0.0.1".into(),
                port: 8080,
                package_path: None,
            },
            components: Components::default(),
            bioart: BioArt {
                cache_dir: ".arc-science/bioart".into(),
                max_metadata_bytes: 8 * 1024 * 1024,
                max_file_bytes: 32 * 1024 * 1024,
                max_cache_bytes: 256 * 1024 * 1024,
                metadata_ttl_seconds: 86400,
                timeout_seconds: 30,
                max_retries: 2,
            },
        }
    }
}

pub fn project_root(project: &Path) -> Result<PathBuf> {
    let root = project
        .canonicalize()
        .map_err(|e| format!("Cannot open project {}: {e}", project.display()))?;
    if !root.is_dir() {
        return Err("Project must be an existing directory".into());
    }
    Ok(root)
}

pub fn initialize(project: &Path, python: Option<&str>) -> Result<()> {
    write_new(project, python, None)
}

/// Initialise from what discovery found; `python` still wins when given.
pub fn initialize_discovered(
    project: &Path,
    python: Option<&str>,
    discovered: &crate::discover::Discovery,
) -> Result<()> {
    write_new(project, python, Some(discovered))
}

fn write_new(
    project: &Path,
    python: Option<&str>,
    discovered: Option<&crate::discover::Discovery>,
) -> Result<()> {
    let path = project.join(CONFIG_FILE);
    let mut config = Config::default();
    if let Some(found) = discovered {
        if let Some(interpreter) = &found.python {
            config.worker.python = interpreter
                .to_str()
                .ok_or("Python path must be Unicode")?
                .into();
        }
        config.worker.package_path = found.package_path.clone();
        config.components.memory_worker = found.memory_worker.clone();
        config.components.svg2png = found.svg2png.clone();
    }
    if let Some(python) = python {
        config.worker.python = python.into();
    }
    config.validate()?;
    let content = toml::to_string_pretty(&config)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| {
            format!(
                "Cannot initialize {} (never overwritten): {e}",
                path.display()
            )
        })?;
    file.write_all(content.as_bytes())?;
    Ok(())
}

/// Fill the fields a discovery can fill and that the file leaves empty; the file is
/// rewritten atomically and every other field stays as written.
pub fn apply_discovery(
    project: &Path,
    found: &crate::discover::Discovery,
) -> Result<Vec<&'static str>> {
    let path = project.join(CONFIG_FILE);
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {}: {e}; run init first", path.display()))?;
    let mut config: Config = toml::from_str(&content)?;
    let mut filled = Vec::new();
    if config.worker.package_path.is_none() && found.package_path.is_some() {
        config.worker.package_path = found.package_path.clone();
        filled.push("worker.package_path");
    }
    if config.components.memory_worker.is_none() && found.memory_worker.is_some() {
        config.components.memory_worker = found.memory_worker.clone();
        filled.push("components.memory_worker");
    }
    if config.components.svg2png.is_none() && found.svg2png.is_some() {
        config.components.svg2png = found.svg2png.clone();
        filled.push("components.svg2png");
    }
    if Path::new(&config.worker.python).components().count() == 1
        && let Some(python) = &found.python
    {
        // A bare name such as "python" depends on the caller's PATH; the discovered
        // interpreter is the one the probe actually ran.
        config.worker.python = python.to_str().ok_or("Python path must be Unicode")?.into();
        filled.push("worker.python");
    }
    if filled.is_empty() {
        return Ok(filled);
    }
    config.validate()?;
    let temporary = project.join(format!("{CONFIG_FILE}.{}.tmp", std::process::id()));
    fs::write(&temporary, toml::to_string_pretty(&config)?)?;
    fs::rename(&temporary, &path).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        format!("Cannot replace {}: {e}", path.display())
    })?;
    Ok(filled)
}

impl Config {
    pub fn load(project: &Path) -> Result<Self> {
        let path = project.join(CONFIG_FILE);
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Cannot read {}: {e}; run init first", path.display()))?;
        let mut config: Self = toml::from_str(&content)?;
        config.validate()?;
        config.worker.data = project_path(project, &config.worker.data)?;
        config.bioart.cache_dir = project_path(project, &config.bioart.cache_dir)?;
        if config.bioart.cache_dir == project || !config.bioart.cache_dir.starts_with(project) {
            return Err("BioArt cache must be a strict descendant of the project".into());
        }
        // Do not canonicalize the cache into acceptance: the provider uses no-follow IO.
        let mut cursor = project.to_path_buf();
        for part in config.bioart.cache_dir.strip_prefix(project)?.components() {
            cursor.push(part);
            match fs::symlink_metadata(&cursor) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                    return Err("BioArt cache components must be directories, not symlinks".into());
                }
                Ok(_) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        let python = Path::new(&config.worker.python);
        if !python.is_absolute() && python.components().count() > 1 {
            config.worker.python = project_path(project, python)?
                .to_str()
                .ok_or("Python path must be Unicode")?
                .into();
        }
        if let Some(package) = &config.worker.package_path {
            let resolved = project_path(project, package)?;
            if !crate::discover::is_package_root(&resolved) {
                return Err(format!(
                    "worker.package_path {} does not contain arc_science/__init__.py",
                    resolved.display()
                )
                .into());
            }
            config.worker.package_path = Some(resolved);
        }
        for (name, slot) in [
            ("memory_worker", &mut config.components.memory_worker),
            ("svg2png", &mut config.components.svg2png),
            ("blender_python", &mut config.components.blender_python),
        ] {
            if let Some(path) = slot.take() {
                let resolved = project_path(project, &path)?;
                if !resolved.is_file() {
                    return Err(
                        format!("components.{name} {} is not a file", resolved.display()).into(),
                    );
                }
                *slot = Some(resolved);
            }
        }
        Ok(config)
    }

    /// The environment the worker receives from its configuration: the package on
    /// PYTHONPATH, UTF-8 everywhere, and each configured native component. Values
    /// already in the process environment are only used when nothing is configured.
    pub fn worker_environment(&self) -> Vec<(&'static str, std::ffi::OsString)> {
        let mut out = vec![("PYTHONUTF8", std::ffi::OsString::from("1"))];
        if let Some(package) = &self.worker.package_path {
            out.push(("PYTHONPATH", package.clone().into_os_string()));
        }
        for (key, value) in [
            ("ARC_MEMORY_WORKER", &self.components.memory_worker),
            ("ARC_SVG2PNG", &self.components.svg2png),
            (
                "ARC_MOLECULAR_BLENDER_PYTHON",
                &self.components.blender_python,
            ),
        ] {
            if let Some(path) = value {
                out.push((key, path.clone().into_os_string()));
            }
        }
        out
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err("Unsupported schema_version; expected 1".into());
        }
        if self.worker.port == 0 {
            return Err("worker.port must be 1..65535".into());
        }
        let ip: IpAddr = self
            .worker
            .host
            .parse()
            .map_err(|_| "worker.host must be a numeric loopback IP (127.0.0.1 or ::1)")?;
        if !ip.is_loopback() {
            return Err("worker.host must be loopback".into());
        }
        validate_python(&self.worker.python)?;
        for (name, value, minimum, maximum) in [
            (
                "max_metadata_bytes",
                self.bioart.max_metadata_bytes,
                1,
                64 * 1024 * 1024,
            ),
            (
                "max_file_bytes",
                self.bioart.max_file_bytes,
                1,
                128 * 1024 * 1024,
            ),
            (
                "max_cache_bytes",
                self.bioart.max_cache_bytes,
                1,
                4 * 1024 * 1024 * 1024,
            ),
            (
                "metadata_ttl_seconds",
                self.bioart.metadata_ttl_seconds,
                1,
                604800,
            ),
            ("timeout_seconds", self.bioart.timeout_seconds, 1, 120),
            ("max_retries", self.bioart.max_retries, 0, 2),
        ] {
            if !(minimum..=maximum).contains(&value) {
                return Err(format!("Invalid bioart.{name}: expected {minimum}..{maximum}").into());
            }
        }
        Ok(())
    }
}

fn validate_python(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.contains('\0') {
        return Err("worker.python must name one executable, not a command line".into());
    }
    let path = Path::new(value);
    if value.chars().last().is_some_and(std::path::is_separator)
        || value.rsplit(std::path::is_separator).next() == Some(".")
        || path.file_name().is_none()
    {
        return Err("worker.python must name one executable, not a directory".into());
    }
    if !path.is_absolute() && path.components().count() > 1 {
        project_path(Path::new("."), path)?;
    }
    Ok(())
}

fn project_path(project: &Path, path: &Path) -> Result<PathBuf> {
    if path.as_os_str().is_empty()
        || path.to_string_lossy().contains('\0')
        || path.components().any(|p| matches!(p, Component::ParentDir))
    {
        return Err("Paths must be nonempty and cannot contain NUL or parent traversal".into());
    }
    // Reject Windows drive-relative and root-relative paths instead of inheriting drive state.
    if path.has_root() && !path.is_absolute()
        || matches!(path.components().next(), Some(Component::Prefix(_))) && !path.is_absolute()
    {
        return Err("Paths must be absolute or project-relative".into());
    }
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        project.join(path)
    };
    Ok(joined
        .components()
        .filter(|p| !matches!(p, Component::CurDir))
        .collect())
}
