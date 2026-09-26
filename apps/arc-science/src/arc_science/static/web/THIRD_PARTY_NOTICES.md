# Third-party notices

Arc Science is licensed under CC BY-NC-SA 4.0 (see LICENSE at the repository root). The
components below keep their own licences. npm, Python and Rust dependencies are listed with
their licences in their own package metadata.

# Gravity UI Icons

`web/src/theme/gravity-icons.jsx` contains path data for 36 icons copied unchanged from
the `svgs/` folder of the npm package `@gravity-ui/icons` 2.22.0 (MIT), retrieved with
`npm pack` on 2026-09-25 (tarball sha1 f766baf65dcf8b5c4a0e31bef1448a6b48edcce1). The
package is not a dependency. Only the SVG wrapper is adapted for React. The seven glyphs
claim, route, ladder, workshop, approval, evidence and type in the same file are original
Arc Science drawings, not Gravity UI icons.

Source: https://github.com/gravity-ui/icons

## The MIT License (MIT)

Copyright (c) 2022 YANDEX LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

# Fonts

The workbench loads one font file and references one system font. The files live in
`design/fonts/` at the repository root, exactly as published; the `@font-face` rules in
`web/src/theme/fonts.css` only set metric overrides.

| Family | File | Source | Terms |
|---|---|---|---|
| Kyiv Type Sans 1.002 (variable) | `design/fonts/Kyiv Type Sans/KyivTypeSans-VarGX.ttf` | Dmitry Rastvortsev, distributed free by Rentafont (https://rentafont.com/fonts/kyiv-type-sans) | Copyright © 2019 by Dmitry Rastvortsev. Ordered by Projector, Dmytro Bulanov Creative Büro and Banda Agency for Kyiv city identification. The font's licence field: "Freeware. Font free for commercial and non-commercial use. Must not be decompiled. NoDerivates." Shipped unmodified. |
| MuseoModerno 1.001 (variable) | `design/fonts/Museo Moderno/MuseoModerno.ttf` (used only to outline the wordmark; not loaded by the workbench) | https://github.com/Omnibus-Type/MuseoModerno | Copyright 2020 The MuseoModerno Project Authors, SIL Open Font License 1.1 (`design/fonts/Museo Moderno/LICENSE.txt`) |

Cascadia Mono is referenced through `local()` and comes with Windows.
