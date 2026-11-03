# Contributing

Thank you for helping. This page tells you how to change the kit, what to run before you open a pull request, and what we do not accept.

## Before you start

- Open an issue first for a new feature. Say what problem you have and what you want to change.
- Bug fixes and documentation fixes can go straight to a pull request.
- Read the wiki pages "Build from source" and "A review checklist".

## Set up

You need Node.js 24, Git and Python 3. The Python scripts use the standard library only, so nothing needs installing.

```
git clone <your fork>
cd <the folder>
npm test
```

`npm test` needs no original archive. It checks syntax, the brand rules, the scans' self-checks, the brand file hashes, the test-home helper and the privacy scan.

To test a change to a build patch, you need the original archive. The wiki page "Build from source" shows how to get it.
Then run `node tools/build.mjs` and `npm run test:archive`.

## Rules for a change

1. Keep a change small. One pull request, one purpose.
2. Every build patch in `tools/build.mjs` must count the places it changed and stop when the count is wrong.
3. Add or update a check for the behavior you changed. A check that cannot fail does not count.
4. Never add the original app archive, any file from an installed app, or any binary built from them.
5. Never add personal data: no names, e-mail addresses, home paths, machine names, keys or tokens.
6. Run `npm run scan` before you push. It must report no findings.
7. Do not add a dependency for something a few lines can do. The kit has none today.
8. Review every new picture by eye. Add its SHA-256 to `brand/pictures.json` only after you have looked at it. A picture that shows the old vendor's mark goes in the `whale` list with a replacement.
9. Update the wiki page that describes what you changed, and its "Status" line.

## Writing style

- Write short sentences. One idea each.
- Use everyday words. Explain a technical term the first time.
- Say what works today and what does not. Never describe a feature that does not exist.
- For steps, use the imperative: "Open Settings." Keep each step under 20 words.
- Skip hype words and emoji.

## Wiki

The `wiki/` folder holds the pages of the GitHub wiki. The wiki is a separate Git repository. A maintainer copies the pages there.
Wiki pages link to each other without the `.md` ending, because the wiki expects that.

## Commits and pull requests

Write a commit message that says what changed and why. Fill in the pull request template. By sending a pull request you agree
that your contribution is licensed under the MIT license in [LICENSE](LICENSE).

## Conduct

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security problems as described in [SECURITY.md](SECURITY.md).
