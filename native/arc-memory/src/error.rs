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
    /// An embedder produced a vector with a wrong dimension, a non-finite value,
    /// or an all-zero (unusable) vector.
    InvalidVector,
    /// Stored bytes failed an integrity check against their recorded digest.
    Corrupt(&'static str),
    /// A retrieval would exceed the bounded read budget.
    ReadBudget,
}

impl Error {
    /// Machine-readable cause, reported beside the message on the wire.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Sqlite(_) | Error::Io(_) => "storage",
            Error::NotFound => "not_found",
            Error::Conflict => "conflict",
            Error::InvalidVector => "invalid_vector",
            Error::Corrupt(_) => "corrupt",
            Error::ReadBudget => "read_budget",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sqlite(e) => write!(f, "sqlite: {e}"),
            Error::Io(e) => write!(f, "io: {e}"),
            Error::NotFound => write!(f, "record not found"),
            Error::Conflict => write!(f, "idempotency key reused for different content"),
            Error::InvalidVector => write!(f, "embedder produced an invalid vector"),
            Error::Corrupt(what) => write!(f, "corrupt: {what}"),
            Error::ReadBudget => write!(
                f,
                "retrieval exceeds the bounded read budget; narrow the session range or search limit"
            ),
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
