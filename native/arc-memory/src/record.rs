//! Memory record types.
//!
//! A record is one immutable event in the harness's own session history. The
//! `trust` category travels with every record so retrieval can label provenance;
//! it never elevates retrieved content to an instruction or a verified fact.
use serde::{Deserialize, Serialize};

/// Who produced a record within a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    User,
    Assistant,
    Planner,
    Falsifier,
    Reconciliation,
    Tool,
    System,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Planner => "planner",
            Role::Falsifier => "falsifier",
            Role::Reconciliation => "reconciliation",
            Role::Tool => "tool",
            Role::System => "system",
        }
    }

    /// Parse a role stored in the database. Named `from_db` (not `from_str`) so it
    /// does not shadow the `FromStr` trait contract.
    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "user" => Role::User,
            "assistant" => Role::Assistant,
            "planner" => Role::Planner,
            "falsifier" => Role::Falsifier,
            "reconciliation" => Role::Reconciliation,
            "tool" => Role::Tool,
            "system" => Role::System,
            _ => return None,
        })
    }
}

/// Provenance/trust category of a record's content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustCategory {
    ModelOutput,
    Operator,
    PublicSnapshot,
    ToolObservation,
}

impl TrustCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            TrustCategory::ModelOutput => "model_output",
            TrustCategory::Operator => "operator",
            TrustCategory::PublicSnapshot => "public_snapshot",
            TrustCategory::ToolObservation => "tool_observation",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "model_output" => TrustCategory::ModelOutput,
            "operator" => TrustCategory::Operator,
            "public_snapshot" => TrustCategory::PublicSnapshot,
            "tool_observation" => TrustCategory::ToolObservation,
            _ => return None,
        })
    }
}

/// A record to append. The engine assigns the per-session sequence and record id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewRecord {
    pub project_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub role: Role,
    pub text: String,
    pub source_uri: Option<String>,
    pub trust: TrustCategory,
    pub compaction_epoch: i64,
    pub wall_time_ms: i64,
    /// Optional dedup key: a retried append with the same key and content returns
    /// the existing record; the same key with different content is a conflict.
    pub idempotency_key: Option<String>,
}

/// Authorization scope applied before candidate selection. A caller-supplied
/// scope is a filter, not an access grant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scope {
    pub project: String,
    pub session: Option<String>,
    pub agent: Option<String>,
}

/// One retrieval result: the record, a score, and the reason it was retrieved.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub record: StoredRecord,
    pub score: f64,
    pub reason: String,
}

/// Summary of one session in a project, for navigation in the UI.
#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub record_count: i64,
    pub first_seq: i64,
    pub last_seq: i64,
    pub min_epoch: i64,
    pub max_epoch: i64,
}

/// A record read back from the store, with its original text decompressed.
#[derive(Debug, Clone, Serialize)]
pub struct StoredRecord {
    pub record_id: String,
    pub project_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub seq: i64,
    pub role: Role,
    pub text: String,
    pub content_digest: String,
    pub source_uri: Option<String>,
    pub trust: TrustCategory,
    pub visibility: String,
    pub retention: String,
    pub compaction_epoch: i64,
    pub wall_time_ms: i64,
}
