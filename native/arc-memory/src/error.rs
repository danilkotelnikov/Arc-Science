//! Engine error type. Errors are typed and never carry secret values.
use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    /// Underlying SQLite failure.
    Sqlite(rusqlite::Error),
    /// Compression/decompression or other I/O failure.
    Io(std::io::Error),
    /// A requested record does not exist (or is not visible).
    NotFound,
    /// An idempotency key was reused for different content.
    Conflict,
    /// Stored bytes failed an integrity check against their recorded digest.
    Corrupt(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sqlite(e) => write!(f, "sqlite: {e}"),
            Error::Io(e) => write!(f, "io: {e}"),
            Error::NotFound => write!(f, "record not found"),
            Error::Conflict => write!(f, "idempotency key reused for different content"),
            Error::Corrupt(what) => write!(f, "corrupt: {what}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Sqlite(e)
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}
