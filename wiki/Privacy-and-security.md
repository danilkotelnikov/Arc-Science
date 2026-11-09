# Privacy and security

Status: Partly. The checks below exist in this repository. No log of a run is attached, so run them yourself on your own build. Some parts of the app were read from the code and never run.

Read this page before you give the app a key or a real project.

## What the agent can do

Arc Harness runs an AI agent on your machine. The agent can read files, change files, and run shell commands.
The permission mode of a session decides how far it may go without asking you.

- **Workspace Write** is the default. The agent writes inside the workspace and permitted temporary folders. A wider retry needs your approval.
- **Full access** reduces confirmation steps. The agent can then do more on its own, including sensitive operations, file changes and external commands.

Choose the mode on purpose. Point the workspace at a folder that holds only what the agent needs.
The agent's commands run as you. Whatever you can read, a command it runs can read.

## Where your keys are stored

When you add a model provider, the app writes the key to `.credentials.yaml` in your data folder, which is `~/.arc` or the folder that `ARC_HOME` names. The file is plain text.
It is private to your operating system user. The agent's tools run as that same user, so the agent can read the file.
The file cannot hide a key from the agent.

The first install copies your old `~/.dsh` folder to `~/.arc`, and the key file is copied byte for byte. `~/.dsh` stays as it was, so it can still hold a copy of your keys. Delete it yourself if you do not plan to roll back.

Planned work moves keys into the system credential store. See the item "Memory gateway" in the [Roadmap](Roadmap).

If you cannot accept this, use a provider key with a spending limit. Do not run the agent on a machine that holds other secrets.

## What the app sends over the network

Expect the connections you cause. These are calls to the model provider you configured and the web tools the agent uses.
The plugin `arc-hoh` also calls a local gateway on `127.0.0.1`, port 7424. That address is your own machine. What the gateway does next is up to the program you run there.
The build cannot promise that no other connection exists. See "What the checks cannot see" below.

The build removes the known connections of the original app to the vendor's services. The live network test checks this on your machine. We promise nothing beyond that.

| What | How it is removed |
|---|---|
| Vendor sign-in | The welcome window is skipped at startup. |
| Vendor telemetry and product analytics | Three telemetry rows are switched off. |
| Update feed | The update coordinator is off by default, and `install.mjs` removes `app-update.yml`. |
| Remote update policy | The field is removed from the app manifest. |
| Vendor addresses | Every address of a vendor service becomes `arc-harness.invalid`, which can never resolve. |
| Direct vendor provider | It is removed from the provider registry. |
| Package mirror in China | Its address becomes the public npm registry address. |

### How to check it yourself

- `node test/no-deepseek-net.mjs` counts vendor addresses in the archive, in both profiles, in the local plugins and in the installed runtime. It needs a real data folder. Set `ARC_HOME` if yours is not `~/.arc`.
- With `--live`, the same test starts the web profile on a throwaway data folder. It traces every outgoing connection of the Node host for a minute. It fails on any host that is not your own machine.
- Two text scans, `ui-strings` and `independent-scan`, look for old names in the text a person reads. `build-check` tests the build against the original. Run `npm run test:archive` for these two scans and the build check.
- The picture scan, `test/image-scan.py`, reads pictures by content and looks for the old whale or blue.

[Run the tests](Run-the-tests) has the commands.

### What the checks cannot see

- `test/desktop-journey.mjs` opens the desktop window and Settings; native menus, the skipped welcome window and the Inno Setup installer are not started in CI.
- The live trace sees Node connections only. A program that a plugin starts, such as a Python helper, is outside it.
- The text scans do not read pictures or the native files in `app.asar.unpacked`.
- The picture scan cannot read words drawn inside a picture. A plugin's asset folder can hold a screenshot that shows the old product name. The repository ships none.
- Plugins you install can connect anywhere. The build cannot check code you add later.

## What this repository stores

No keys, no personal data and no original app. The `.gitignore` excludes `.env`, `.env.*`, key files (`*.pem`, `*.key`, `*.pfx`), the private deny-list file, the original archive and every build.

## The privacy scan

`scripts/privacy-scan.mjs` is a scan without dependencies. Run it with `npm run scan` before you push. GitHub Actions runs it on every push.

- It looks for e-mail addresses, home paths that contain a user name, public IPv4 addresses, private key headers and token shapes. Token shapes include `sk-`, `ghp_`, `AKIA` and `AIza`.
- It skips the folders `.git`, `node_modules`, `_work`, `pristine` and `build`.
- It can also read a private deny-list. Set `ARC_PRIVACY_DENY` to the file, pass `--deny <file>`, or put `.arc-harness-privacy-deny.txt` in your home folder.
  The file has a `[hard]` and a `[brand]` section with one term per line. A hard term that appears anywhere fails the scan. A brand term is listed for a person to decide, and fails the scan only with `--strict-brand`.
- Deny-list terms are also matched inside binary files such as images, in UTF-8 and in UTF-16 form.
- It prints the file and line of each finding and the class. It never prints the matched text, so the scan output is safe to paste into an issue.

Run `node scripts/privacy-scan.mjs --help` for the details.

## Report a problem

The file `SECURITY.md` in the main repository has the policy. Use GitHub's private vulnerability reporting once it is enabled for the repository. Until then, open an issue without details.
Do not post keys or personal paths in a public issue.
