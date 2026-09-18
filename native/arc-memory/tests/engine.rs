//! Behavior tests for the arc-memory engine.

use arc_memory::{Engine, NewRecord, Role, Scope, TrustCategory};
use tempfile::tempdir;

fn sample(text: &str) -> NewRecord {
    NewRecord {
        project_id: "proj-1".into(),
        session_id: "sess-1".into(),
        agent_id: "planner".into(),
        role: Role::Planner,
        text: text.into(),
        source_uri: None,
        trust: TrustCategory::ModelOutput,
        compaction_epoch: 0,
        wall_time_ms: 1_700_000_000_000,
        idempotency_key: None,
    }
}

/// The design requires SQLite >= 3.51.3 (the WAL-reset fix). The engine must run
/// on a bundled build that includes it, independent of the host's Python sqlite3
/// (which is 3.45.1 on the reference Windows machine).
#[test]
fn bundled_sqlite_meets_wal_reset_requirement() {
    let version = arc_memory::sqlite_version();
    let parts: Vec<u32> = version
        .split('.')
        .map(|p| p.parse().expect("numeric SQLite version component"))
        .collect();
    let triple = (parts[0], parts[1], parts[2]);
    assert!(
        triple >= (3, 51, 3),
        "bundled SQLite {version} is below the required 3.51.3 WAL-reset fix"
    );
}

#[test]
fn append_then_inspect_round_trips_the_original_text() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();

    let id = engine
        .append(&sample("The analyst proposed hypothesis H1."))
        .unwrap();
    let got = engine.inspect(&id).unwrap();

    assert_eq!(got.text, "The analyst proposed hypothesis H1.");
    assert_eq!(got.role, Role::Planner);
    assert_eq!(got.project_id, "proj-1");
    assert_eq!(got.seq, 1);
}

#[test]
fn sequence_increments_per_session() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();

    let first = engine
        .inspect(&engine.append(&sample("one")).unwrap())
        .unwrap();
    let second = engine
        .inspect(&engine.append(&sample("two")).unwrap())
        .unwrap();

    assert_eq!(first.seq, 1);
    assert_eq!(second.seq, 2);
}

#[test]
fn session_overflow_is_explicit_and_sequence_ranges_remain_available() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    for _ in 0..1001 {
        engine.append(&sample("bounded history")).unwrap();
    }
    let error = engine
        .session_fetch("proj-1", "sess-1", None, None)
        .unwrap_err();
    assert!(error.to_string().contains("narrow the session range"));
    let page = engine
        .session_fetch("proj-1", "sess-1", Some(1000), Some(1001))
        .unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].seq, 1000);
}

#[test]
fn session_checks_decoded_byte_budget_before_hydrating_record() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("memory.db");
    let engine = Engine::open(&path).unwrap();
    engine.append(&sample("small text")).unwrap();
    // A corrupt size must be rejected before decoding, not trusted as capacity.
    rusqlite::Connection::open(path)
        .unwrap()
        .execute("UPDATE blobs SET original_size=9000000", [])
        .unwrap();
    let error = engine
        .session_fetch("proj-1", "sess-1", None, None)
        .unwrap_err();
    assert!(error.to_string().contains("narrow the session range"));
}

#[test]
fn all_search_modes_bound_the_aggregate_decoded_text() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    let text = format!("hydrogen {}", "a".repeat(4 * 1024 * 1024));
    engine.append(&sample(&text)).unwrap();
    engine.append(&sample(&text)).unwrap();
    let embedder = HashingEmbedder { dim: 16 };
    engine.embed_pending(&embedder).unwrap();
    let sc = scope("proj-1");
    assert_eq!(engine.search(&sc, "hydrogen", 1).unwrap().len(), 1);
    for result in [
        engine.search(&sc, "hydrogen", 2),
        engine.semantic_search(&sc, &embedder, "hydrogen", 2),
        engine.hybrid_search(&sc, &embedder, "hydrogen", 2),
    ] {
        let Err(error) = result else {
            panic!("search must enforce its aggregate text budget");
        };
        assert!(error.to_string().contains("read budget"));
    }
}

#[test]
fn keyed_append_is_idempotent() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    let mut record = sample("captured once");
    record.idempotency_key = Some("evt-42".into());

    let first = engine.inspect(&engine.append(&record).unwrap()).unwrap();
    let second = engine.inspect(&engine.append(&record).unwrap()).unwrap();

    assert_eq!(first.record_id, second.record_id);
    assert_eq!(
        second.seq, 1,
        "a retried event must not create a second row"
    );
}

#[test]
fn reused_key_with_different_content_is_rejected() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    let mut original = sample("first payload");
    original.idempotency_key = Some("k".into());
    let mut clashing = sample("different payload");
    clashing.idempotency_key = Some("k".into());

    engine.append(&original).unwrap();
    assert!(matches!(
        engine.append(&clashing),
        Err(arc_memory::Error::Conflict)
    ));
}

#[test]
fn text_is_compressed_and_deduplicated_at_rest() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("memory.db");
    let engine = Engine::open(&db).unwrap();
    let long = "hydrogen bond between Asp30 and the ligand. ".repeat(400);

    engine.append(&sample(&long)).unwrap();
    engine.append(&sample(&long)).unwrap(); // identical content

    let (blob_rows, stored_bytes): (i64, i64) = rusqlite::Connection::open(&db)
        .unwrap()
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(data)), 0) FROM blobs",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();

    assert_eq!(blob_rows, 1, "identical text is stored once");
    assert!(
        stored_bytes < long.len() as i64,
        "stored {stored_bytes} bytes should be smaller than the {} byte original",
        long.len()
    );
}

#[test]
fn session_list_and_fetch_expose_records_in_order() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    engine.append(&sample("a")).unwrap();
    engine.append(&sample("b")).unwrap();
    let mut other = sample("x");
    other.session_id = "sess-2".into();
    engine.append(&other).unwrap();

    let sessions = engine.session_list("proj-1").unwrap();
    assert_eq!(sessions.len(), 2);
    let first = sessions.iter().find(|s| s.session_id == "sess-1").unwrap();
    assert_eq!(first.record_count, 2);

    let records = engine
        .session_fetch("proj-1", "sess-1", None, None)
        .unwrap();
    assert_eq!(
        records.iter().map(|r| r.text.as_str()).collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    assert_eq!(records[0].seq, 1);
}

#[test]
fn records_retain_their_compaction_epoch() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    engine.append(&sample("pre-compaction")).unwrap();
    let mut post = sample("post-compaction");
    post.compaction_epoch = 1;
    engine.append(&post).unwrap();

    let summary = &engine.session_list("proj-1").unwrap()[0];
    assert_eq!(summary.min_epoch, 0);
    assert_eq!(summary.max_epoch, 1);

    let records = engine
        .session_fetch("proj-1", "sess-1", None, None)
        .unwrap();
    assert_eq!(records[1].compaction_epoch, 1);
}

#[test]
fn session_fetch_can_range_by_sequence() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    for text in ["a", "b", "c", "d"] {
        engine.append(&sample(text)).unwrap();
    }
    let middle = engine
        .session_fetch("proj-1", "sess-1", Some(2), Some(3))
        .unwrap();
    assert_eq!(
        middle.iter().map(|r| r.text.as_str()).collect::<Vec<_>>(),
        vec!["b", "c"]
    );
}

fn scope(project: &str) -> Scope {
    Scope {
        project: project.into(),
        session: None,
        agent: None,
    }
}

#[test]
fn disabled_records_are_excluded_from_session_fetch_but_still_inspectable() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    engine.append(&sample("keep")).unwrap();
    let hidden = engine.append(&sample("hide")).unwrap();
    engine.disable(&hidden).unwrap();

    let visible = engine
        .session_fetch("proj-1", "sess-1", None, None)
        .unwrap();
    assert_eq!(
        visible.iter().map(|r| r.text.as_str()).collect::<Vec<_>>(),
        vec!["keep"]
    );
    assert_eq!(engine.inspect(&hidden).unwrap().visibility, "hidden");
}

#[test]
fn lexical_search_finds_scoped_records_and_abstains_otherwise() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    engine
        .append(&sample("The ligand forms a hydrogen bond with Asp30."))
        .unwrap();
    engine
        .append(&sample("Unrelated note about buffer preparation."))
        .unwrap();

    let hits = engine
        .search(&scope("proj-1"), "hydrogen bond", 10)
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].record.text.contains("hydrogen bond"));

    let none = engine
        .search(&scope("proj-1"), "crystallography", 10)
        .unwrap();
    assert!(none.is_empty(), "no match must abstain, not error");
}

#[test]
fn search_is_scoped_to_the_project() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    engine.append(&sample("shared keyword alpha")).unwrap();
    let mut other = sample("shared keyword alpha");
    other.project_id = "proj-2".into();
    engine.append(&other).unwrap();

    let hits = engine.search(&scope("proj-2"), "alpha", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].record.project_id, "proj-2");
}

#[test]
fn disabled_records_are_excluded_from_search() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    engine.append(&sample("alpha beacon one")).unwrap();
    let hidden = engine.append(&sample("alpha beacon two")).unwrap();
    engine.disable(&hidden).unwrap();

    let hits = engine.search(&scope("proj-1"), "beacon", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].record.text.contains("one"));
}

/// Deterministic, model-free embedder for tests: feature-hash tokens into a fixed
/// dimension and L2-normalize. Identical text yields identical vectors; shared
/// tokens raise cosine similarity.
struct HashingEmbedder {
    dim: usize,
}

impl arc_memory::Embedder for HashingEmbedder {
    fn model_id(&self) -> &str {
        "synthetic-hash-v1"
    }
    fn dim(&self) -> usize {
        self.dim
    }
    fn embed(&self, texts: &[&str]) -> arc_memory::Result<Vec<Vec<f32>>> {
        Ok(texts
            .iter()
            .map(|text| {
                let mut v = vec![0f32; self.dim];
                for token in text.split_whitespace() {
                    let mut h: u64 = 1469598103934665603;
                    for b in token.bytes() {
                        h = h.wrapping_mul(131).wrapping_add(b as u64);
                    }
                    v[(h as usize) % self.dim] += 1.0;
                }
                let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
                if norm > 0.0 {
                    for x in v.iter_mut() {
                        *x /= norm;
                    }
                }
                v
            })
            .collect())
    }
}

struct BrokenEmbedder;
impl arc_memory::Embedder for BrokenEmbedder {
    fn model_id(&self) -> &str {
        "broken"
    }
    fn dim(&self) -> usize {
        4
    }
    fn embed(&self, texts: &[&str]) -> arc_memory::Result<Vec<Vec<f32>>> {
        Ok(texts
            .iter()
            .map(|_| vec![f32::NAN, 0.0, 0.0, 0.0])
            .collect())
    }
}

#[test]
fn semantic_search_ranks_by_similarity() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    let embedder = HashingEmbedder { dim: 64 };
    engine
        .append(&sample("ligand binding pocket hydrogen bond"))
        .unwrap();
    engine
        .append(&sample("buffer preparation and pipetting"))
        .unwrap();

    let embedded = engine.embed_pending(&embedder).unwrap();
    assert_eq!(embedded, 2);

    let hits = engine
        .semantic_search(
            &scope("proj-1"),
            &embedder,
            "hydrogen bond in the binding pocket",
            5,
        )
        .unwrap();
    assert!(!hits.is_empty());
    assert!(hits[0].record.text.contains("ligand binding pocket"));
    assert_eq!(hits[0].reason, "semantic");
}

#[test]
fn embed_pending_is_idempotent() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    let embedder = HashingEmbedder { dim: 32 };
    engine.append(&sample("one")).unwrap();
    engine.append(&sample("two")).unwrap();

    assert_eq!(engine.embed_pending(&embedder).unwrap(), 2);
    assert_eq!(
        engine.embed_pending(&embedder).unwrap(),
        0,
        "already-embedded records are not re-embedded"
    );
}

#[test]
fn malformed_vectors_are_rejected() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    engine.append(&sample("anything")).unwrap();
    assert!(matches!(
        engine.embed_pending(&BrokenEmbedder),
        Err(arc_memory::Error::InvalidVector)
    ));
}

#[test]
fn hybrid_search_fuses_and_dedupes() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    let embedder = HashingEmbedder { dim: 64 };
    engine.append(&sample("beacon flare protocol")).unwrap();
    engine.append(&sample("unrelated buffer note")).unwrap();
    engine.embed_pending(&embedder).unwrap();

    let hits = engine
        .hybrid_search(&scope("proj-1"), &embedder, "beacon flare", 10)
        .unwrap();

    // The record matches both the lexical and semantic lists but must appear once.
    let matches = hits
        .iter()
        .filter(|h| h.record.text == "beacon flare protocol")
        .count();
    assert_eq!(
        matches, 1,
        "a record in both lists is fused, not duplicated"
    );
    assert_eq!(hits[0].record.text, "beacon flare protocol");
    assert_eq!(hits[0].reason, "hybrid");
}

#[test]
fn captures_analyst_and_vision_roles() {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    for role in [Role::Analyst, Role::Vision] {
        let mut record = sample("reconciliation note");
        record.role = role;
        record.session_id = format!("sess-{role:?}");
        let got = engine.inspect(&engine.append(&record).unwrap()).unwrap();
        assert_eq!(got.role, role);
    }
}

#[test]
fn data_survives_engine_reopen() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("memory.db");
    let id = {
        let engine = Engine::open(&db).unwrap();
        engine.append(&sample("durable across restart")).unwrap()
    }; // engine dropped: connection closed, WAL checkpointed on close
    let reopened = Engine::open(&db).unwrap();
    assert_eq!(
        reopened.inspect(&id).unwrap().text,
        "durable across restart"
    );
    let sessions = reopened.session_list("proj-1").unwrap();
    assert_eq!(sessions[0].record_count, 1);
}

#[test]
#[ignore = "measurement; run explicitly with `--ignored --nocapture`"]
fn measure_retrieval_latency() {
    use std::time::Instant;
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    let embedder = HashingEmbedder { dim: 384 };
    let n = 5000usize;
    for i in 0..n {
        let mut r = sample(&format!(
            "record {i} hydrogen bond ligand pocket residue Asp{} chain {}",
            i % 97,
            (b'A' + (i % 4) as u8) as char
        ));
        r.session_id = format!("s{}", i % 10);
        engine.append(&r).unwrap();
    }
    let embedded = engine.embed_pending(&embedder).unwrap();
    let sc = scope("proj-1");
    let pct = |mut v: Vec<u128>, p: usize| {
        v.sort();
        v[v.len() * p / 100]
    };
    let bench = |label: &str, f: &dyn Fn()| {
        let mut t = Vec::new();
        for _ in 0..100 {
            let s = Instant::now();
            f();
            t.push(s.elapsed().as_micros());
        }
        eprintln!(
            "{label}: p50={}us p95={}us (n={n})",
            pct(t.clone(), 50),
            pct(t, 95)
        );
    };
    eprintln!("indexed {embedded} embeddings, dim=384");
    bench("lexical", &|| {
        engine.search(&sc, "hydrogen ligand", 10).unwrap();
    });
    bench("semantic", &|| {
        engine
            .semantic_search(&sc, &embedder, "hydrogen bond pocket", 10)
            .unwrap();
    });
    bench("hybrid", &|| {
        engine
            .hybrid_search(&sc, &embedder, "hydrogen bond pocket", 10)
            .unwrap();
    });
}
