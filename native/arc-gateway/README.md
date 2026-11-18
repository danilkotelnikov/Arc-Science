# arc-gateway

arc-gateway is the small local server that sits between Arc Harness and the model providers. Apps talk to `http://127.0.0.1:7424`; the gateway adds the API keys, so keys never sit in app settings. It also keeps one door open to Cammut, our memory and tool hub.

It is one Windows program with no runtime to install. It starts at logon and comes back by itself if it stops.

## What it does

- Routes `/<prefix>/...` to each provider you list and adds that provider's key.
- Adds Anthropic prompt-cache marks, up to the four Anthropic allows.
- Keeps Gemini tool-call signatures between turns, so long tool sessions do not break.
- Sends again without `reasoning_effort` or cache marks when a model refuses them.
- Forwards `/cammut/mcp` to Cammut and trims long memory answers to a size budget.
- Refuses requests from web pages and from other host names.

## Install

```
go build -trimpath -ldflags "-H=windowsgui -s -w" -o arc-gateway.exe .
arc-gateway.exe install
```

`install` puts a shortcut in your Startup folder and starts the gateway now. `uninstall` removes the shortcut.

## Settings

Copy `gateway.example.json` to `%USERPROFILE%\.arc\gateway.json` and keep the routes you use. Keys go in `%USERPROFILE%\.arc\.credentials.yaml` under `refs:`, or in the settings page at `http://127.0.0.1:7424/settings`. Saving there needs the token in `.arc\.gateway-token`.

A route can carry `defaultReasoningEffort` (`low`, `medium` or `high`, in lower case). The gateway adds it to a chat request that names no effort. An effort the app sends, or `forceReasoningEffort`, always wins. `off`, or a word the gateway does not know, adds nothing. Routes without the field, and Anthropic routes, are left as they are. The example sets `low` on `/vertex/v1`, because Gemini routes start at low effort unless a model card says otherwise.

`cammut.upstreams` lists Cammut addresses in order. The gateway tries the next one only when a connection fails.

## Check

```
arc-gateway.exe status      # prints /health
go test ./...               # unit and proxy tests, about 3 s
```

The log is `%USERPROFILE%\.arc\logs\arc-gateway.log`.
