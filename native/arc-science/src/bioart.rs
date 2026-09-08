use clap::{Subcommand, ValueEnum};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    str::FromStr,
};

#[derive(Clone, Copy, Debug)]
pub struct BioArtId(u64);

impl FromStr for BioArtId {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let value = value
            .parse::<u64>()
            .map_err(|_| "BioArt IDs must be positive integers below 2^53".to_string())?;
        if value == 0 || value >= (1_u64 << 53) {
            return Err("BioArt IDs must be positive integers below 2^53".into());
        }
        Ok(Self(value))
    }
}

#[derive(Debug, Subcommand)]
pub enum BioArtCommand {
    /// Search cached metadata or an explicit offline browser DOM snapshot.
    Search {
        query: String,
        #[arg(long, conflicts_with = "allow_egress")]
        search_html: Option<PathBuf>,
        #[arg(long)]
        allow_egress: bool,
    },
    /// Inspect one entry's source-derived metadata.
    Inspect {
        entry_id: BioArtId,
        #[arg(long)]
        allow_egress: bool,
    },
    /// Fetch one immutable entry-bound file; SVG is the default.
    Fetch {
        entry_id: BioArtId,
        #[arg(long)]
        representation: Option<BioArtId>,
        #[arg(long, value_enum, default_value = "SVG")]
        format: BioArtFormat,
        #[arg(long)]
        allow_egress: bool,
    },
    /// Verify a cached receipt and immutable source bytes; never uses egress.
    Verify { receipt: PathBuf },
    /// Import a verified receipt into the selected project; never uses egress.
    Import { receipt: PathBuf },
}

#[derive(Clone, Debug, ValueEnum)]
pub enum BioArtFormat {
    #[value(name = "svg")]
    SvgLower,
    #[value(name = "png")]
    PngLower,
    #[value(name = "ai")]
    AiLower,
    #[value(name = "eps")]
    EpsLower,
    #[value(name = "SVG")]
    SvgUpper,
    #[value(name = "PNG")]
    PngUpper,
    #[value(name = "AI")]
    AiUpper,
    #[value(name = "EPS")]
    EpsUpper,
}

impl BioArtFormat {
    fn as_str(&self) -> &'static str {
        match self {
            Self::SvgLower => "svg",
            Self::PngLower => "png",
            Self::AiLower => "ai",
            Self::EpsLower => "eps",
            Self::SvgUpper => "SVG",
            Self::PngUpper => "PNG",
            Self::AiUpper => "AI",
            Self::EpsUpper => "EPS",
        }
    }
}

pub fn arguments(command: BioArtCommand, project: &Path) -> Vec<OsString> {
    let mut args = vec!["bioart".into()];
    match command {
        BioArtCommand::Search {
            query,
            search_html,
            allow_egress,
        } => {
            args.push("search".into());
            project_arg(&mut args, project);
            if let Some(path) = search_html {
                path_option(&mut args, "--search-html=", &path);
            }
            if allow_egress {
                args.push("--allow-egress".into());
            }
            positional(&mut args, query.into());
        }
        BioArtCommand::Inspect {
            entry_id,
            allow_egress,
        } => {
            args.push("inspect".into());
            project_arg(&mut args, project);
            if allow_egress {
                args.push("--allow-egress".into());
            }
            positional(&mut args, entry_id.0.to_string().into());
        }
        BioArtCommand::Fetch {
            entry_id,
            representation,
            format,
            allow_egress,
        } => {
            args.push("fetch".into());
            project_arg(&mut args, project);
            if allow_egress {
                args.push("--allow-egress".into());
            }
            if let Some(representation) = representation {
                args.extend([
                    "--representation".into(),
                    representation.0.to_string().into(),
                ]);
            }
            args.extend(["--format".into(), format.as_str().into()]);
            positional(&mut args, entry_id.0.to_string().into());
        }
        BioArtCommand::Verify { receipt } => {
            args.push("verify".into());
            project_arg(&mut args, project);
            positional(&mut args, receipt.into_os_string());
        }
        BioArtCommand::Import { receipt } => {
            args.push("import".into());
            project_arg(&mut args, project);
            positional(&mut args, receipt.into_os_string());
        }
    }
    args
}

fn project_arg(args: &mut Vec<OsString>, project: &Path) {
    args.extend(["--project".into(), project.as_os_str().to_owned()]);
}

fn path_option(args: &mut Vec<OsString>, name: &str, value: &Path) {
    let mut option = OsString::from(name);
    option.push(value);
    args.push(option);
}

fn positional(args: &mut Vec<OsString>, value: OsString) {
    args.extend(["--".into(), value]);
}
