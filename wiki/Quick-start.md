# Quick start

Status: Partly. The screens and labels on this page come from the text of the app. The lean core and the Trace tab are checked by `node test/ui-crawl.mjs --lean`. A fresh, empty data folder was not started for this wiki.

You have built and installed the app. See [Install](Install). This page walks you through a first session.

## Before the first session

1. Start the app.
2. Open Settings. It is the last item at the bottom of the left sidebar.
3. Select Models.
4. Add a model provider with your API key. [Add your API keys](Add-your-API-keys) has the steps.

Without a provider the app shows the message "Configure a model provider to start building."

## Your first session

1. Select New session in the sidebar.
2. Pick or add a workspace folder in the menu above the text box. The agent works inside it.
3. Open the Access mode control inside the text box. The default is Workspace Write.

   In this preset the agent writes inside the workspace and permitted temporary folders. A wider retry needs your approval.
   The preset "Full access" reduces confirmation steps and lets the agent do more on its own. Choose it only when you trust the task.
4. Type your task in the text box. It says "Describe what you want to build, / commands, @ files or sessions".
5. Select the round arrow button to send it.

Type `/` to see commands. Type `@` to point at a file or another session.

The lean core has no mode menu. The old Standard, Minimal, Creator and PTC modes and the Agent presets page are gone.

## What you see while the agent works

The agent writes its answer in the conversation and shows the steps it takes. A small pulsing cube is the running indicator. The label reads "Thinking" and then "Thinking for" with the elapsed time.

## The right sidebar and the Trace tab

Select "Open right sidebar". With the plugin `arc-hoh` installed, the sidebar has a Trace tab. It shows the Harness of Harness ledger, newest first, with the chain check, and the memory brief the agent reads. It only reads.

## What the lean core leaves out

The lean core has no Plugins page, no Automation tasks, no Context Insights and no skills screens. Plugins are installed by copying. See [Plugins and why the package model goes away](Plugins-and-why-the-package-model-goes-away).

## Settings worth knowing

The lean core keeps two settings pages: General and Models.

- **General, Permission.** The default permission mode for new sessions.
- **General, Appearance.** Light, Dark or System. A new data folder starts in Light.
- **General, Font size.** Affects the conversation text only.
- **Models.** Your providers and keys.

## Next

[Add your API keys](Add-your-API-keys), [Models and providers](Models-and-providers), [Privacy and security](Privacy-and-security).
