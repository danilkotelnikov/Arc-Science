# Arc Science

A self-hosted scientific assurance core with direct multimodal model transports, evidence-bound acceptance, BioRender MCP integration, and a data-preserving Blender job contract.

**Status: 0.1.0 research prototype.** This repository is a new isolated core. It is not the previously claimed Vedix patch, a completed hosted application, or a measured state-of-the-art scientific agent. It does not modify the remote Vedix repository.

## Install and test

```bash
python -m venv .venv
# Linux/macOS:
. .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -e '.[test]'
python -m pytest -q
python -m compileall -q src workers
python examples/offline_check.py
```

The dependency ranges describe compatibility, not bitwise-reproducible deployment. `evidence/environment.json` records the packages actually used for this verification. Production deployment must generate a complete platform-specific lockfile and container digest.

## Modules

| Module | Implemented responsibility |
|---|---|
| `contracts` | Closed immutable candidates, reviewer records, qualified seat references, display expectations |
| `store` | Hash-checked artifact snapshots and transactional, idempotent, project-scoped event ledger |
| `governor` | Required mechanical evidence, candidate/policy binding, coverage, independent-group and qualification checks |
| `transport` | Direct OpenAI Responses, Anthropic Messages and OpenClaw OpenResponses request dialects |
| `harness` | Concurrent isolated reviewers; controller-side salted commitments before reveal |
| `improvement` | Bounded evaluate–plan–build–re-evaluate cycle; immutable policy and scientific input boundary |
| `oauth` | Principal/project/issuer-bound, single-use PKCE authorization transaction handoff |
| `biorender` | MCP initialization, paginated discovery, schema pinning, validated calls and metered-action approvals |
| `raster` | Explicit all-page PDF rasterization with source/coverage manifest |
| `scene` | PDB/mmCIF identity selection, coherent residue-local alternate selection, layout auditing |
| `blender_worker` | Fixed Blender batch script for atoms and C-alpha traces, seeded rendering and provenance receipt |
| `planning` | Dependency-aware greedy parallel frontier, read/write conflict checks, context closure and evolution guard |

## Scientific acceptance boundary

`assess` returns `eligible_for_human_review`, never a claim of biological truth or publication permission. A mechanical check must reference the full candidate digest. The runtime must create those receipts from actual numerical, geometry and provenance checks. Never accept runtime receipts, seat qualifications, approval identities, endpoint configurations or evolution approvals from a model response.

Each direct visual review requires a `visual-brief.json` metadata artifact. The brief contains expected captions and scoped claim references for each image. Its bytes, source dependencies and all image bytes are included in the candidate identity. The model can check correspondence with the expected display, but cannot independently establish biological causality from a rendered image.

The qualified-seat registry is an operator input. A qualification digest records the identity of an external evaluation report; this prototype does not run that evaluation or establish that provider-family labels are statistically independent. Qualification expiry blocks use. Choose actual provider model IDs and validate their output identities in a live integration test.

## Direct model transport

Construct one `VisionClient` per trusted provider endpoint. Supply a credential resolver that obtains an `AccessGrant` from your server-side OAuth/secret broker and binds it to the human principal, project, endpoint and credential profile. Route each seat to its registered client. No model CLI, PTY or terminal session is launched.

The HTTP transports are contract-tested with `httpx.MockTransport`. They have not been exercised against paid live model accounts in this delivery. Consumer subscription tokens are not interchangeable with provider API authorization. OAuth is used only where the provider officially supports it; service/API credentials remain a distinct mode.

**OpenClaw:** its Responses endpoint has operator-level implications and accepts some fields it ignores. Put it behind a private broker. Disable execution tools in the selected reviewer agent and do not infer isolation from `tool_choice=none`, `store=false` or an arbitrary scope header. Model identity must be observable; a gateway returning only an agent alias is rejected until a trusted backend-identity adapter is supplied. The adapter defaults to independent requests with no shared session key. Disable cross-agent session access as well; stateless requests do not compensate for gateway-wide session-reading tools. Use separate gateway cells across untrusted boundaries.

## BioRender MCP

The standard connector declaration is in `config/mcp.json`:

```json
{
  "mcpServers": {
    "biorender": {
      "type": "http",
      "url": "https://mcp.services.biorender.com/mcp"
    }
  }
}
```

`BioRenderClient` implements a bounded request/response subset of MCP, including JSON and SSE replies. It discovers actual tools and pins their schemas; it does not invent an unrestricted SVG-export API. Use the mature official MCP SDK for a production host that needs the complete protocol, subscriptions or elicitation. This implementation is a tested policy reference around the available subset.

Deployment order:
1. Register the client using an authorization mechanism supported by BioRender and the selected host.
2. Obtain separate user consent for the Arc Science deployment. The connection in this chat is not transferable.
3. Resolve audience-bound access credentials server-side.
4. Initialize, discover, review and pin tool schemas.
5. Permit read-only search by default. Issue exact-argument, single-use approval for metered figure creation and credit-finalizing session retrieval.

The deprecated preview-confirmation operation is denied. Tool results remain untrusted content. A timeout after a metered action requires reconciliation rather than automatic resubmission. Figure assets need their own licence and attribution records; discovery of a template does not grant redistribution rights.

The live BioRender app in this conversation successfully searched public templates. Arc Science's own OAuth callback, token exchange and production connection have not been completed. `oauth.py` is a transaction-binding component, not a complete identity provider, token vault, discovery implementation or authorization server.

## Molecular rendering

`prepare_atomic_scene` parses supplied PDB or mmCIF bytes with Gemmi. Callers must resolve the desired assembly before submission. It validates the requested chain and ligand, preserves original atomic coordinates and source identity, selects one alternate label per residue, and labels coordinates as experimental, predicted or docked.

`BlenderJob.write()` writes a hash-bound job. `BlenderJob.argv()` returns fixed batch arguments for the packaged worker. Execute these only in an isolated rendering worker; never allow a model to supply arbitrary Python or Blender scripts. A noninteractive render subprocess is distinct from a model terminal session.

The current Blender worker implements atom instances and a C-alpha trace. It does not implement MolecularNodes cartoons/surfaces, complete assemblies, chemical interaction inference, optimized camera search or publication-quality editorial composition. Blender was unavailable here: the script was syntax-checked and the job contract was tested, but no Blender render was executed.

Recommended next renderer: a pinned MolecularNodes backend with residue/atom mappings and pass receipts. Evaluate Blender Gala as an optional publication-style layer. Preserve a neutral scientific view beside aesthetic renders.

## Deployment prerequisites not included

A HeroUI v3 application, hosted OIDC login, encrypted refresh-token vault, true tenant isolation, per-job sandboxing, durable mission service, integrated scientific calculators, a full scene compiler, native PPTX/SVG export, live model calibration and protected benchmark evaluation are not implemented in this core. The architecture report specifies these boundaries and release gates.

The local event hash chain detects accidental/unauthorized edits relative to a trusted store, but is not a signature, trusted timestamp or protection against a privileged database administrator. Credentials and patient data must not be written to events. Production requires authenticated services, externally anchored audit receipts, restricted egress and a documented deletion/retention policy.

## Verification

See `evidence/verification.json`, `evidence/pytest-final.log`, `evidence/environment.json`, and the red/green regression logs. Each test-run claim is scoped to this new package. Network tests are mocked unless explicitly marked live. No external repository change, live model pass, live OAuth consent, Blender output or benchmark superiority is implied.
