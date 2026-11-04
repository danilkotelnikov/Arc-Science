# Security policy

## Report a problem

Use GitHub's private vulnerability reporting once it is enabled for the repository. Open the Security tab and choose "Report a vulnerability".
Until it is enabled, open an issue without details and ask for a private way to send them. Do not post keys, tokens or personal paths in a report.

A good report says what you did, what you expected, what happened, and which build you used. The file `BUILD.json`
next to your built archive holds the build's SHA-256.

## What is in scope

- The build kit in this repository: scripts that read or write files, handle paths, or run other programs.
- A build that connects to a host other than your own machine without you asking for it.
- A build that stores or sends keys, tokens or personal data in a way the documents do not describe.
- Files in this repository that hold personal data or a secret.

## What is out of scope

- Problems in the original app, in Electron or in Chromium. Report them to their maintainers.
- Problems in the third-party packages inside the app archive. Report them to the package's authors.
- The fact that agent tool processes can read the credential file. The page "Privacy and security" in the wiki explains it.

## Supported versions

Only the newest tagged release of this kit gets fixes. The kit works with version 0.2.1-rc.5 of the original app only.

## What to expect

Maintainers read reports as they arrive. There is no fixed response time. When a fix is released, the report is credited
if the reporter agrees.
