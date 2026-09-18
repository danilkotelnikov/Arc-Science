//! SQLite-backed session-memory engine.
//!
//! The original UTF-8 text of every record is stored zstd-compressed and
//! content-addressed (identical text is stored once). A record row carries the
//! provenance and the per-session sequence. The engine bundles its own SQLite
//! (>= 3.51.3) so it does not depend on the host's `sqlite3`.
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::embedding::Embedder;
use crate::error::{Error, Result};
use crate::record::{
    NewRecord, Role, Scope, SearchHit, SessionSummary, StoredRecord, TrustCategory,
};

/// zstd level for at-rest text ("heavily compressed" per the design).
const ZSTD_LEVEL: i32 = 19;
const MAX_FETCH_RECORDS: usize = 1000;
const MAX_FETCH_TEXT_BYTES: usize = 8 * 1024 * 1024;

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
CREATE TABLE IF NOT EXISTS embeddings (
    record_id TEXT NOT NULL REFERENCES records(record_id),
    generation TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,
    PRIMARY KEY(record_id, generation)
);
";

/// Lexical index: contentless, so the only copy of a text is the compressed blob;
/// the scope columns hold one hex token each so a search can narrow on the index
/// before ranking; `record_id` is kept (unindexed) for the join back to `records`.
/// `PRAGMA user_version` records this layout so an older database is rebuilt once.
const FTS_VERSION: i64 = 2;
const FTS_SCHEMA: &str = "CREATE VIRTUAL TABLE records_fts USING fts5(\
    text, project, session, agent, record_id UNINDEXED, \
    content='', contentless_delete=1, contentless_unindexed=1)";
/// Rank on the text column alone: the scope columns weigh nothing, so no scope
/// token scores as a term. (Each row still carries its three scope tokens in the
/// length that bm25 normalizes by, uniformly for every row.)
const FTS_RANK: &str = "bm25(1.0, 0.0, 0.0, 0.0)";

pub struct Engine {
    conn: Connection,
}

impl Engine {
    /// Open (creating if needed) a memory database at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        let engine = Self { conn };
        engine.ensure_lexical_index()?;
        Ok(engine)
    }

    /// Create the lexical index, or rebuild an older layout from the compressed
    /// records in one transaction: a crash leaves either the old index or the new.
    fn ensure_lexical_index(&self) -> Result<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version >= FTS_VERSION {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction()?;
        // SQLite 3.53 leaves the `_content` shadow table behind when a
        // contentless_unindexed table is dropped (sqlite3Fts5DropAll only drops
        // it for normal content), so drop it explicitly before recreating.
        tx.execute_batch(
            "DROP TABLE IF EXISTS records_fts; DROP TABLE IF EXISTS records_fts_content;",
        )?;
        tx.execute_batch(FTS_SCHEMA)?;
        let mut visible = 0i64;
        {
            let mut stmt = tx.prepare(
                "SELECT r.record_id, r.project, r.session, r.agent, b.data, b.original_size, \
                 r.content_digest FROM records r \
                 JOIN blobs b ON b.content_digest = r.content_digest \
                 WHERE r.visibility = 'visible'",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?;
            for row in rows {
                let (record_id, project, session, agent, data, size, digest) = row?;
                let text = decode_verified(&data, size, &digest)?;
                index_text(&tx, &record_id, &project, &session, &agent, &text)?;
                visible += 1;
            }
        }
        let indexed: i64 =
            tx.query_row("SELECT COUNT(*) FROM records_fts", [], |row| row.get(0))?;
        if indexed != visible {
            return Err(Error::Corrupt("lexical index rebuild lost records"));
        }
        tx.execute_batch(&format!("PRAGMA user_version = {FTS_VERSION}"))?;
        tx.commit()?;
        Ok(())
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
        index_text(
            &tx,
            &record_id,
            &record.project_id,
            &record.session_id,
            &record.agent_id,
            &record.text,
        )?;
        tx.commit()?;
        Ok(record_id)
    }

    /// Remove a record from future retrieval (tombstone). The record and its text
    /// stay intact and directly inspectable; this is not an erase.
    pub fn disable(&self, record_id: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let updated = tx.execute(
            "UPDATE records SET visibility = 'hidden' WHERE record_id = ?1",
            params![record_id],
        )?;
        if updated == 0 {
            return Err(Error::NotFound);
        }
        // The derived index row goes with it, so hidden text neither costs a scan
        // nor shapes ranking statistics; the record and its blob stay inspectable.
        tx.execute(
            "DELETE FROM records_fts WHERE record_id = ?1",
            params![record_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Lexical search within a scope. Returns ranked visible hits, or an empty
    /// vector (abstention) when nothing matches. A blank query abstains.
    pub fn search(&self, scope: &Scope, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut remaining = MAX_FETCH_TEXT_BYTES;
        self.search_bounded(scope, query, limit, &mut remaining)
    }

    fn search_bounded(
        &self,
        scope: &Scope,
        query: &str,
        limit: usize,
        remaining: &mut usize,
    ) -> Result<Vec<SearchHit>> {
        let Some(match_expr) = fts_match_expression(scope, query) else {
            return Ok(Vec::new());
        };
        // Rank and cut on the index alone (scope tokens narrow the posting walk),
        // then join the survivors to their record rows and compressed text with an
        // exact scope check, so the index is a prefilter and never the authority.
        let sql = format!(
            "SELECT {RECORD_COLUMNS}, top.score FROM (\
                 SELECT record_id, rank AS score FROM records_fts \
                 WHERE records_fts MATCH ?1 AND rank MATCH ?5 ORDER BY rank LIMIT ?6\
             ) top \
             JOIN records r ON r.record_id = top.record_id \
             JOIN blobs b ON b.content_digest = r.content_digest \
             WHERE r.project = ?2 \
             AND (?3 IS NULL OR r.session = ?3) \
             AND (?4 IS NULL OR r.agent = ?4) \
             AND r.visibility = 'visible' \
             ORDER BY top.score"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            params![
                match_expr,
                scope.project,
                scope.session,
                scope.agent,
                FTS_RANK,
                limit as i64
            ],
            |row| {
                let raw = read_raw(row)?;
                let score: f64 = row.get(15)?;
                Ok((raw, score))
            },
        )?;
        rows.map(|row| {
            let (raw, score) = row?;
            Ok(SearchHit {
                record: hydrate_bounded(raw, remaining)?,
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
             JOIN blobs b ON b.content_digest = r.content_digest WHERE {tail} LIMIT 1001"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let raws = stmt.query_map(bind, read_raw)?;
        let mut records = Vec::new();
        let mut remaining = MAX_FETCH_TEXT_BYTES;
        for raw in raws {
            let raw = raw?;
            if records.len() == MAX_FETCH_RECORDS {
                return Err(read_budget_error());
            }
            records.push(hydrate_bounded(raw, &mut remaining)?);
        }
        Ok(records)
    }

    /// Embed all visible records missing an embedding for this embedder's
    /// generation. Returns the number embedded. A malformed vector aborts the whole
    /// batch with [`Error::InvalidVector`] before anything is written.
    pub fn embed_pending(&self, embedder: &dyn Embedder) -> Result<usize> {
        let generation = embedder.model_id().to_string();
        let pending: Vec<(String, String)> = {
            let mut stmt = self.conn.prepare(
                "SELECT r.record_id, b.data, b.original_size, r.content_digest \
                 FROM records r JOIN blobs b ON b.content_digest = r.content_digest \
                 LEFT JOIN embeddings e ON e.record_id = r.record_id AND e.generation = ?1 \
                 WHERE e.record_id IS NULL AND r.visibility = 'visible'",
            )?;
            let raws = stmt
                .query_map(params![generation], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            raws.into_iter()
                .map(|(id, data, size, digest)| Ok((id, decode_verified(&data, size, &digest)?)))
                .collect::<Result<Vec<_>>>()?
        };
        if pending.is_empty() {
            return Ok(0);
        }

        let texts: Vec<&str> = pending.iter().map(|(_, text)| text.as_str()).collect();
        let vectors = embedder.embed(&texts)?;
        if vectors.len() != pending.len() {
            return Err(Error::InvalidVector);
        }
        for vector in &vectors {
            validate_vector(vector, embedder.dim())?;
        }

        let tx = self.conn.unchecked_transaction()?;
        for ((record_id, _), vector) in pending.iter().zip(vectors.iter()) {
            tx.execute(
                "INSERT OR IGNORE INTO embeddings(record_id, generation, dim, vector) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    record_id,
                    generation,
                    vector.len() as i64,
                    encode_vector(vector)
                ],
            )?;
        }
        tx.commit()?;
        Ok(pending.len())
    }

    /// Exact cosine search over the embedder's generation, scoped and visible.
    /// Returns the top `limit` hits, or empty (abstention) when nothing is indexed.
    pub fn semantic_search(
        &self,
        scope: &Scope,
        embedder: &dyn Embedder,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SearchHit>> {
        let mut remaining = MAX_FETCH_TEXT_BYTES;
        self.semantic_search_bounded(scope, embedder, query, limit, &mut remaining)
    }

    fn semantic_search_bounded(
        &self,
        scope: &Scope,
        embedder: &dyn Embedder,
        query: &str,
        limit: usize,
        remaining: &mut usize,
    ) -> Result<Vec<SearchHit>> {
        let query_vector = embedder
            .embed(&[query])?
            .pop()
            .ok_or(Error::InvalidVector)?;
        validate_vector(&query_vector, embedder.dim())?;

        // The candidate scan touches vectors and scope columns only; each candidate's
        // row and compressed text are read for the top-k alone. Carrying every
        // candidate's blob through the scan cost ~385 ms p50 at 20k records (measured).
        let mut stmt = self.conn.prepare(
            "SELECT e.record_id, e.vector FROM embeddings e \
             JOIN records r ON r.record_id = e.record_id \
             WHERE e.generation = ?1 AND r.project = ?2 \
             AND (?3 IS NULL OR r.session = ?3) \
             AND (?4 IS NULL OR r.agent = ?4) \
             AND r.visibility = 'visible'",
        )?;
        let mut scored = stmt
            .query_map(
                params![
                    embedder.model_id(),
                    scope.project,
                    scope.session,
                    scope.agent
                ],
                |row| {
                    let id: String = row.get(0)?;
                    let bytes: Vec<u8> = row.get(1)?;
                    Ok((cosine(&query_vector, &decode_vector(&bytes)) as f64, id))
                },
            )?
            .collect::<rusqlite::Result<Vec<(f64, String)>>>()?;
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        let sql = format!(
            "SELECT {RECORD_COLUMNS} FROM records r \
             JOIN blobs b ON b.content_digest = r.content_digest WHERE r.record_id = ?1"
        );
        let mut fetch = self.conn.prepare(&sql)?;
        scored
            .into_iter()
            .map(|(score, id)| {
                let raw = fetch.query_row(params![id], read_raw)?;
                Ok(SearchHit {
                    record: hydrate_bounded(raw, remaining)?,
                    score,
                    reason: "semantic".to_string(),
                })
            })
            .collect()
    }

    /// Hybrid retrieval: fuse the lexical and semantic result lists with
    /// deterministic reciprocal-rank fusion (RRF, k=60). A record appearing in both
    /// lists is fused once; ties break by record id for a stable order.
    pub fn hybrid_search(
        &self,
        scope: &Scope,
        embedder: &dyn Embedder,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SearchHit>> {
        const RRF_K: f64 = 60.0;
        let pool = limit.max(1).saturating_mul(4);
        let mut remaining = MAX_FETCH_TEXT_BYTES;
        let lexical = self.search_bounded(scope, query, pool, &mut remaining)?;
        let semantic =
            self.semantic_search_bounded(scope, embedder, query, pool, &mut remaining)?;

        let mut fused: HashMap<String, (f64, StoredRecord)> = HashMap::new();
        for list in [lexical, semantic] {
            for (rank, hit) in list.into_iter().enumerate() {
                let entry = fused
                    .entry(hit.record.record_id.clone())
                    .or_insert((0.0, hit.record));
                entry.0 += 1.0 / (RRF_K + rank as f64 + 1.0);
            }
        }
        let mut items: Vec<(f64, StoredRecord)> = fused.into_values().collect();
        items.sort_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.1.record_id.cmp(&b.1.record_id))
        });
        Ok(items
            .into_iter()
            .take(limit)
            .map(|(score, record)| SearchHit {
                record,
                score,
                reason: "hybrid".to_string(),
            })
            .collect())
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

fn read_budget_error() -> Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "retrieval exceeds the bounded read budget; narrow the session range or search limit",
    )
    .into()
}

fn hydrate_bounded(raw: Raw, remaining: &mut usize) -> Result<StoredRecord> {
    if raw.original_size < 0 || raw.original_size as u64 > *remaining as u64 {
        return Err(read_budget_error());
    }
    *remaining -= raw.original_size as usize;
    hydrate(raw)
}

fn hydrate(raw: Raw) -> Result<StoredRecord> {
    // Even corrupt metadata or a compressed bomb cannot allocate without a cap.
    let mut text_bytes = Vec::new();
    zstd::Decoder::new(raw.data.as_slice())?
        .take(MAX_FETCH_TEXT_BYTES as u64 + 1)
        .read_to_end(&mut text_bytes)?;
    if text_bytes.len() > MAX_FETCH_TEXT_BYTES {
        return Err(Error::Corrupt("record exceeds decoded text limit"));
    }
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

/// One tokenizer-safe token per scope value: the hex of its bytes, which the
/// default tokenizer keeps whole, so scope matching is exact, never fuzzy.
fn scope_token(value: &str) -> String {
    hex::encode(value.as_bytes())
}

/// Insert a record's text and scope tokens into the lexical index.
fn index_text(
    conn: &Connection,
    record_id: &str,
    project: &str,
    session: &str,
    agent: &str,
    text: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO records_fts(text, project, session, agent, record_id) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            text,
            scope_token(project),
            scope_token(session),
            scope_token(agent),
            record_id
        ],
    )?;
    Ok(())
}

/// Build a safe FTS5 MATCH expression from arbitrary user text: each whitespace
/// token becomes a quoted phrase (internal quotes doubled), ANDed together and
/// restricted to the text column, with the scope's tokens ANDed in front. Returns
/// `None` when the query has no usable tokens, which the caller treats as abstention.
fn fts_match_expression(scope: &Scope, query: &str) -> Option<String> {
    let phrases: Vec<String> = query
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect();
    if phrases.is_empty() {
        return None;
    }
    // An empty scope value has no token to match, so such a scope abstains rather
    // than producing an expression the parser rejects.
    let scopes = [
        ("project", Some(scope.project.as_str())),
        ("session", scope.session.as_deref()),
        ("agent", scope.agent.as_deref()),
    ];
    let mut parts = Vec::with_capacity(4);
    for (column, value) in scopes {
        match value {
            Some("") => return None,
            Some(value) => parts.push(format!("{column}:{}", scope_token(value))),
            None => {}
        }
    }
    parts.push(format!("text:({})", phrases.join(" ")));
    Some(parts.join(" AND "))
}

/// Decompress a stored blob and check it against its recorded size and digest.
fn decode_verified(data: &[u8], size: i64, digest: &str) -> Result<String> {
    let text = zstd::decode_all(data)?;
    if text.len() as i64 != size || sha256_hex(&text) != digest {
        return Err(Error::Corrupt("record text failed integrity check"));
    }
    String::from_utf8(text).map_err(|_| Error::Corrupt("record text is not UTF-8"))
}

/// Reject vectors that are the wrong dimension, contain a non-finite value, or are
/// entirely zero (unusable for cosine). Comparisons are against zero, which is exact.
fn validate_vector(vector: &[f32], dim: usize) -> Result<()> {
    let all_zero = vector.iter().all(|x| *x == 0.0);
    if vector.len() != dim || !vector.iter().all(|x| x.is_finite()) || all_zero {
        return Err(Error::InvalidVector);
    }
    Ok(())
}

fn encode_vector(vector: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

fn decode_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0f32;
    let mut norm_a = 0f32;
    let mut norm_b = 0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
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
