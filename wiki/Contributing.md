# Contributing

Status: Works today. The full rules are in `CONTRIBUTING.md` in the main repository. This page is the short version.

## Before you start

Open an issue for a new feature and say what problem you have. Bug fixes and document fixes can go straight to a pull request.
Read [Build from source](Build-from-source) and [A review checklist](How-we-check-our-work).

## Set up

You need Node.js 22.19 or newer, Git and Python 3. Rust (`cargo`) is optional and runs `native/arc-validators`. CI runs Node.js 24 and stable Rust. The picture scan `test/image-scan.py` uses the standard library only. The brand file builder `brand/build_brand.py` also needs Pillow. Then:

```
npm test
```

It needs no original archive. It runs the syntax check, the rename map check, the icon color and header tests, all six Arc plugin test suites, the installer and native transition tests, and the privacy scan self-test. Run `cargo test --manifest-path native/arc-validators/Cargo.toml` when you touch `native/arc-validators`.
To test a change to a patch, build from the original archive and run `npm run test:archive`. See [Build from source](Build-from-source) and [Run the tests](Run-the-tests).

## Rules for a change

1. Keep a change small. One pull request, one purpose.
2. A build patch must count the places it changed and stop on a wrong count.
3. Add or update a check for the behavior you changed.
4. Never add the original app archive, files from an installed app, or binaries built from them.
5. Never add personal data: names, e-mail addresses, home paths, machine names, keys or tokens.
6. Run `npm run scan` before you push. It must report no findings.
7. Do not add a dependency for something a few lines can do.
8. Review every new picture by eye, then add its SHA-256 to `brand/pictures.json`.
9. Update the wiki page that describes your change, and its Status line.

## How to write

Short sentences, one idea each. Everyday words. Say what works today and what does not. For steps, use the imperative and keep each step under 20 words. No hype words and no emoji.

## The wiki

The pages in the `wiki/` folder of the main repository are the source of the GitHub wiki. The wiki is a separate Git repository. A maintainer copies the pages there.
Pages link to each other without the `.md` ending, as the wiki expects.

## Conduct and security

Follow `CODE_OF_CONDUCT.md`. Use GitHub's private vulnerability reporting once it is enabled for the repository, as `SECURITY.md` describes. Until then, open an issue without details.
