# Fonts

Two families, each kept exactly as published. Neither is modified, subset or renamed; the
workbench only gives them metric overrides in `@font-face` (`apps/arc-science/web/src/theme/fonts.css`).

| Family | Used for | Terms |
|---|---|---|
| **Kyiv Type Sans** (variable: weight 0 to 1000, contrast, middle), `Kyiv Type Sans/KyivTypeSans-VarGX.ttf` | Every word of the interface, Latin and Cyrillic | Copyright © 2019 Dmitry Rastvortsev, made for the Kyiv city identity with Projector, Dmytro Bulanov Creative Büro and Banda Agency. The font's own licence field reads: "Freeware. Font free for commercial and non-commercial use. Must not be decompiled. NoDerivates." Its publisher calls Kyiv Type "absolutely free for any use" ([Rentafont](https://rentafont.com/fonts/kyiv-type-sans)). It is therefore loaded as the original file, never converted or subset. |
| **MuseoModerno** (variable: weight 100 to 900), `Museo Moderno/MuseoModerno.ttf` | The ARC SCIENCE wordmark, outlined into the logo files (Black, 900) | Copyright 2020 The MuseoModerno Project Authors, SIL Open Font License 1.1 (`Museo Moderno/LICENSE.txt`). |

Code and identifiers use Cascadia Mono, which ships with Windows and is referenced with
`local()`.

These fonts are third-party works under their own terms, not under the project's
CC BY-NC-SA 4.0 licence.
