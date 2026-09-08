use arc_science_native::{
    Result,
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
    Init,
    /// Validate and print configuration with resolved project paths.
    Config,
    /// Report local executable availability, not scientific qualification; no network.
    Doctor,
    /// Start the configured loopback Python service (stdin EOF).
    Serve,
    /// Run a noninteractive Python CLI command; put all worker arguments after --.
    Worker {
        #[arg(last = true, required = true)]
        args: Vec<OsString>,
    },
}

fn run() -> Result<i32> {
    let cli = Cli::parse();
    let project = config::project_root(&cli.project)?;
    match cli.command {
        Action::Init => {
            config::initialize(&project)?;
            println!("Created {}", project.join(config::CONFIG_FILE).display());
        }
        Action::Config => println!("{}", toml::to_string_pretty(&Config::load(&project)?)?),
        Action::Doctor => return process::doctor(&Config::load(&project)?, &project),
        Action::Serve => {
            let config = Config::load(&project)?;
            return process::run(
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
            );
        }
        Action::Worker { args } => return process::run(&Config::load(&project)?, &project, &args),
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
