# Native session handoff design

Date: 20 September 2026. Status: **implemented for owned Windows WebView2 sessions; bounded real-window acceptance passed**. This is the security design for [recovery increment 1](2026-09-20-product-recovery-plan.md). An ordinary browser and a desktop window reusing another service still use the explicit operator bearer token.

## Trust boundary and decision

The desktop owns one Wry/WebView2 top-level window and restricts navigation to the configured numeric loopback origin. The service owns an owner-only `access.token` and authorizes protected routes with a bearer header. The public `/health` identity proves readiness, not authorization. Another local browser can open the same loopback URL, so a marker, user agent, origin check or the presence of the WebView window cannot authorize its API calls.

The preferred native route is an ephemeral, host-owned secret attached to exact-origin `/api/*` requests by a WebView2 `WebResourceRequested` handler. The desktop generates a new 256-bit secret for a service instance it launches, passes it to the owned supervisor/service child without writing it to disk, and injects `X-Arc-Native-Session` only for fetch/XHR/EventSource requests to the configured scheme, numeric IP, port and `/api` path. The backend accepts that header only when it matches the service generation's secret; ordinary browsers continue to use the existing bearer token. The frontend must centralize requests so native mode sends no page bearer and manual browser mode still can. Do not pass the operator token or the native secret through JS, URLs, web storage, page globals or logs.

Wry 0.57 exposes the Windows CoreWebView2 handle through `WebViewExtWindows`; Wry's own WebView2 backend registers resource-request filters. The [Microsoft WebResourceRequested contract](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.webresourcerequested) says matching requests are intercepted before continuing. The host now declares the WebView2 COM and Windows crates directly at their already locked transitive versions; this promoted existing build dependencies without fetching a new runtime package. A page-injected bearer remains prohibited.

## Threats and limitations

| Threat | Required behavior |
| --- | --- |
| Another browser or wrong localhost port | It has no native handler; protected routes return 401 without its own valid bearer. Exact scheme/IP/port/path filtering rejects deceptive authorities and redirects. |
| External-origin CSRF | A normal website cannot manufacture the secret; the service must not enable permissive CORS. Native header injection applies only inside the owned WebView for the exact API origin. |
| New window or external navigation | The current host denies a second WebView and opens only approved HTTPS links in the system browser, which has no native header. Recheck this after wiring the hook. |
| Same-origin script compromise | Script running in the trusted Arc page can initiate requests which receive the ambient native header. This design authenticates the host-owned view, not each script. Keep strict CSP, escaped untrusted data and route-specific consent; do not claim XSS isolation. |
| Reused or restarted listener | A desktop that did not launch the service cannot prove a matching secret; show manual unlock. Restart invalidates the old generation. Rotate on a new desktop launch and never persist the secret in the WebView profile. |
| Child environment inspection | Passing the secret by environment limits it to owned processes but is not a defense against a malicious same-user process that can inspect another process. Never print it. A stronger inherited pipe/named-pipe exchange is a later hardening option. |
| Profile persistence | Header injection itself leaves no credential cookie; still clear stale browsing data as appropriate under Microsoft's [WebView2 user-data-folder guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder). |

An HttpOnly SameSite cookie would avoid the COM hook but is ambient and host-scoped across ports. It requires short TTL, exact Origin validation, CSRF protection on writes, explicit cleanup and tests; a cookie alone does not prevent malicious same-origin script from acting. It is not the selected shortcut.

## Acceptance before enabling native unlock

- Backend: bearer compatibility; native secret enabled only for an owned service generation; missing, wrong, stale or absent-config header returns 401; no secret in logs/errors.
- Host: filter covers fetch/XHR/EventSource only on the exact API origin, never `/health`, diagnostics, static assets, `blob:`, `data:`, other ports or external links; failure to register the hook leaves manual unlock.
- Browser: another local browser and an external origin cannot call protected APIs without their own bearer; no credential in URL, storage, globals or visible page text.
- Native: owned launch is unlocked without page token; reused service, restarted service and failed hook show a clear manual fallback; new-window and navigation restrictions remain intact. Observe this in the actual Windows WebView, not just mocks.

Source map: `native/arc-desktop/src/main.rs`, `startup.rs`; `apps/arc-science/src/arc_science/service.py`; `apps/arc-science/web/src/main.jsx`, workspaces and `renderEvents.js`. The design was proposed by a separate architecture agent; independent security review is recorded in the recovery record when complete.

## Observed qualification and limits

The real owned Wry window showed `Desktop session ready` and loaded protected missions through UI Automation without a page token. The same service in another browser was locked. A reused-service native window showed manual unlock, and closing an owned window stopped the supervisor/service tree and released its port. The independent security reviewer accepted the main P0 boundary. Exact files and observations are in the [recovery record](2026-09-20-recovery-record.md). Real redirect behavior, a stale secret after an unexpected service restart, and same-origin script compromise remain outside this observation; they are not claimed as passed.

A later cross-module review found that the Python service initially passed its environment on to stdio MCP servers. That boundary is now narrowed: MCP, memory, BioArt, SVG and settings child launches receive scrubbed environment maps, with only explicitly configured MCP variables and a controlled BioArt import path added back. The real MCP fixture and subprocess tests verify the native secret is absent from child environments. This reduces accidental inheritance; it does not defend against a malicious process running as the same OS user.
