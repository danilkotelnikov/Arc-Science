# arc-web-crawler

Open-source web search, adaptive stealth fetcher, anti-bot/CAPTCHA verifier, and structured content analyzer for Arc Harness.

## Capabilities

- **Native `web_search` provider (`arc-crawler`)**: Keyless multi-engine search via `ddgs`, optional self-hosted SearXNG (`ARC_SEARXNG_URL`), and stealth DuckDuckGo HTML fallback.
- **Native `web_fetch` provider (`arc-crawler`)**: 3-tier adaptive retrieval with SSRF protection (blocks loopback/private/link-local hosts):
  1. **Tier 1 (`http_impersonate`)**: Fast Chrome TLS/HTTP2 impersonation via Scrapling `Fetcher` (`curl_cffi`), plus direct PDF text extraction via PyMuPDF.
  2. **Tier 2 (`stealth_browser`)**: Automatic escalation on 403/429/503, WAF/Cloudflare interstitials, Turnstile challenges, or JS-only SPAs via Scrapling `StealthyFetcher` (Patchright Chromium with `solve_cloudflare=True` and per-host cookie persistence).
  3. **Tier 3 (`challenge_verifier`)**: Structured bot-shield & CAPTCHA classifier (Cloudflare Turnstile, Akamai, DataDome, PerimeterX, AWS WAF, reCAPTCHA, hCaptcha) with opt-in visible browser verification (`interactive_captcha: true`) that persists cleared cookies.
- **Content Analyzer & Crawler tools (`web_analyze`, `web_crawl`)**: Structured extraction via Trafilatura + BeautifulSoup/Markdownify + Scrapling CSS selectors (clean Markdown, metadata, headings, links, JSON-LD, tables, PDF text, and bounded same-origin crawling).
