//! Stdio worker protocol (`arc-memory/1`).
//!
//! Frames are a 4-byte little-endian length prefix followed by a JSON body. Each
//! request is one operation; each response reports `ok` with data or `error` with a
//! message. A malformed or unknown request is answered with an error, never a panic.
use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::embedding::Embedder;
use crate::engine::Engine;
use crate::error::Result;
use crate::record::{NewRecord, Scope};

/// Largest frame the worker will read (16 MiB), guarding against a bad length.
const MAX_FRAME: usize = 16 * 1024 * 1024;

/// A single protocol request, tagged by its `op` field.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Health,
    Append {
        record: NewRecord,
    },
    Inspect {
        record_id: String,
    },
    Search {
        scope: Scope,
        query: String,
        limit: usize,
    },
    Semantic {
        scope: Scope,
        query: String,
        limit: usize,
    },
    Hybrid {
        scope: Scope,
        query: String,
        limit: usize,
    },
    SessionList {
        project: String,
    },
    SessionFetch {
        project: String,
        session: String,
        #[serde(default)]
        from_seq: Option<i64>,
        #[serde(default)]
        to_seq: Option<i64>,
    },
    Disable {
        record_id: String,
    },
    Embed,
}

/// A protocol response, tagged by its `status` field.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Response {
    Ok { data: Value },
    Error { error: String },
}

impl Response {
    fn ok(data: Value) -> Self {
        Response::Ok { data }
    }
    fn error(message: impl Into<String>) -> Self {
        Response::Error {
            error: message.into(),
        }
    }
}

/// A memory worker: an engine plus an optional embedder. Semantic and hybrid
/// operations require a configured embedder; without one they report an error
/// rather than silently degrading.
pub struct Worker {
    engine: Engine,
    embedder: Option<Box<dyn Embedder>>,
}

impl Worker {
    pub fn new(engine: Engine, embedder: Option<Box<dyn Embedder>>) -> Self {
        Self { engine, embedder }
    }

    /// Parse and handle one request frame, always returning a response.
    pub fn handle_bytes(&self, frame: &[u8]) -> Response {
        match serde_json::from_slice::<Request>(frame) {
            Ok(request) => self.handle(request),
            Err(error) => Response::error(format!("bad request: {error}")),
        }
    }

    pub fn handle(&self, request: Request) -> Response {
        match request {
            Request::Health => Response::ok(json!({
                "protocol": crate::PROTOCOL_VERSION,
                "sqlite": crate::sqlite_version(),
            })),
            Request::Append { record } => match self.engine.append(&record) {
                Ok(id) => Response::ok(json!({ "record_id": id })),
                Err(error) => Response::error(error.to_string()),
            },
            Request::Inspect { record_id } => serialize(self.engine.inspect(&record_id)),
            Request::Search {
                scope,
                query,
                limit,
            } => serialize(self.engine.search(&scope, &query, limit)),
            Request::SessionList { project } => serialize(self.engine.session_list(&project)),
            Request::SessionFetch {
                project,
                session,
                from_seq,
                to_seq,
            } => serialize(
                self.engine
                    .session_fetch(&project, &session, from_seq, to_seq),
            ),
            Request::Disable { record_id } => match self.engine.disable(&record_id) {
                Ok(()) => Response::ok(json!({ "disabled": true })),
                Err(error) => Response::error(error.to_string()),
            },
            Request::Semantic {
                scope,
                query,
                limit,
            } => match self.embedder.as_deref() {
                Some(embedder) => {
                    serialize(self.engine.semantic_search(&scope, embedder, &query, limit))
                }
                None => Response::error("no embedder configured"),
            },
            Request::Hybrid {
                scope,
                query,
                limit,
            } => match self.embedder.as_deref() {
                Some(embedder) => {
                    serialize(self.engine.hybrid_search(&scope, embedder, &query, limit))
                }
                None => Response::error("no embedder configured"),
            },
            Request::Embed => match self.embedder.as_deref() {
                Some(embedder) => match self.engine.embed_pending(embedder) {
                    Ok(count) => Response::ok(json!({ "embedded": count })),
                    Err(error) => Response::error(error.to_string()),
                },
                None => Response::error("no embedder configured"),
            },
        }
    }
}

/// Turn a fallible, serializable engine result into a response.
fn serialize<T: Serialize>(result: Result<T>) -> Response {
    match result {
        Ok(value) => match serde_json::to_value(value) {
            Ok(data) => Response::ok(data),
            Err(_) => Response::error("failed to serialize result"),
        },
        Err(error) => Response::error(error.to_string()),
    }
}

/// Write one length-prefixed frame.
pub fn write_frame<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    let length = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "frame too large"))?;
    writer.write_all(&length.to_le_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

/// Read one length-prefixed frame, or `None` at a clean end of stream.
pub fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut length_bytes = [0u8; 4];
    match reader.read_exact(&mut length_bytes) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_le_bytes(length_bytes) as usize;
    if length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame too large",
        ));
    }
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

/// Serve requests from `input`, writing framed responses to `output`, until EOF.
pub fn serve<R: Read, W: Write>(worker: &Worker, input: &mut R, output: &mut W) -> io::Result<()> {
    while let Some(frame) = read_frame(input)? {
        let response = worker.handle_bytes(&frame);
        let body = serde_json::to_vec(&response).unwrap_or_else(|_| {
            br#"{"status":"error","error":"failed to serialize response"}"#.to_vec()
        });
        write_frame(output, &body)?;
    }
    Ok(())
}
