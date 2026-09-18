use arc_science_native::bioart;
use arc_science_native::{
    Result,
    bioart::BioArtCommand,
    config::{self, Config},
    process,
};
use clap::{Parser, Subcommand};
use std::{ffi::OsString, path::PathBuf};

#[derive(Parser)]
#[command(
    version,
    about = "Native configuration and process supervisor for the existing Arc Science Python worker"
)]
struct Cli {
    #[arg(long, global = true, default_value = ".")]
    project: PathBuf,
    #[command(subcommand)]
    command: Action,
}

#[derive(Subcommand)]
enum Action {
    /// Create a default arc-science.toml; refuses to overwrite.
    Init {
        /// Python executable or venv interpreter path; it is not run during init.
        #[arg(long)]
        python: Option<String>,
    },
    /// Validate and print configuration with resolved project paths.
    Config,
    /// Report local executable availability, not scientific qualification; no network.
    Doctor,
    /// Start the configured loopback Python service (stdin EOF).
    Serve {
        /// Opt in to parent-owned lifetime: stdin EOF cancels the worker tree.
        #[arg(long)]
        parent_stdin: bool,
    },
    /// Run a noninteractive Python CLI command; put all worker arguments after --.
    Worker {
        #[arg(last = true, required = true)]
        args: Vec<OsString>,
    },
    /// Use the existing Python BioArt provider through typed native commands.
    Bioart {
        #[command(subcommand)]
        command: BioArtCommand,
    },
}

fn run() -> Result<i32> {
    let cli = Cli::parse();
    let project = config::project_root(&cli.project)?;
    match cli.command {
        Action::Init { python } => {
            config::initialize(&project, python.as_deref())?;
            println!("Created {}", project.join(config::CONFIG_FILE).display());
        }
        Action::Config => println!("{}", toml::to_string_pretty(&Config::load(&project)?)?),
        Action::Doctor => return process::doctor(&Config::load(&project)?, &project),
        Action::Serve { parent_stdin } => {
            let config = Config::load(&project)?;
            return process::serve(
                &config,
                &project,
                &[
                    "serve".into(),
                    "--host".into(),
                    config.worker.host.clone().into(),
                    "--port".into(),
                    config.worker.port.to_string().into(),
                    "--data".into(),
                    config.worker.data.clone().into_os_string(),
                ],
                parent_stdin,
            );
        }
        Action::Worker { args } => return process::run(&Config::load(&project)?, &project, &args),
        Action::Bioart { command } => {
            return process::run(
                &Config::load(&project)?,
                &project,
                &bioart::arguments(command, &project),
            );
        }
    }
    Ok(0)
}

fn main() {
    let code = match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("arc-science-native: {error}");
            1
        }
    };
    std::process::exit(code);
}
