//! Arc Science native session-memory engine.
//!
//! Authoritative, project-local store for the harness's own session history
//! (planning rounds, model invocations, reconciliations, tool observations),
//! retained across context compaction, heavily compressed at rest, and searchable
//! by keyword and meaning.
//!
//! This engine runs *parallel* to the Python `MissionRepository`/`EventLedger`; it
//! never replaces them and grants no authority to retrieved content. Retrieved
//! passages are untrusted data, never instructions.

mod embedding;
mod engine;
mod error;
mod protocol;
mod record;

pub use embedding::Embedder;
pub use engine::Engine;
pub use error::{Error, Result};
pub use protocol::{Request, Response, Worker, read_frame, serve, write_frame};
pub use record::{NewRecord, Role, Scope, SearchHit, SessionSummary, StoredRecord, TrustCategory};

/// Wire/IPC protocol version spoken by the stdio worker (see the design doc).
pub const PROTOCOL_VERSION: &str = "arc-memory/1";

/// The bundled SQLite library version string (e.g. `"3.51.3"`).
///
/// The engine links its own SQLite through `rusqlite`'s bundled build so it does
/// not depend on the host's `sqlite3` (3.45.1 on the reference Windows machine,
/// below the 3.51.3 WAL-reset fix the design requires).
pub fn sqlite_version() -> String {
    rusqlite::version().to_string()
}
