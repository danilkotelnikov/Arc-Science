# Models and providers

Status: Partly. The provider catalog and the settings page come from the original app. Run `npm run test:archive` yourself to check your build. The kit tests no provider by itself. The desktop journey sends one real message through a provider you set up.

Arc Harness talks to a model through a provider. A provider is a company or a service that runs models and charges for them through an API.
You enter your own API key for each one. See [Add your API keys](Add-your-API-keys).

## The built-in catalog

The app carries a catalog of providers and their models. The catalog comes from a third-party library inside the archive.
It holds modules for these providers, among others:

- Anthropic, OpenAI, Google Gemini and Google Vertex
- Amazon Bedrock and Azure
- Mistral, Groq, Cerebras, Fireworks, Together and Baseten
- OpenRouter, Vercel AI Gateway and Cloudflare AI Gateway
- xAI, NVIDIA, Hugging Face and GitHub Copilot
- Moonshot AI, Kimi, MiniMax, Qwen, Xiaomi and Z.ai

The settings page lets you add any of them. Once all are configured, the page says "Every catalog provider is already configured."

## What changed from the original

The original app registered a direct vendor provider. The build removes it from the registry.
The original also asked you to sign in or enter a key in a welcome window. The build skips that window at startup.

Real model names still appear in model lists, because they are names of models. The ids of real models in the third-party catalog stay as they are. You can reach such a model through a provider that serves it, for example a gateway.
We did not test which gateways serve which models.

## Google Vertex AI

Vertex runs through a local gateway. That gateway is a separate small program and is not in this repository yet. It turns your saved Google login into a short-lived access token and keeps it in memory only.

1. Run `gcloud auth application-default login` once.
2. Write your project and location into `vertex.json` in your data folder.
3. Add a custom provider with the base URL `http://127.0.0.1:7424/vertex/v1`.

Model ids take the form `google/<model>`. Use a model that your project can reach.

## Anthropic

Open Settings, select Models, and add `anthropic` from the provider list. Paste your key. The key goes to the app's credential store and is never shown again.

## Custom providers

A custom provider needs a base URL and at least one model. It speaks one of three API protocols: Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses.
Use it for a service that is not in the catalog, or for a gateway you run yourself.

## Reasoning levels

Some models offer reasoning levels. The settings page has a section "Reasoning levels" and the option to turn them off.
The General settings have a switch that shows the reasoning-effort slider in the model menu.

## Choosing a model

Select the model menu in the text box of a session. Its label is "Select model". It lists the models of your configured providers.
The default model is set by a row named `agent-default-model` in the configuration file of your profile. The row has the fields `provider` and `model`.

## Where the configuration lives

The Settings page has the button "Open configuration file". It opens the configuration file of your profile. Each profile lives in `profiles/<name>/` inside your data folder, which is `~/.arc` or the folder that `ARC_HOME` names.
[Glossary](Glossary) explains the words data folder and profile.
