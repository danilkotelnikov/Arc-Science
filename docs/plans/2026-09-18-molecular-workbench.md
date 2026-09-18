# Molecular workbench continuation

Continue the existing Windows-native molecular workflow documented on 17–18 September.
The approved local-app direction and renderer already exist; this increment connects
them to the workbench without changing the scientific model or adding dependencies.

## Contract

- Keep the frozen public 1DQJ example and its original artifact bytes.
- Add an authenticated local render panel: coordinate file, antibody/antigen chains,
  assembly, and bounded rendering settings. Credentials remain in page memory.
- Configure the Blender Python interpreter on the server through
  `ARC_MOLECULAR_BLENDER_PYTHON`; requests cannot select executables or output paths.
- Store each upload and render in a fresh server-owned job directory. Run the existing
  molecular CLI in an isolated subprocess with one active job and a total deadline.
- Retain job state across service restarts; interrupted jobs are never labelled completed.
- Support explicit cancellation and service-shutdown cleanup. Publish only completed,
  hash-verified allowlisted artifacts through authenticated downloads.
- Display the white collage, source-bound metadata, and scientific limitations.
  Rendering is not scientific validation, visual acceptance, or publication approval.

## Acceptance

Backend tests cover authorization, bounded input, unavailable runtime, completion,
failure, concurrency, cancellation, restart recovery and artifact integrity/access.
Frontend tests exercise the real form, job status, authenticated preview/download,
failure and cancellation. Run the full Python and frontend suites and production build.
Exercise a real local Blender job if the retained runtime works; otherwise record
the exact missing qualification. Independently review the change before completion.

## Recovered context and collaboration

Claude sessions `18dc0b3f-fb45-45ba-a754-3599c864988f` and
`dc5a505b-9734-4946-bc1f-f3247be069dc` contain the original prompt, approved native
memory direction, Windows port handoff and outstanding molecular UI integration.
The two supplied ChatGPT share pages timed out through web retrieval and browser
access in this session; their full content has not been independently recovered.
Local Claude OAuth is authenticated, but both Opus and Sonnet assessment calls
returned `Credit balance is too low` before inference. No Claude review is claimed.
Continue with native Codex subtasks and preserve the failed call artifacts locally.
