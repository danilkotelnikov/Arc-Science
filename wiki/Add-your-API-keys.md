# Add your API keys

Status: Partly. This is a feature of the original app, and the build keeps it. The steps come from the app's own text. They were not run on a fresh data folder for this page.

Arc Harness has no account of its own and no built-in model. You bring an API key from a model provider.

## Add a provider from the catalog

1. Open Settings and select Models. The page says "Enter your API keys to use models from the following providers."
2. Select Add model provider.
3. Pick a provider from the built-in catalog, such as OpenAI or Anthropic.
4. Enter your API key in the field "Enter your API key".
5. Choose the models to add. The list shows the models the provider has available.
6. Confirm with the button at the bottom of the dialog.

The Models page marks each provider as "API key configured" or "API key missing".

## Add a service that is not in the catalog

Choose the custom option, "Custom model API". It asks for:

- a name and a lowercase identifier for the provider,
- the base URL, which must be an HTTP or HTTPS address,
- the API protocol: Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses,
- the API key, or an empty field if the service authenticates another way,
- the models. Select "Fetch available models", or add model IDs by hand.

A custom provider needs a base URL and at least one model.

## Where the key is stored

The app saves the key in a plain YAML file named `.credentials.yaml` in your data folder. The data folder is `.arc` in your user folder.
The environment variable `ARC_HOME` can move it.
Not tested: no check saved a key or read the file. This comes from the app's own documentation of its credential store, in the package `@arc-harness/arc-credentials-local`.

The file is private to your operating system user. The agent's own shell commands run as you, so the agent can read it too.
[Privacy and security](Privacy-and-security) explains this. A storage that uses the system credential store is planned.

The first install copies your old `.dsh` folder to `.arc`. The key file is copied byte for byte, and `.dsh` stays as it was. Both folders can then hold your keys.

## Other places a key can come from

The app looks for a key in this order, and the first place with a value wins:

1. The stored file `.credentials.yaml`.
2. The environment the app was started from.
3. The `.env` file in the folder where the app was started.
4. The `.env` file in the data folder.

A key you save in Settings replaces an older value from the environment.
Not tested: this order comes from the app's own documentation. No check tested it.

## Keys and the repository

Never put a key in a file of this repository. The `.gitignore` excludes `.env`, `.env.*`, `*.pem`, `*.key` and `*.pfx`. The privacy scan looks for common key shapes.

## Next

[Models and providers](Models-and-providers) lists the providers the model catalog knows.
