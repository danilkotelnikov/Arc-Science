# Review of the product recovery plan

Date: 20 September 2026. Reviewer: separate read-only Codex CLI process on the
candidate plan. Initial verdict: **revise before handoff**. The reviewer did not
edit code or plan files. The lead checked each finding against source and amended
the plan; the outcome here is a reviewed planning artifact, not product acceptance.

| Finding | Integrated correction |
| --- | --- |
| Research's old nonlinear-response goal could be submitted as if user-authored. | First-run goal must be empty; an example requires explicit selection, verified on a cold launch and in the resulting mission. |
| Native WebView token handoff lacked a threat model. | Added a required host-to-view security design: page/process binding, same-origin and redirect rules, CSRF/script threats, lifetime, rotation and tests. If that contract cannot be met, manual unlock stays in place. |
| Offline create/start could be mistaken for scientific inference. | Browser matrix distinguishes the labelled synthetic fixture from live provider execution and its unavailable state. |
| Removing Python after generic tests could regress science and evidence. | Every module migration must compare schema, numerical output, source and artifact hashes, claim scope, provenance, cancellation/restart, error codes and resource limits on frozen cases, followed by independent review. |
| Contact updates were being treated as evolving trajectories. | Added a separate multi-frame trajectory acceptance gate for stable atom identities, frame order, replay, backpressure, camera preservation and provenance. |

Independent review could not run Git status inside its read-only tool context. The
lead verified the working tree separately: only this planning document, the HoH
index and this review were changed. No product source, secret or configuration was
edited in this loop. UX, scientific stack, connector and launcher assessments were
also independent read-only planning lanes; their findings are in the plan.

Remaining decisions for the next development turn are the exact implementation of
the native session broker after its security spike and the user-facing design choice
between the two restrained shell layouts. The target architecture is Rust/C++ core
with Blender as an external renderer, as selected by the user.
