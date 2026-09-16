//! SQLite-backed session-memory engine.
//!
//! The original UTF-8 text of every record is stored zstd-compressed and
//! content-addressed (identical text is stored once). A record row carries the
//! provenance and the per-session sequence. The engine bundles its own SQLite
//! (>= 3.51.3) so it does not depend on the host's `sqlite3`.
use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::record::{
    NewRecord, Role, Scope, SearchHit, SessionSummary, StoredRecord, TrustCategory,
};

/// zstd level for at-rest text ("heavily compressed" per the design).
const ZSTD_LEVEL: i32 = 19;

/// Columns selected for a full record read, joined to the decompressible blob.
const RECORD_COLUMNS: &str = "r.record_id, r.project, r.session, r.agent, r.seq, r.role, \
     r.wall_time_ms, r.content_digest, r.source_uri, r.trust, r.visibility, r.retention, \
     r.compaction_epoch, b.data, b.original_size";

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS blobs (
    content_digest TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    original_size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
    record_id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    session TEXT NOT NULL,
    agent TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    wall_time_ms INTEGER NOT NULL,
    content_digest TEXT NOT NULL REFERENCES blobs(content_digest),
    source_uri TEXT,
    trust TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'visible',
    retention TEXT NOT NULL DEFAULT 'active',
    compaction_epoch INTEGER NOT NULL,
    idempotency_key TEXT,
    UNIQUE(project, session, seq)
);
CREATE INDEX IF NOT EXISTS records_by_session ON records(project, session, seq);
CREATE UNIQUE INDEX IF NOT EXISTS records_key
    ON records(project, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(text, record_id UNINDEXED);
";

pub struct Engine {
    conn: Connection,
}

impl Engine {
    /// Open (creating if needed) a memory database at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// Append one record. Returns its `record_id`.
    ///
    /// If the record carries an idempotency key, a retry with the same key and the
    /// same content returns the existing record; the same key with different
    /// content is a [`Error::Conflict`].
    pub fn append(&self, record: &NewRecord) -> Result<String> {
        let content_digest = sha256_hex(record.text.as_bytes());
        let tx = self.conn.unchecked_transaction()?;

        if let Some(key) = record.idempotency_key.as_deref() {
            let existing: Option<(String, String)> = tx
                .query_row(
                    "SELECT record_id, content_digest FROM records \
                     WHERE project = ?1 AND idempotency_key = ?2",
                    params![record.project_id, key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((existing_id, existing_content)) = existing {
                // Content digest identifies the captured text; a reused key with
                // different text is a genuine conflict, a retry of the same event is not.
                if existing_content != content_digest {
                    return Err(Error::Conflict);
                }
                tx.commit()?;
                return Ok(existing_id);
            }
        }

        let compressed = zstd::encode_all(record.text.as_bytes(), ZSTD_LEVEL)?;
        let seq: i64 = tx.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE project = ?1 AND session = ?2",
            params![record.project_id, record.session_id],
            |row| row.get(0),
        )?;

        tx.execute(
            "INSERT OR IGNORE INTO blobs(content_digest, data, original_size) VALUES (?1, ?2, ?3)",
            params![content_digest, compressed, record.text.len() as i64],
        )?;

        let record_id = record_identity(record, seq, &content_digest);
        tx.execute(
            "INSERT INTO records(record_id, project, session, agent, seq, role, wall_time_ms, \
             content_digest, source_uri, trust, visibility, retention, compaction_epoch, \
             idempotency_key) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'visible', 'active', ?11, ?12)",
            params![
                record_id,
                record.project_id,
                record.session_id,
                record.agent_id,
                seq,
                record.role.as_str(),
                record.wall_time_ms,
                content_digest,
                record.source_uri,
                record.trust.as_str(),
                record.compaction_epoch,
                record.idempotency_key,
            ],
        )?;
        tx.execute(
            "INSERT INTO records_fts(text, record_id) VALUES (?1, ?2)",
            params![record.text, record_id],
        )?;
        tx.commit()?;
        Ok(record_id)
    }

    /// Remove a record from future retrieval (tombstone). The record and its text
    /// stay intact and directly inspectable; this is not an erase.
    pub fn disable(&self, record_id: &str) -> Result<()> {
        let updated = self.conn.execute(
            "UPDATE records SET visibility = 'hidden' WHERE record_id = ?1",
            params![record_id],
        )?;
        if updated == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Lexical search within a scope. Returns ranked visible hits, or an empty
    /// vector (abstention) when nothing matches. A blank query abstains.
    pub fn search(&self, scope: &Scope, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let match_expr = fts_match_expression(query);
        if match_expr.is_empty() {
            return Ok(Vec::new());
        }
        let sql = format!(
            "SELECT {RECORD_COLUMNS}, bm25(records_fts) AS score \
             FROM records_fts \
             JOIN records r ON r.record_id = records_fts.record_id \
             JOIN blobs b ON b.content_digest = r.content_digest \
             WHERE records_fts MATCH ?1 AND r.project = ?2 \
             AND (?3 IS NULL OR r.session = ?3) \
             AND (?4 IS NULL OR r.agent = ?4) \
             AND r.visibility = 'visible' \
             ORDER BY score LIMIT ?5"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(
                params![
                    match_expr,
                    scope.project,
                    scope.session,
                    scope.agent,
                    limit as i64
                ],
                |row| {
                    let raw = read_raw(row)?;
                    let score: f64 = row.get(15)?;
                    Ok((raw, score))
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(raw, score)| {
                Ok(SearchHit {
                    record: hydrate(raw)?,
                    score,
                    reason: "lexical".to_string(),
                })
            })
            .collect()
    }

    /// Read one record back by id (regardless of visibility), integrity-checked.
    pub fn inspect(&self, record_id: &str) -> Result<StoredRecord> {
        self.query_records("r.record_id = ?1", &[&record_id])?
            .pop()
            .ok_or(Error::NotFound)
    }

    /// List the visible sessions in a project with their span and epoch range.
    pub fn session_list(&self, project: &str) -> Result<Vec<SessionSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT session, COUNT(*), MIN(seq), MAX(seq), MIN(compaction_epoch), \
             MAX(compaction_epoch) FROM records \
             WHERE project = ?1 AND visibility = 'visible' \
             GROUP BY session ORDER BY MIN(rowid)",
        )?;
        let rows = stmt
            .query_map(params![project], |row| {
                Ok(SessionSummary {
                    session_id: row.get(0)?,
                    record_count: row.get(1)?,
                    first_seq: row.get(2)?,
                    last_seq: row.get(3)?,
                    min_epoch: row.get(4)?,
                    max_epoch: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Fetch a session's visible records in sequence order, optionally bounded by
    /// an inclusive `[from_seq, to_seq]` range.
    pub fn session_fetch(
        &self,
        project: &str,
        session: &str,
        from_seq: Option<i64>,
        to_seq: Option<i64>,
    ) -> Result<Vec<StoredRecord>> {
        self.query_records(
            "r.project = ?1 AND r.session = ?2 AND r.visibility = 'visible' \
             AND (?3 IS NULL OR r.seq >= ?3) AND (?4 IS NULL OR r.seq <= ?4) \
             ORDER BY r.seq",
            &[&project, &session, &from_seq, &to_seq],
        )
    }

    /// Run a record query (a WHERE/ORDER tail), decompress and integrity-check each.
    fn query_records(&self, tail: &str, bind: &[&dyn ToSql]) -> Result<Vec<StoredRecord>> {
        let sql = format!(
            "SELECT {RECORD_COLUMNS} FROM records r \
             JOIN blobs b ON b.content_digest = r.content_digest WHERE {tail}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let raws = stmt
            .query_map(bind, read_raw)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        raws.into_iter().map(hydrate).collect()
    }
}

/// A record row as read from SQLite, before the text blob is decompressed.
struct Raw {
    record_id: String,
    project: String,
    session: String,
    agent: String,
    seq: i64,
    role: String,
    wall_time_ms: i64,
    content_digest: String,
    source_uri: Option<String>,
    trust: String,
    visibility: String,
    retention: String,
    compaction_epoch: i64,
    data: Vec<u8>,
    original_size: i64,
}

fn read_raw(row: &Row) -> rusqlite::Result<Raw> {
    Ok(Raw {
        record_id: row.get(0)?,
        project: row.get(1)?,
        session: row.get(2)?,
        agent: row.get(3)?,
        seq: row.get(4)?,
        role: row.get(5)?,
        wall_time_ms: row.get(6)?,
        content_digest: row.get(7)?,
        source_uri: row.get(8)?,
        trust: row.get(9)?,
        visibility: row.get(10)?,
        retention: row.get(11)?,
        compaction_epoch: row.get(12)?,
        data: row.get(13)?,
        original_size: row.get(14)?,
    })
}

fn hydrate(raw: Raw) -> Result<StoredRecord> {
    let text_bytes = zstd::decode_all(raw.data.as_slice())?;
    if text_bytes.len() as i64 != raw.original_size || sha256_hex(&text_bytes) != raw.content_digest
    {
        return Err(Error::Corrupt("record text failed integrity check"));
    }
    let text =
        String::from_utf8(text_bytes).map_err(|_| Error::Corrupt("record text is not UTF-8"))?;
    Ok(StoredRecord {
        record_id: raw.record_id,
        project_id: raw.project,
        session_id: raw.session,
        agent_id: raw.agent,
        seq: raw.seq,
        role: Role::from_db(&raw.role).ok_or(Error::Corrupt("unknown role"))?,
        text,
        content_digest: raw.content_digest,
        source_uri: raw.source_uri,
        trust: TrustCategory::from_db(&raw.trust).ok_or(Error::Corrupt("unknown trust"))?,
        visibility: raw.visibility,
        retention: raw.retention,
        compaction_epoch: raw.compaction_epoch,
        wall_time_ms: raw.wall_time_ms,
    })
}

/// Build a safe FTS5 MATCH expression from arbitrary user text: each whitespace
/// token becomes a quoted phrase (internal quotes doubled), joined by space so the
/// terms are ANDed. Returns an empty string when the query has no usable tokens,
/// which the caller treats as abstention.
fn fts_match_expression(query: &str) -> String {
    query
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Deterministic record identity: sha256 over a canonical (sorted-key, compact)
/// JSON of the record's binding fields, mirroring the Python `canonical`/`digest`.
fn record_identity(record: &NewRecord, seq: i64, content_digest: &str) -> String {
    let mut fields: BTreeMap<&str, Value> = BTreeMap::new();
    fields.insert("project", Value::from(record.project_id.as_str()));
    fields.insert("session", Value::from(record.session_id.as_str()));
    fields.insert("agent", Value::from(record.agent_id.as_str()));
    fields.insert("seq", Value::from(seq));
    fields.insert("role", Value::from(record.role.as_str()));
    fields.insert("wall_time_ms", Value::from(record.wall_time_ms));
    fields.insert("content_digest", Value::from(content_digest));
    fields.insert(
        "source_uri",
        record
            .source_uri
            .as_deref()
            .map(Value::from)
            .unwrap_or(Value::Null),
    );
    fields.insert("trust", Value::from(record.trust.as_str()));
    fields.insert("compaction_epoch", Value::from(record.compaction_epoch));
    let canonical = serde_json::to_vec(&fields).expect("canonical serialization");
    sha256_hex(&canonical)
}
