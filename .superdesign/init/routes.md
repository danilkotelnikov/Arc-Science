# Routes

Arc Science is a Vite React single-page application without a client router.

| URL | Entry | Surface |
| --- | --- | --- |
| `/` | `web/src/main.jsx` | Mounted Molecular, BioArt, and Research workspaces |
| `/diagnostics` | `static/diagnostics.html` | Separate diagnostic console |
| `/api/examples/1dqj/*` | `molecular_web.py` | Public allowlisted molecular assets |
| `/api/bioart/search` | `bioart/web.py` | Authenticated cache-first search |
| `/api/bioart/inspect` | `bioart/web.py` | Authenticated entry metadata |
| `/api/bioart/fetch` | `bioart/web.py` | Authenticated verified receipt creation |
| `/api/bioart/receipts/{id}/preview` | `bioart/web.py` | Authenticated checked SVG/PNG preview |
| `/api/bioart/receipts/{id}/source` | `bioart/web.py` | Authenticated original download |
| `/api/bioart/import` | `bioart/web.py` | Authenticated eligible SVG import |
| `/api/missions/*` | `service.py` | Authenticated Research operations |

Workspace state maps `molecules`, `bioart`, and `research` to their matching React
components. The operator token is an Authorization header, never a URL parameter.
