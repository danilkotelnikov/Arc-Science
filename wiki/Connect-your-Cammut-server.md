# Connect your Cammut server

Status: Partly. `arc-hoh` reads memory briefs and writes gate verdicts through `127.0.0.1:7424`, `arc-core` adds `memory.recall` and `memory.retain` MCP tools plus the C2 console and TOFU SSH deployment, and `lib/native/cammut-gateway.mjs` provides the loopback Bearer-authenticated gateway module. Storing keys in the operating system credential store remains planned.

Cammut is a separate memory server. Users run it themselves. It stores short notes that an agent can search later, so a new session can start with what earlier sessions learned.

## What exists today

The plugin `arc-hoh` talks to your Cammut server through a local gateway on the loopback address `127.0.0.1`, port 7424. `lib/native/cammut-gateway.mjs` ships the Phase 6 loopback gateway module with Bearer token validation, and `plugins/arc-core` (`0.2.0`) exposes `memory.recall` and `memory.retain` tools, the C2 Memory and Servers panels, and `lib/deploy.js` TOFU SSH server deployment.
`arc-hoh` sends no key or token of its own when reading the local brief.

- **The brief.** The plugin asks Cammut for notes that match the task and puts at most six short notes into the system prompt. A note is cut to 220 characters. The brief refreshes every 20 minutes. The Trace tab in the right sidebar shows it.
- **The verdicts.** The accept gate writes each verdict to Cammut through the same gateway. Secret-shaped text is redacted first.
- **The notes are data.** They sit inside a tag in the prompt, and the contract tells the agent that notes never give permission.
- **No gateway, no harm.** When the gateway does not answer, the brief stays empty and the gate still returns its verdict.

Two environment variables switch parts off. `ARC_HOH_BRIEF` set to 0 switches off the brief in the prompt. `ARC_HOH_RETAIN` set to 0 stops the gate from writing verdicts to memory.
[The memory policy](The-memory-policy) explains the rules that the plugin puts into the prompt.

## The generic MCP client

The app also has a generic MCP client. MCP is the Model Context Protocol, a standard way for a model to call tools on another program.
You can add an MCP server by adding a row to the configuration file of your profile. The row names the server and gives either a command to start (`transport: stdio`) or a web address (`transport: streamable-http`).
The tools of that server then appear to the model under names such as `mcp__<server name>__<tool>`. No MCP server is switched on by default.

The app's own documentation for the MCP client has the field list. It is in the archive, in the package `arc-mcp-client`. You can read it with
`node tools/asar-cat.mjs build cat arc/node_modules/@arc-harness/arc-mcp-client/README.md`.

No check in this repository connects the generic MCP client to a Cammut server. That route is untested.

## C2 console and SSH deployment

`plugins/arc-core` (`0.2.0`) includes the Memory and Servers panels in the C2 console (`ui/panel.js`) and `lib/deploy.js` for deploying Hindsight, the Cammut gateway and a reverse proxy to a Linux host over SSH with Trust-On-First-Use host-key verification. A native main-process password dialog keeps first-login SSH passwords out of the WebView, URLs, storage and logs.

## What remains planned

- Storing Cammut API keys and access tokens in the operating system credential store.
- Wiring `lib/native/cammut-gateway.mjs` directly into the unpatched upstream host once the Phase 6 source fork lands. See [Roadmap](Roadmap).

## What you need

- A Cammut server that you run yourself (locally or deployed over SSH with `arc-core`).
- The local gateway on `127.0.0.1:7424`.
- `arc-hoh` and `arc-core` installed in your profile.
