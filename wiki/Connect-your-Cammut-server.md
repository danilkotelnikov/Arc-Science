# Connect your Cammut server

Status: Partly. The plugin `arc-hoh` already reads notes from a Cammut server and writes gate verdicts to it through a local gateway. The Cammut client tab is Planned. Arc Harness has no Cammut tab and no setting for a server address, an API key or a token today.

Cammut is a separate memory server. Users run it themselves. It stores short notes that an agent can search later, so a new session can start with what earlier sessions learned.

## What exists today

The plugin `arc-hoh` talks to your Cammut server through a local gateway on the loopback address `127.0.0.1`, port 7424. The gateway is a separate program. This repository does not contain it.
The plugin sends no key or token of its own to the gateway.

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

## What is planned

A tab inside Arc Harness, called the Cammut client tab. The tab would have three fields:

1. **Server address.** The web address of your own Cammut server.
2. **API key.** The key your Cammut server asks for.
3. **Token.** An access token, only if your server needs one.

Besides the fields, the tab would show whether the connection works. It would let you pick the memory scopes the agent may use.
It would also show the memory policy that applies.

A first run on an empty profile should connect to a test server, recall a note and store a note. That is the planned proof for this step.
The roadmap item "Cammut client tab" covers it. See [Roadmap](Roadmap).

Keys and tokens are planned to go into the system credential store.

## What you will need

- A Cammut server that you run yourself.
- The local gateway on port 7424, which exposes it to the plugin.
- The plugin `arc-hoh` in your profile.

## Why the tab is not built yet

The built-in memory gateway and the client tab depend on earlier roadmap items. The package model has to change first, and the memory policy needs a decided default text.
