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
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Worker {
    pub python: String,
    pub data: PathBuf,
    pub host: String,
    pub port: u16,
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
                python: "python3".into(),
                data: "data".into(),
                host: "127.0.0.1".into(),
                port: 8080,
            },
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

pub fn initialize(project: &Path) -> Result<()> {
    let path = project.join(CONFIG_FILE);
    let content = toml::to_string_pretty(&Config::default())?;
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
        Ok(config)
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
        if self.worker.python.trim().is_empty() || self.worker.python.contains('\0') {
            return Err("worker.python must name one executable, not a command line".into());
        }
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
