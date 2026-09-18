# Interactive browser acceptance — 18 September 2026

Method: the supported browser tool's Playwright locator surface against the compiled
workbench at `http://127.0.0.1:8091/`, with isolated qualification data. Actions used
visible controls; no generated end-to-end script or direct API call supplied these
UI observations. Code-level tests are reported separately. Native-window UI is a
separate unverified surface because its automation is not enabled here.

| Flow | Observed result |
| --- | --- |
| Research create/start, offline default | Completed mission `1e8bc1e9d3e34297ba0447b3ed1fa001` with linear, quadratic and shuffled-control branches; 3 actions, 7 scripted-role calls, 2 generated images. |
| Decision routes/reconciliation | Linear branch challenged; quadratic branch supported with exploratory-only caveats; parent links and focus-change history visible. |
| Verify and recompute | `integrity=true`, `reproduction_passed=true`, 3 computations and 2 artifacts reproduced, no failures, valid evidence graph, scientific validity explicitly false. |
| Round budget | Mission `85eb5094a2d245d489984ed689ab4148` stopped at one round as `budget_exhausted`; alternatives unresolved; Resume disabled. |
| Cancellation | Visible Cancel changed the bounded mission to `cancelled`; late-result fencing message appeared; Cancel and Resume disabled. This proves the UI cancellation transition, not cancellation of a still-running native computation. |
| Memory capture | Completed mission appeared as 18 records across epochs 0–2 before the memory reliability changes. |
| Memory default retrieval (before fix) | Reproduced failure: default Hybrid search for `quadratic` returned409, `no embedder configured`. |
| Lexical retrieval | Selecting lexical and searching `quadratic` returned5 mission passages with role/source/trust metadata. |
| BioArt offline miss | Visible409 correctly required explicit egress consent. |
| Capsule export | Browser event observation timed out, but exact mission ZIPs were delivered to Downloads: 49,817 and 25,239 bytes for the two named missions. Delivery was verified from those files; no fallback API download was used. |

The raw verification JSON dominated the Research result view. A compact summary
with expandable details was requested from the frontend developer as a usability fix.
The compact summary and expandable details are implemented and covered by interaction
tests. Post-fix browser checks follow.

| Post-fix flow | Observation |
| --- | --- |
| Memory restart/recovery | Both missions remained available; completed session had 19 records including its status snapshot, cancellation session 9; capture ready/0 pending. |
| Capability/default | Lexical selected; semantic/hybrid disabled with no-embedder explanation. |
| Range/paging | Selected sequence 1..1, next/previous round trip, one record loaded; bounded range controls remained available. |
| Retention | Removed one qualification record from retrieval; loaded count became 0 and total-active count 19→18. UI explicitly says stored history is not erased. |
| Search scope | All-session and selected-session keyword search worked; selected quadratic search returned 5 passages. |
| Credentials | Replacing a token and keyboard-clearing a valid token removed loaded session identities/results. No private records returned without another authenticated load. |
| NIH inspection | Entry 18 live inspection exposed creator, Public Domain metadata, citation and 11 representations; consent cleared. Subsequent inspection succeeded with consent unchecked from cache. |
| NIH source | Entry 18/group 62/file 626850 fetched and verified, 8,373 bytes; SHA-256 `deae8113d2416bf6497d6fd43bb995305824f56ec25f1bfd9960616e499dcade`. Browser-delivered `bioart-18.svg` matches. Offline fetch reuse succeeded. |
| Unsupported NIH import | UI clearly labelled source download-only, displayed finite-pixel-dimension limitation, provided original download and disabled SVG import. No preview/import bypass was attempted. |
| Molecular active cancel | File chooser selected deposited 1DQJ, chains A/B+C, assembly 1; active job `59e854d7b6e9449e81091830382b2350` reached cancelled and exposed no completed artifacts. |
| Molecular complete path | Actual file-picker submission, 640 px/1 sample/seed 23, job `c970ebc66242488eb8d2543c03b5f92e` completed with 49 contacts and authenticated collage. Browser download: 111,545 bytes, SHA-256 `51be09ddd592e2fe5fb0ccdc3d5378f749a42e5c6aed9713a460ac3917c9f24e`. |
| Frozen example | Returned from generated result, selected Interface, increased zoom to 125%; annotated interface remained available. |

Limits: no live model/vision credentials, biological benchmark or semantic embedder
was provisioned. NIH dynamic keyword search remains unsupported by its static-response
adapter; direct entry inspection is the supported path. Native WebView interaction
was not tested: automatic approval review rejected the shell GUI launch with only
`blocked by policy`. Headless native checks do not substitute for that UI evidence.
