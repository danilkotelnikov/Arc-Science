# Inherited Vedix verification

On 8 September 2026, the preserved plugin suite passed **443 tests**, with one NetworkX duplicate-backend warning, in 2.86 seconds. This is the scope of the earlier 443-test baseline, not the entire repository's test collection.

The broader repository-root suite returned **24 failed, 271 passed, 25 skipped and two warnings in 19.65 seconds**. It is not described as passing or silently omitted from the delivery record.

Both commands ran from the repository root using the existing Python 3.12.13 application environment:

```sh
python -m pytest plugins/vedix/tests -q
python -m pytest tests -q
```

## Failure diagnosis

| Count | Observed cause | Boundary |
| --- | --- | --- |
| 17 | HTTPX construction requires the missing optional `socksio` package for the environment's configured SOCKS proxy | Mocked adapter tests fail before their fake HTTP response is reached; no successful live request is inferred |
| 2 | `biber` executable is absent | Publisher pipeline dependency |
| 2 | `IEEEtran.cls` and `mdpi.cls` are absent | Inherited publisher-template distribution |
| 2 | Minimal LaTeX compilation fails; logs include missing `biblatex.sty` and Russian Babel support | Incomplete TeX environment |
| 1 | The inherited ACM template directory lacks its `latex` subdirectory | Template-scaffolding assertion |

No proxy was bypassed, optional template was fetched, external manuscript submitted, test weakened or legacy source changed to hide these failures. The raw output is retained in `evidence/verification/vedix-root-tests.log` in the development archive; the passing plugin run is `vedix-plugin-tests.log`.

## Source identity

Git tree identities match the original commit `8c5807f573ffb2731ee3232fcae91da1c26b47d7` and the development branch before native integration:

| Tree | Original and current object ID |
| --- | --- |
| `tests` | `5ee19ddd7558cc372fbd977c91b4608dc9f82049` |
| `plugins` | `d3d85e88755aadaa3e132e0b1a38c32dfbd5b621` |

This establishes unchanged tracked legacy source and tests. It does not establish a working publisher deployment or an all-green root suite. Arc's separate application, frontend, native and installed-wheel checks must be reported under their own commands.
