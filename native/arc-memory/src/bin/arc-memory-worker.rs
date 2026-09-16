//! `arc-memory-worker`: serve the `arc-memory/1` protocol over stdio.
//!
//! Opens the memory database given by `--data <path>` and answers framed requests
//! on stdin with framed responses on stdout until end of input. The real embedder
//! is provisioned separately; until then semantic/hybrid operations report an error.
use std::io::{self, BufReader, BufWriter};
use std::path::PathBuf;
use std::process::ExitCode;

use arc_memory::{Engine, PROTOCOL_VERSION, Worker, serve};

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut data: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data" => data = args.next().map(PathBuf::from),
            "--version" => {
                println!("{PROTOCOL_VERSION}");
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!("arc-memory-worker: unknown argument {other}");
                return ExitCode::from(2);
            }
        }
    }

    let Some(data) = data else {
        eprintln!("arc-memory-worker: --data <path> is required");
        return ExitCode::from(2);
    };

    let engine = match Engine::open(&data) {
        Ok(engine) => engine,
        Err(error) => {
            eprintln!("arc-memory-worker: cannot open {}: {error}", data.display());
            return ExitCode::FAILURE;
        }
    };

    let worker = Worker::new(engine, None);
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = BufReader::new(stdin.lock());
    let mut output = BufWriter::new(stdout.lock());

    match serve(&worker, &mut input, &mut output) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("arc-memory-worker: {error}");
            ExitCode::FAILURE
        }
    }
}
