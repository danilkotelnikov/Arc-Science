//! Behavior tests for the stdio worker protocol (`arc-memory/1`).
use arc_memory::{Engine, Worker};
use std::io::Cursor;
use tempfile::tempdir;

fn worker() -> Worker {
    let dir = tempdir().unwrap();
    let engine = Engine::open(dir.path().join("memory.db")).unwrap();
    // Keep the tempdir alive for the worker's lifetime via a leaked handle: the
    // database file only needs to exist for the duration of the test process.
    std::mem::forget(dir);
    Worker::new(engine, None)
}

fn call(worker: &Worker, json: &str) -> serde_json::Value {
    serde_json::to_value(worker.handle_bytes(json.as_bytes())).unwrap()
}

const RECORD: &str = r#"{"op":"append","record":{"project_id":"p","session_id":"s",
    "agent_id":"planner","role":"planner","text":"hydrogen bond note","source_uri":null,
    "trust":"model_output","compaction_epoch":0,"wall_time_ms":1,"idempotency_key":null}}"#;

#[test]
fn append_then_inspect_over_json() {
    let worker = worker();
    let appended = call(&worker, RECORD);
    assert_eq!(appended["status"], "ok");
    let id = appended["data"]["record_id"].as_str().unwrap().to_string();

    let inspected = call(
        &worker,
        &format!(r#"{{"op":"inspect","record_id":"{id}"}}"#),
    );
    assert_eq!(inspected["data"]["text"], "hydrogen bond note");
    assert_eq!(inspected["data"]["role"], "planner");
}

#[test]
fn search_over_json() {
    let worker = worker();
    call(&worker, RECORD);
    let found = call(
        &worker,
        r#"{"op":"search","scope":{"project":"p","session":null,"agent":null},
            "query":"hydrogen","limit":10}"#,
    );
    assert_eq!(found["status"], "ok");
    assert_eq!(found["data"].as_array().unwrap().len(), 1);
}

#[test]
fn health_reports_protocol_version() {
    let health = call(&worker(), r#"{"op":"health"}"#);
    assert_eq!(health["status"], "ok");
    assert_eq!(health["data"]["protocol"], "arc-memory/1");
    assert_eq!(
        health["data"]["retrieval_modes"],
        serde_json::json!(["lexical"])
    );
}

#[test]
fn stats_over_json_report_storage_and_retrieval_modes() {
    let worker = worker();
    call(&worker, RECORD);
    let stats = call(&worker, r#"{"op":"stats"}"#);
    assert_eq!(stats["status"], "ok");
    assert_eq!(stats["data"]["counts"]["records"], 1);
    assert_eq!(
        stats["data"]["bytes"]["blobs_raw"],
        "hydrogen bond note".len()
    );
    assert_eq!(
        stats["data"]["retrieval_modes"],
        serde_json::json!(["lexical"])
    );
    assert_eq!(stats["data"]["last_capture_ms"], 1);
    let sessions = call(&worker, r#"{"op":"session_list","project":"p"}"#);
    assert_eq!(sessions["data"][0]["last_capture_ms"], 1);
}

#[test]
fn rejects_unbounded_search_and_reversed_session_ranges() {
    let worker = worker();
    for op in ["search", "semantic", "hybrid"] {
        for limit in [0, 101, usize::MAX] {
            let response = call(
                &worker,
                &format!(
                    r#"{{"op":"{op}","scope":{{"project":"p"}},"query":"bond","limit":{limit}}}"#
                ),
            );
            assert_eq!(response["status"], "error");
            assert!(response["error"].as_str().unwrap().contains("limit"));
        }
    }
    let response = call(
        &worker,
        r#"{"op":"session_fetch","project":"p","session":"s","from_seq":10,"to_seq":1}"#,
    );
    assert_eq!(response["status"], "error");
}

#[test]
fn outbound_frames_have_the_same_bound_as_inbound_frames() {
    let mut output = Vec::new();
    assert!(arc_memory::write_frame(&mut output, &vec![b' '; 16 * 1024 * 1024 + 1]).is_err());
    assert!(
        output.is_empty(),
        "reject before writing any part of the frame"
    );
}

#[test]
fn unknown_op_returns_error_not_panic() {
    let bad = call(&worker(), r#"{"op":"nonsense"}"#);
    assert_eq!(bad["status"], "error");
}

#[test]
fn semantic_without_embedder_reports_error() {
    let worker = worker();
    call(&worker, RECORD);
    let resp = call(
        &worker,
        r#"{"op":"semantic","scope":{"project":"p","session":null,"agent":null},
            "query":"bond","limit":5}"#,
    );
    assert_eq!(resp["status"], "error");
    assert!(resp["error"].as_str().unwrap().contains("embedder"));
}

#[test]
fn frames_round_trip_and_signal_eof() {
    let mut buffer = Vec::new();
    arc_memory::write_frame(&mut buffer, b"payload-one").unwrap();
    arc_memory::write_frame(&mut buffer, b"payload-two").unwrap();

    let mut cursor = Cursor::new(buffer);
    assert_eq!(
        arc_memory::read_frame(&mut cursor).unwrap().unwrap(),
        b"payload-one"
    );
    assert_eq!(
        arc_memory::read_frame(&mut cursor).unwrap().unwrap(),
        b"payload-two"
    );
    assert!(arc_memory::read_frame(&mut cursor).unwrap().is_none());
}

#[test]
fn serve_loop_answers_each_framed_request() {
    let worker = worker();
    let mut input = Vec::new();
    arc_memory::write_frame(&mut input, RECORD.as_bytes()).unwrap();
    arc_memory::write_frame(&mut input, br#"{"op":"health"}"#).unwrap();

    let mut output = Vec::new();
    arc_memory::serve(&worker, &mut Cursor::new(input), &mut output).unwrap();

    let mut reader = Cursor::new(output);
    let first = arc_memory::read_frame(&mut reader).unwrap().unwrap();
    let second = arc_memory::read_frame(&mut reader).unwrap().unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&first).unwrap()["status"],
        "ok"
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&second).unwrap()["data"]["protocol"],
        "arc-memory/1"
    );
}

#[test]
fn worker_binary_serves_over_stdio() {
    use std::process::{Command, Stdio};

    let dir = tempdir().unwrap();
    let db = dir.path().join("memory.db");
    let mut child = Command::new(env!("CARGO_BIN_EXE_arc-memory-worker"))
        .arg("--data")
        .arg(&db)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    {
        let mut stdin = child.stdin.take().unwrap();
        arc_memory::write_frame(&mut stdin, br#"{"op":"health"}"#).unwrap();
    } // dropping stdin closes it, signalling EOF to the worker

    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "worker exited non-zero");
    let mut cursor = Cursor::new(output.stdout);
    let frame = arc_memory::read_frame(&mut cursor).unwrap().unwrap();
    let value: serde_json::Value = serde_json::from_slice(&frame).unwrap();
    assert_eq!(value["data"]["protocol"], "arc-memory/1");
}

/// Every error names its cause as a machine `kind`, so a caller never has to guess
/// a corrupt record from a read-budget refusal or a storage failure.
#[test]
fn errors_carry_a_machine_kind_for_their_cause() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("memory.db");
    let worker = Worker::new(Engine::open(&path).unwrap(), None);
    call(&worker, RECORD);
    let fetch = r#"{"op":"session_fetch","project":"p","session":"s"}"#;
    let kind = |response: serde_json::Value| {
        assert_eq!(response["status"], "error");
        response["kind"].as_str().unwrap_or("<missing>").to_owned()
    };

    assert_eq!(
        kind(call(&worker, r#"{"op":"inspect","record_id":"nope"}"#)),
        "not_found"
    );
    assert_eq!(kind(call(&worker, r#"{"op":"nope"}"#)), "bad_request");
    assert_eq!(
        kind(call(
            &worker,
            r#"{"op":"semantic","scope":{"project":"p","session":null,"agent":null},"query":"q","limit":1}"#
        )),
        "unsupported"
    );

    let tamper = |sql: &str| {
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute(sql, [])
            .unwrap()
    };
    tamper("UPDATE blobs SET original_size = original_size - 1");
    assert_eq!(kind(call(&worker, fetch)), "corrupt");
    // A negative stored size can only come from tampering, never from a budget.
    tamper("UPDATE blobs SET original_size = -1");
    assert_eq!(kind(call(&worker, fetch)), "corrupt");
    tamper("UPDATE blobs SET original_size = 9000000");
    assert_eq!(kind(call(&worker, fetch)), "read_budget");
}

/// Tampered blob bytes fail zstd decoding before the digest check; that is a
/// corrupt record, not a storage failure, on every path that decodes a blob.
#[test]
fn tampered_blob_bytes_are_corrupt_not_storage() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("memory.db");
    let worker = Worker::new(Engine::open(&path).unwrap(), None);
    let record_id = call(&worker, RECORD)["data"]["record_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let fetch = r#"{"op":"session_fetch","project":"p","session":"s"}"#;
    let inspect = format!(r#"{{"op":"inspect","record_id":"{record_id}"}}"#);
    let db = rusqlite::Connection::open(&path).unwrap();
    let original: Vec<u8> = db
        .query_row("SELECT data FROM blobs", [], |row| row.get(0))
        .unwrap();
    let mut flipped_header = original.clone();
    flipped_header[0] ^= 0xFF;
    let truncated = original[..original.len() - 1].to_vec();
    let garbage = vec![0u8, 1, 2, 3];
    for (label, data) in [
        ("header", flipped_header),
        ("truncated", truncated),
        ("garbage", garbage),
    ] {
        db.execute("UPDATE blobs SET data = ?1", [&data]).unwrap();
        for request in [fetch, inspect.as_str()] {
            let response = call(&worker, request);
            assert_eq!(response["status"], "error", "{label} {request}");
            assert_eq!(response["kind"], "corrupt", "{label} {request}: {response}");
        }
    }
}
