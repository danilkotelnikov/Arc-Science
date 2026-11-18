#!/usr/bin/env python3
"""
arc-web-crawler Python engine.

Open-source tiered web search, stealth fetcher, bot-shield/CAPTCHA verifier,
and structured HTML/PDF content analyzer for Arc Harness.

Protocol:
  Reads one JSON object from stdin: {"command": "search|fetch|analyze|crawl|doctor", "payload": {...}}
  Writes one JSON object to stdout: {"ok": true, ...} or {"ok": false, "code": "...", "error": "..."}
"""
from __future__ import annotations

import contextlib
import io
import ipaddress
import json
import logging
import os
import re
import socket
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse

# Keep stdout strictly reserved for the single JSON response line.
logging.basicConfig(stream=sys.stderr, level=logging.ERROR)
for _noisy in ("scrapling", "curl_cffi", "trafilatura", "htmldate", "courlan", "ddgs", "primp", "httpx", "urllib3"):
    logging.getLogger(_noisy).setLevel(logging.CRITICAL)

CACHE_DIR = Path.home() / ".arc" / "cache" / "arc-web-crawler"
COOKIE_FILE = CACHE_DIR / "cookies.json"
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_HTML_BYTES = 8 * 1024 * 1024


class CrawlerError(Exception):
    def __init__(self, message: str, code: str = "WEB_PROVIDER_ERROR") -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# SSRF & Public URL Validation
# ---------------------------------------------------------------------------

def _is_public_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str.strip("[]"))
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return bool(
        addr.is_global
        and not addr.is_private
        and not addr.is_loopback
        and not addr.is_link_local
        and not addr.is_multicast
        and not addr.is_reserved
        and not addr.is_unspecified
    )


def validate_public_url(raw_url: str) -> str:
    if not isinstance(raw_url, str) or not raw_url.strip():
        raise CrawlerError("URL must be a non-empty string", "WEB_INVALID_URL")
    url = raw_url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise CrawlerError(f"Unsupported URL scheme '{parsed.scheme}'; only http and https are allowed", "WEB_BLOCKED_URL")
    if not parsed.hostname:
        raise CrawlerError("URL must include a hostname", "WEB_INVALID_URL")
    if parsed.username or parsed.password:
        raise CrawlerError("URLs with embedded credentials are not allowed", "WEB_BLOCKED_URL")

    host = parsed.hostname.lower()
    if host in ("localhost", "localhost.localdomain") or host.endswith(".local") or host.endswith(".internal"):
        raise CrawlerError(f"Blocked non-public hostname '{host}'", "WEB_BLOCKED_URL")

    # Reject non-public literal IPs immediately.
    try:
        ipaddress.ip_address(host.strip("[]"))
        if not _is_public_ip(host):
            raise CrawlerError(f"Blocked non-public IP address '{host}'", "WEB_BLOCKED_URL")
        return url
    except ValueError:
        pass

    # Resolve DNS and verify every returned IP is globally routable.
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except OSError as exc:
        raise CrawlerError(f"Failed to resolve hostname '{host}': {exc}", "WEB_PROVIDER_ERROR") from exc

    ips = {info[4][0] for info in infos if info and info[4]}
    if not ips:
        raise CrawlerError(f"Hostname '{host}' resolved to no addresses", "WEB_PROVIDER_ERROR")
    for ip in ips:
        if not _is_public_ip(ip):
            raise CrawlerError(f"Hostname '{host}' resolves to non-public IP '{ip}'", "WEB_BLOCKED_URL")
    return url


# ---------------------------------------------------------------------------
# Per-host Cookie Persistence (for verified bot-shield / CAPTCHA sessions)
# ---------------------------------------------------------------------------

def _load_cookie_store() -> dict[str, dict[str, str]]:
    try:
        if COOKIE_FILE.exists():
            data = json.loads(COOKIE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _save_host_cookies(url: str, cookies: Any) -> None:
    host = (urlparse(url).hostname or "").lower()
    if not host or not cookies:
        return
    cookie_map: dict[str, str] = {}
    if isinstance(cookies, dict):
        for k, v in cookies.items():
            if isinstance(k, str) and v is not None:
                cookie_map[k] = str(v)
    elif isinstance(cookies, (list, tuple)):
        for item in cookies:
            if isinstance(item, dict) and item.get("name") and item.get("value") is not None:
                cookie_map[str(item["name"])] = str(item["value"])
    if not cookie_map:
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        store = _load_cookie_store()
        existing = store.get(host, {})
        if not isinstance(existing, dict):
            existing = {}
        existing.update(cookie_map)
        store[host] = existing
        COOKIE_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _get_host_cookies(url: str) -> dict[str, str]:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return {}
    store = _load_cookie_store()
    val = store.get(host)
    return val if isinstance(val, dict) else {}


# ---------------------------------------------------------------------------
# Bot-Shield & CAPTCHA Verifier / Classifier
# ---------------------------------------------------------------------------

def _visible_text_sample(html: str) -> str:
    if not html:
        return ""
    cleaned = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def detect_challenge(status_code: int, headers: dict[str, str], html: str) -> dict[str, Any]:
    """
    Classify anti-bot shields, JS interstitials, and CAPTCHA walls.
    Returns:
      {detected: bool, vendor: str, kind: str, solvable_auto: bool, reason: str}
    """
    hdrs = {str(k).lower(): str(v).lower() for k, v in (headers or {}).items()}
    low_html = (html or "")[:60_000].lower()
    vis = _visible_text_sample(html or "")
    vis_len = len(vis)
    title_match = re.search(r"<title[^>]*>(.*?)</title>", low_html, flags=re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""

    # 1. Cloudflare Managed Challenge / Turnstile / Interstitial
    cf_mitigated = hdrs.get("cf-mitigated", "")
    vis_low = vis.lower()
    cf_html_markers = (
        "/cdn-cgi/challenge-platform",
        "_cf_chl_opt",
        "cf-turnstile",
        "challenges.cloudflare.com/turnstile",
    )
    cf_active_text_markers = (
        "just a moment...",
        "checking your browser before accessing",
        "attention required! | cloudflare",
        "verify you are human by completing the action below",
        "enable javascript and cookies to continue",
    )
    has_cf_active_text = any(m in title or m in vis_low for m in cf_active_text_markers)
    has_cf_html = any(m in low_html for m in cf_html_markers)
    if (
        (cf_mitigated == "challenge" and status_code != 200)
        or has_cf_active_text
        or (status_code in (403, 429, 503) and has_cf_html)
        or (status_code == 200 and "cf-turnstile" in low_html and vis_len < 300 and "bypassed" not in vis_low)
    ):
        kind = "turnstile" if ("turnstile" in low_html or "verify you are human" in vis_low) else "js_interstitial"
        return {
            "detected": True,
            "vendor": "cloudflare",
            "kind": kind,
            "solvable_auto": True,
            "reason": f"Cloudflare {kind} detected (HTTP {status_code})",
        }

    # 2. DataDome
    if (
        "x-datadome" in hdrs
        or "geo.captcha-delivery.com" in low_html
        or ("datadome" in low_html and (status_code in (403, 429) or vis_len < 1000))
    ):
        return {
            "detected": True,
            "vendor": "datadome",
            "kind": "captcha",
            "solvable_auto": False,
            "reason": f"DataDome challenge detected (HTTP {status_code})",
        }

    # 3. PerimeterX / HUMAN Security
    if (
        "px-captcha" in low_html
        or ("perimeterx" in low_html and (status_code in (403, 429) or vis_len < 1000))
        or ("press & hold" in low_html and "human" in low_html and vis_len < 1000)
    ):
        return {
            "detected": True,
            "vendor": "perimeterx",
            "kind": "captcha",
            "solvable_auto": False,
            "reason": f"PerimeterX/HUMAN challenge detected (HTTP {status_code})",
        }

    # 4. AWS WAF
    if (
        "awswafcookiedomainlist" in low_html
        or "token.awswaf.com" in low_html
        or ("aws-waf" in low_html and status_code in (202, 403, 405))
    ):
        return {
            "detected": True,
            "vendor": "aws_waf",
            "kind": "js_interstitial",
            "solvable_auto": True,
            "reason": f"AWS WAF challenge detected (HTTP {status_code})",
        }

    # 5. Akamai Bot Manager
    if status_code in (403, 429) and (
        "edgesuite.net" in low_html
        or "akamaighost" in hdrs.get("server", "")
        or ("access denied" in title and "reference #" in low_html)
    ):
        return {
            "detected": True,
            "vendor": "akamai",
            "kind": "waf_block",
            "solvable_auto": True,
            "reason": f"Akamai WAF block detected (HTTP {status_code})",
        }

    # 6. Blocking reCAPTCHA / hCaptcha gate (avoid false positives on normal pages with embedded forms)
    is_gate_page = (
        status_code in (403, 429, 503)
        or vis_len < 700
        or any(w in title for w in ("captcha", "robot", "human", "verify", "blocked", "access denied", "security check"))
    )
    if is_gate_page and ("google.com/recaptcha" in low_html or "g-recaptcha" in low_html):
        return {
            "detected": True,
            "vendor": "recaptcha",
            "kind": "captcha",
            "solvable_auto": False,
            "reason": f"reCAPTCHA verification wall detected (HTTP {status_code})",
        }
    if is_gate_page and ("hcaptcha.com" in low_html or "h-captcha" in low_html):
        return {
            "detected": True,
            "vendor": "hcaptcha",
            "kind": "captcha",
            "solvable_auto": False,
            "reason": f"hCaptcha verification wall detected (HTTP {status_code})",
        }

    # 7. JS-required / SPA empty shell
    js_shell_markers = (
        "enable javascript",
        "you need to enable javascript",
        "javascript is required",
        "please turn javascript on",
        "browser does not support javascript",
    )
    if status_code == 200 and vis_len < 220 and "<script" in low_html and (
        any(m in low_html for m in js_shell_markers)
        or ("<div id=\"root\"" in low_html or "<div id=\"app\"" in low_html or "__next_data__" in low_html)
    ):
        return {
            "detected": True,
            "vendor": "spa_js",
            "kind": "js_render_required",
            "solvable_auto": True,
            "reason": "JavaScript-rendered SPA shell detected with minimal static text",
        }

    # 8. Generic bot-shield HTTP block
    if status_code in (403, 429, 503, 520, 521, 522) and vis_len < 1500:
        return {
            "detected": True,
            "vendor": "waf",
            "kind": "http_block",
            "solvable_auto": True,
            "reason": f"HTTP {status_code} potential bot-shield block",
        }

    return {
        "detected": False,
        "vendor": "none",
        "kind": "none",
        "solvable_auto": False,
        "reason": "",
    }


# ---------------------------------------------------------------------------
# Response Extraction & Content Analyzer (HTML / PDF / JSON / Plaintext)
# ---------------------------------------------------------------------------

def _extract_pdf(raw_bytes: bytes, max_chars: int) -> dict[str, Any]:
    import pymupdf as fitz  # PyMuPDF

    if len(raw_bytes) > MAX_PDF_BYTES:
        raise CrawlerError(f"PDF exceeds maximum size of {MAX_PDF_BYTES} bytes", "WEB_FETCH_TOO_LARGE")

    doc = fitz.open(stream=raw_bytes, filetype="pdf")
    try:
        meta_raw = doc.metadata or {}
        pages_text: list[str] = []
        total_len = 0
        truncated = False
        for i, page in enumerate(doc):
            txt = page.get_text("text").strip()
            if txt:
                chunk = f"## Page {i + 1}\n\n{txt}"
                if total_len + len(chunk) > max_chars:
                    remaining = max(0, max_chars - total_len)
                    if remaining > 0:
                        pages_text.append(chunk[:remaining])
                    truncated = True
                    break
                pages_text.append(chunk)
                total_len += len(chunk) + 2
        markdown = "\n\n".join(pages_text)
        return {
            "content_type": "application/pdf",
            "markdown": markdown,
            "text": markdown,
            "truncated": truncated,
            "metadata": {
                "title": (meta_raw.get("title") or "").strip(),
                "author": (meta_raw.get("author") or "").strip(),
                "date": (meta_raw.get("creationDate") or "").strip(),
                "pages": len(doc),
            },
            "headings": [f"Page {i + 1}" for i in range(min(len(doc), 30))],
            "links": [],
            "json_ld": [],
            "tables_count": 0,
            "word_count": len(markdown.split()),
        }
    finally:
        doc.close()


def _extract_html_analysis(
    html: str,
    final_url: str,
    max_chars: int = 40_000,
    selector: str = "",
    include_links: bool = True,
) -> dict[str, Any]:
    from bs4 import BeautifulSoup
    from markdownify import markdownify as md_convert
    import trafilatura

    if len(html) > MAX_HTML_BYTES:
        html = html[:MAX_HTML_BYTES]

    soup = BeautifulSoup(html, "lxml")

    # Metadata extraction (Trafilatura + HTML meta fallback)
    meta: dict[str, Any] = {}
    try:
        tmeta = trafilatura.extract_metadata(html, default_url=final_url)
        if tmeta:
            for key, attr in (
                ("title", "title"),
                ("author", "author"),
                ("date", "date"),
                ("site_name", "sitename"),
                ("description", "description"),
                ("language", "language"),
            ):
                val = getattr(tmeta, attr, None)
                if isinstance(val, str) and val.strip():
                    meta[key] = val.strip()
    except Exception:
        pass

    if not meta.get("title") and soup.title and soup.title.string:
        meta["title"] = soup.title.string.strip()
    if not meta.get("description"):
        desc_tag = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
        if desc_tag and desc_tag.get("content"):
            meta["description"] = str(desc_tag.get("content")).strip()
    canon_tag = soup.find("link", attrs={"rel": "canonical"})
    if canon_tag and canon_tag.get("href"):
        meta["canonical_url"] = urljoin(final_url, str(canon_tag.get("href")).strip())

    # Headings outline
    headings: list[str] = []
    for h in soup.find_all(["h1", "h2", "h3"]):
        txt = re.sub(r"\s+", " ", h.get_text(" ", strip=True)).strip()
        if txt and len(headings) < 40:
            headings.append(f"{h.name}: {txt[:160]}")

    # JSON-LD structured data
    json_ld: list[Any] = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw_json = (script.string or script.get_text() or "").strip()
        if not raw_json or len(json_ld) >= 5:
            continue
        try:
            json_ld.append(json.loads(raw_json))
        except Exception:
            pass

    tables_count = len(soup.find_all("table"))

    # Links extraction
    links: list[dict[str, str]] = []
    if include_links:
        seen_links: set[str] = set()
        for a in soup.find_all("a", href=True):
            href = str(a.get("href") or "").strip()
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            abs_url = urljoin(final_url, href)
            parsed = urlparse(abs_url)
            if parsed.scheme not in ("http", "https"):
                continue
            clean_url = abs_url.split("#")[0]
            if clean_url in seen_links:
                continue
            seen_links.add(clean_url)
            label = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()[:120]
            links.append({"url": clean_url, "text": label})
            if len(links) >= 50:
                break

    # Optional CSS selector extraction using Scrapling Selector
    selector_matches: list[str] = []
    if selector and selector.strip():
        try:
            from scrapling.parser import Selector
            sel = Selector(html, url=final_url)
            for node in sel.css(selector.strip())[:50]:
                txt = re.sub(r"\s+", " ", node.get_all_text(separator=" ", strip=True)).strip()
                if txt:
                    selector_matches.append(txt[:2000])
        except Exception as exc:
            selector_matches.append(f"[selector error: {exc}]")

    # Main content Markdown: Trafilatura primary, BeautifulSoup+markdownify fallback for docs/apps
    traf_md = ""
    try:
        traf_md = trafilatura.extract(
            html,
            url=final_url,
            output_format="markdown",
            include_links=True,
            include_tables=True,
            include_formatting=True,
            favor_recall=True,
        ) or ""
    except Exception:
        traf_md = ""

    # Compute cleaned soup markdown as fallback when trafilatura strips too much (e.g., SPAs, tables, docs)
    soup_copy = BeautifulSoup(html, "lxml")
    for tag in soup_copy(["script", "style", "noscript", "svg", "iframe", "template"]):
        tag.decompose()
    main_container = soup_copy.find("main") or soup_copy.find("article") or soup_copy.body or soup_copy
    visible_plain = re.sub(r"\s+", " ", main_container.get_text(" ", strip=True)).strip()

    chosen_md = traf_md.strip()
    if len(chosen_md) < max(200, int(len(visible_plain) * 0.25)):
        try:
            bs_md = md_convert(str(main_container), heading_style="ATX", strip=["script", "style"]).strip()
            bs_md = re.sub(r"\n{3,}", "\n\n", bs_md)
            if len(bs_md) > len(chosen_md):
                chosen_md = bs_md
        except Exception:
            if not chosen_md:
                chosen_md = visible_plain

    # Post-process Markdown for clean UI rendering: remove empty image links,
    # resolve relative markdown links, and normalize vertical whitespace.
    chosen_md = re.sub(r"!\[\s*\]\([^)]*\)", "", chosen_md)
    def _resolve_md_link(m: re.Match[str]) -> str:
        prefix, label, href = m.group(1), m.group(2), m.group(3).strip()
        if not href or href.startswith(("#", "http://", "https://", "mailto:", "data:")):
            return m.group(0)
        return f"{prefix}[{label}]({urljoin(final_url, href)})"
    chosen_md = re.sub(r"(!?)\[([^\]]*)\]\(([^)\s]+)\)", _resolve_md_link, chosen_md)
    chosen_md = re.sub(r"[ \t]+\n", "\n", chosen_md)
    chosen_md = re.sub(r"\n{3,}", "\n\n", chosen_md).strip()

    truncated = len(chosen_md) > max_chars
    if truncated:
        chosen_md = chosen_md[:max_chars]

    result: dict[str, Any] = {
        "content_type": "text/html",
        "markdown": chosen_md,
        "text": chosen_md,
        "truncated": truncated,
        "metadata": meta,
        "headings": headings,
        "links": links,
        "json_ld": json_ld,
        "tables_count": tables_count,
        "word_count": len(chosen_md.split()),
    }
    if selector:
        result["selector"] = selector
        result["selector_matches"] = selector_matches
    return result


# ---------------------------------------------------------------------------
# 3-Tier Adaptive Stealth Fetcher & CAPTCHA Verifier
# ---------------------------------------------------------------------------

def _scrapling_resp_to_dict(resp: Any, fallback_url: str) -> dict[str, Any]:
    status = int(getattr(resp, "status", 200) or 200)
    final_url = str(getattr(resp, "url", "") or fallback_url)
    headers_raw = getattr(resp, "headers", None) or {}
    headers = {str(k).lower(): str(v) for k, v in dict(headers_raw).items()}
    cookies = getattr(resp, "cookies", None)
    body = getattr(resp, "body", b"")
    if isinstance(body, str):
        raw_bytes = body.encode("utf-8", errors="replace")
        html = body
    else:
        raw_bytes = bytes(body or b"")
        html = str(getattr(resp, "html_content", "") or raw_bytes.decode("utf-8", errors="replace"))
    return {
        "status_code": status,
        "final_url": final_url,
        "headers": headers,
        "cookies": cookies,
        "raw_bytes": raw_bytes,
        "html": html,
    }


def _fetch_tier1_http(url: str, timeout_s: int) -> dict[str, Any]:
    from curl_cffi import requests as cffi_requests

    cached = _get_host_cookies(url)
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
    }
    resp = cffi_requests.get(
        url,
        impersonate="chrome",
        headers=headers,
        cookies=cached or None,
        allow_redirects=True,
        max_redirects=6,
        timeout=min(max(5, timeout_s), 25),
    )
    raw_bytes = bytes(resp.content or b"")
    resp_headers = {str(k).lower(): str(v) for k, v in dict(resp.headers).items()}
    ctype = resp_headers.get("content-type", "")
    is_binary = "application/pdf" in ctype or raw_bytes[:5] == b"%PDF-"
    html = "" if is_binary else (resp.text if isinstance(resp.text, str) else raw_bytes.decode("utf-8", errors="replace"))
    cookies_dict = dict(resp.cookies.items()) if hasattr(resp, "cookies") and resp.cookies else None
    return {
        "status_code": int(resp.status_code),
        "final_url": str(resp.url or url),
        "headers": resp_headers,
        "cookies": cookies_dict,
        "raw_bytes": raw_bytes,
        "html": html,
    }


def _fetch_tier2_stealth(
    url: str,
    timeout_s: int,
    solve_cloudflare: bool = True,
    headless: bool = True,
    interactive_wait_s: int = 0,
) -> dict[str, Any]:
    from scrapling.fetchers import StealthyFetcher

    def _wait_interactive(page: Any) -> Any:
        # Poll up to interactive_wait_s until CAPTCHA / challenge clears in visible browser.
        deadline_t = time.monotonic() + max(15, interactive_wait_s)
        while time.monotonic() < deadline_t:
            try:
                content = page.content()
                chk = detect_challenge(200, {}, content)
                if not chk["detected"]:
                    break
            except Exception:
                pass
            page.wait_for_timeout(1500)
        return page

    # Keep per-step Playwright timeout bounded (20-30s) so solve_cloudflare retries promptly.
    step_timeout_ms = int(min(max(18, timeout_s // 2), 30) * 1000)
    kwargs: dict[str, Any] = {
        "headless": headless,
        "solve_cloudflare": solve_cloudflare,
        "network_idle": False,
        "wait": 600,
        "google_search": True,
        "timeout": step_timeout_ms,
    }
    if not headless and interactive_wait_s > 0:
        kwargs["page_action"] = _wait_interactive
        kwargs["timeout"] = int(max(110, interactive_wait_s + 20) * 1000)

    with contextlib.redirect_stdout(sys.stderr):
        resp = StealthyFetcher.fetch(url, **kwargs)
    data = _scrapling_resp_to_dict(resp, url)
    _save_host_cookies(data["final_url"], data.get("cookies"))
    return data


def fetch_tiered(
    url: str,
    mode: str = "auto",
    solve_cloudflare: bool = True,
    interactive_captcha: bool = False,
    timeout_s: int = 45,
    max_chars: int = 40_000,
    selector: str = "",
    include_links: bool = True,
) -> dict[str, Any]:
    validated_url = validate_public_url(url)
    tier_used = "http_impersonate"
    initial_challenge: dict[str, Any] = {"detected": False, "vendor": "none", "kind": "none", "solvable_auto": False, "reason": ""}
    final_challenge = initial_challenge
    bot_shield_bypassed = False
    verification_status = "clean"
    fetched: dict[str, Any] | None = None
    tier1_error: str | None = None

    # Tier 1: Fast TLS-impersonated HTTP
    if mode != "stealth":
        try:
            fetched = _fetch_tier1_http(validated_url, timeout_s=min(timeout_s, 20))
            # Re-validate final redirect destination against SSRF
            if fetched["final_url"] != validated_url:
                validate_public_url(fetched["final_url"])
        except CrawlerError:
            raise
        except Exception as exc:
            tier1_error = str(exc)
            fetched = None

    # Handle direct non-HTML (PDF, JSON, plain text) returned cleanly by Tier 1
    if fetched is not None:
        ctype = fetched["headers"].get("content-type", "")
        is_pdf = "application/pdf" in ctype or fetched["raw_bytes"][:5] == b"%PDF-"
        if is_pdf:
            analysis = _extract_pdf(fetched["raw_bytes"], max_chars=max_chars)
            return {
                "ok": True,
                "url": validated_url,
                "final_url": fetched["final_url"],
                "status_code": fetched["status_code"],
                "tier": tier_used,
                "bot_shield_bypassed": False,
                "verification_status": "clean",
                "initial_challenge": initial_challenge,
                "challenge": final_challenge,
                **analysis,
            }
        if "application/json" in ctype or "text/plain" in ctype or "application/xml" in ctype or "text/xml" in ctype:
            raw_txt = fetched["raw_bytes"].decode("utf-8", errors="replace")
            truncated = len(raw_txt) > max_chars
            content = raw_txt[:max_chars] if truncated else raw_txt
            return {
                "ok": True,
                "url": validated_url,
                "final_url": fetched["final_url"],
                "status_code": fetched["status_code"],
                "tier": tier_used,
                "bot_shield_bypassed": False,
                "verification_status": "clean",
                "initial_challenge": initial_challenge,
                "challenge": final_challenge,
                "content_type": ctype.split(";")[0].strip() or "text/plain",
                "markdown": content,
                "text": content,
                "truncated": truncated,
                "metadata": {},
                "headings": [],
                "links": [],
                "json_ld": [],
                "tables_count": 0,
                "word_count": len(content.split()),
            }

        initial_challenge = detect_challenge(fetched["status_code"], fetched["headers"], fetched["html"])
        final_challenge = initial_challenge

    # Tier 2: Escalate to StealthyFetcher (Patchright Chromium + solve_cloudflare) when needed
    should_escalate = (
        mode == "stealth"
        or (mode == "auto" and (fetched is None or initial_challenge["detected"]))
    )
    if should_escalate:
        try:
            use_cf_solver = bool(solve_cloudflare) and (
                initial_challenge.get("vendor") != "spa_js"
            )
            stealth_res = _fetch_tier2_stealth(
                validated_url,
                timeout_s=timeout_s,
                solve_cloudflare=use_cf_solver,
                headless=True,
            )
            if stealth_res["final_url"] != validated_url:
                validate_public_url(stealth_res["final_url"])
            fetched = stealth_res
            tier_used = "stealth_browser"
            final_challenge = detect_challenge(fetched["status_code"], fetched["headers"], fetched["html"])
            if not final_challenge["detected"]:
                if initial_challenge["detected"] or tier1_error:
                    bot_shield_bypassed = True
                    verification_status = "verified_automatically"
                else:
                    verification_status = "clean"
            else:
                verification_status = "manual_verification_required"
        except CrawlerError:
            raise
        except Exception as exc:
            if fetched is None:
                raise CrawlerError(
                    f"Both TLS HTTP ({tier1_error or 'skipped'}) and stealth browser failed: {exc}",
                    "WEB_PROVIDER_ERROR",
                ) from exc

    # Tier 3: Optional Interactive Visible Browser CAPTCHA Verification
    if final_challenge["detected"] and interactive_captcha:
        try:
            inter_res = _fetch_tier2_stealth(
                validated_url,
                timeout_s=timeout_s,
                solve_cloudflare=True,
                headless=False,
                interactive_wait_s=90,
            )
            if inter_res["final_url"] != validated_url:
                validate_public_url(inter_res["final_url"])
            fetched = inter_res
            tier_used = "interactive_browser"
            final_challenge = detect_challenge(fetched["status_code"], fetched["headers"], fetched["html"])
            if not final_challenge["detected"]:
                bot_shield_bypassed = True
                verification_status = "verified_interactively"
            else:
                verification_status = "manual_verification_required"
        except Exception:
            verification_status = "manual_verification_required"

    if fetched is None:
        raise CrawlerError(
            f"Tier 1 TLS HTTP fetch failed: {tier1_error or 'unknown error'}",
            "WEB_PROVIDER_ERROR",
        )
    analysis = _extract_html_analysis(
        fetched["html"],
        final_url=fetched["final_url"],
        max_chars=max_chars,
        selector=selector,
        include_links=include_links,
    )

    return {
        "ok": True,
        "url": validated_url,
        "final_url": fetched["final_url"],
        "status_code": fetched["status_code"],
        "tier": tier_used,
        "bot_shield_bypassed": bot_shield_bypassed,
        "verification_status": verification_status,
        "initial_challenge": initial_challenge,
        "challenge": final_challenge,
        **analysis,
    }


# ---------------------------------------------------------------------------
# Keyless Multi-Engine Web Search (DDGS + optional SearXNG + Stealth HTML fallback)
# ---------------------------------------------------------------------------

def _unwrap_ddg_url(href: str) -> str:
    if "duckduckgo.com/l/?" in href:
        qs = parse_qs(urlparse(href).query)
        uddg = qs.get("uddg")
        if uddg and uddg[0]:
            return unquote(uddg[0])
    return href


def _search_searxng(query: str, max_results: int, searxng_url: str) -> list[dict[str, str]]:
    import httpx

    base = searxng_url.rstrip("/")
    resp = httpx.get(
        f"{base}/search",
        params={"q": query, "format": "json"},
        timeout=12.0,
        headers={"Accept": "application/json", "User-Agent": "arc-web-crawler/0.1"},
    )
    resp.raise_for_status()
    data = resp.json()
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in data.get("results", []):
        u = str(item.get("url") or "").strip()
        if not u or u in seen or not u.startswith(("http://", "https://")):
            continue
        seen.add(u)
        src: dict[str, str] = {"url": u}
        if item.get("title"):
            src["title"] = str(item["title"]).strip()
        if item.get("content"):
            src["snippet"] = str(item["content"]).strip()
        if item.get("publishedDate"):
            src["publishedAt"] = str(item["publishedDate"]).strip()
        sources.append(src)
        if len(sources) >= max_results:
            break
    return sources


def _search_ddgs(query: str, max_results: int) -> list[dict[str, str]]:
    from ddgs import DDGS

    with contextlib.redirect_stdout(sys.stderr):
        raw = DDGS().text(query, max_results=max_results) or []
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        u = str(item.get("href") or item.get("url") or "").strip()
        if not u or u in seen or not u.startswith(("http://", "https://")):
            continue
        seen.add(u)
        src: dict[str, str] = {"url": u}
        if item.get("title"):
            src["title"] = str(item["title"]).strip()
        if item.get("body") or item.get("snippet"):
            src["snippet"] = str(item.get("body") or item.get("snippet")).strip()
        sources.append(src)
        if len(sources) >= max_results:
            break
    return sources


def _search_ddg_html_fallback(query: str, max_results: int) -> list[dict[str, str]]:
    from bs4 import BeautifulSoup
    from scrapling.fetchers import Fetcher
    from urllib.parse import quote_plus

    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    with contextlib.redirect_stdout(sys.stderr):
        resp = Fetcher.get(url, impersonate="chrome", stealthy_headers=True, timeout=15)
    html = str(getattr(resp, "html_content", "") or "")
    soup = BeautifulSoup(html, "lxml")
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for res in soup.select(".result"):
        a = res.select_one("a.result__a")
        if not a or not a.get("href"):
            continue
        u = _unwrap_ddg_url(str(a.get("href")).strip())
        if not u.startswith(("http://", "https://")) or u in seen:
            continue
        seen.add(u)
        src: dict[str, str] = {"url": u, "title": a.get_text(" ", strip=True)}
        snip = res.select_one(".result__snippet")
        if snip:
            src["snippet"] = snip.get_text(" ", strip=True)
        sources.append(src)
        if len(sources) >= max_results:
            break
    return sources


def cmd_search(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    if not query:
        raise CrawlerError("Search query must be non-empty", "WEB_PROVIDER_ERROR")
    max_results = max(1, min(20, int(payload.get("max_results") or 8)))
    searxng_url = str(payload.get("searxng_url") or os.environ.get("ARC_SEARXNG_URL") or "").strip()

    errors: list[str] = []

    if searxng_url:
        try:
            sources = _search_searxng(query, max_results, searxng_url)
            if sources:
                return {"ok": True, "engine": "searxng", "sources": sources, "truncated": False}
        except Exception as exc:
            errors.append(f"searxng: {exc}")

    try:
        sources = _search_ddgs(query, max_results)
        if sources:
            return {"ok": True, "engine": "ddgs", "sources": sources, "truncated": False}
    except Exception as exc:
        errors.append(f"ddgs: {exc}")

    try:
        sources = _search_ddg_html_fallback(query, max_results)
        if sources:
            return {"ok": True, "engine": "ddg_html_stealth", "sources": sources, "truncated": False}
    except Exception as exc:
        errors.append(f"ddg_html_stealth: {exc}")

    if errors:
        raise CrawlerError(f"All search backends failed ({'; '.join(errors)})", "WEB_PROVIDER_ERROR")
    return {"ok": True, "engine": "ddgs", "sources": [], "truncated": False}


# ---------------------------------------------------------------------------
# Bounded Same-Origin Crawler
# ---------------------------------------------------------------------------

def cmd_crawl(payload: dict[str, Any]) -> dict[str, Any]:
    start_url = validate_public_url(str(payload.get("url") or ""))
    max_pages = max(1, min(15, int(payload.get("max_pages") or 5)))
    max_depth = max(0, min(2, int(payload.get("max_depth") if payload.get("max_depth") is not None else 1)))
    path_prefix = str(payload.get("path_prefix") or "").strip()
    mode = str(payload.get("mode") or "auto")
    max_chars_per_page = max(1000, min(50_000, int(payload.get("max_chars_per_page") or 12_000)))
    timeout_s = max(10, min(45, int(payload.get("timeout_s") or 30)))

    start_parsed = urlparse(start_url)
    origin = (start_parsed.scheme, start_parsed.netloc.lower())

    queue: deque[tuple[str, int]] = deque([(start_url.split("#")[0], 0)])
    visited: set[str] = set()
    pages: list[dict[str, Any]] = []

    while queue and len(pages) < max_pages:
        current_url, depth = queue.popleft()
        if current_url in visited:
            continue
        visited.add(current_url)
        try:
            res = fetch_tiered(
                current_url,
                mode=mode,
                solve_cloudflare=True,
                interactive_captcha=False,
                timeout_s=timeout_s,
                max_chars=max_chars_per_page,
                include_links=True,
            )
            pages.append({
                "url": res["final_url"],
                "depth": depth,
                "status_code": res["status_code"],
                "tier": res["tier"],
                "bot_shield_bypassed": res["bot_shield_bypassed"],
                "verification_status": res["verification_status"],
                "title": (res.get("metadata") or {}).get("title", ""),
                "word_count": res.get("word_count", 0),
                "headings": res.get("headings", [])[:12],
                "markdown": res.get("markdown", ""),
                "truncated": res.get("truncated", False),
            })
            if depth < max_depth:
                for lnk in res.get("links") or []:
                    u = lnk.get("url", "")
                    p = urlparse(u)
                    if (p.scheme, p.netloc.lower()) != origin:
                        continue
                    if path_prefix and not p.path.startswith(path_prefix):
                        continue
                    if u not in visited:
                        queue.append((u, depth + 1))
        except Exception as exc:
            pages.append({
                "url": current_url,
                "depth": depth,
                "error": str(exc),
            })

    return {
        "ok": True,
        "start_url": start_url,
        "pages_crawled": len(pages),
        "pages": pages,
    }


def cmd_doctor(_payload: dict[str, Any]) -> dict[str, Any]:
    import importlib.util

    deps = {}
    for mod in ("scrapling", "curl_cffi", "patchright", "trafilatura", "ddgs", "bs4", "lxml", "markdownify", "pymupdf"):
        deps[mod] = bool(importlib.util.find_spec(mod))
    return {
        "ok": True,
        "python": sys.executable,
        "version": sys.version.split()[0],
        "dependencies": deps,
        "cookie_cache": str(COOKIE_FILE),
    }


def main() -> int:
    try:
        raw = sys.stdin.read()
        req = json.loads(raw) if raw.strip() else {}
        cmd = str(req.get("command") or "")
        payload = req.get("payload") or {}

        if cmd == "search":
            out = cmd_search(payload)
        elif cmd == "fetch":
            out = fetch_tiered(
                url=str(payload.get("url") or ""),
                mode=str(payload.get("mode") or "auto"),
                solve_cloudflare=bool(payload.get("solve_cloudflare", True)),
                interactive_captcha=bool(payload.get("interactive_captcha", False)),
                timeout_s=int(payload.get("timeout_s") or 45),
                max_chars=int(payload.get("max_chars") or 100_000),
                include_links=False,
            )
        elif cmd == "analyze":
            out = fetch_tiered(
                url=str(payload.get("url") or ""),
                mode=str(payload.get("mode") or "auto"),
                solve_cloudflare=bool(payload.get("solve_cloudflare", True)),
                interactive_captcha=bool(payload.get("interactive_captcha", False)),
                timeout_s=int(payload.get("timeout_s") or 60),
                max_chars=int(payload.get("max_chars") or 40_000),
                selector=str(payload.get("selector") or ""),
                include_links=bool(payload.get("include_links", True)),
            )
        elif cmd == "crawl":
            out = cmd_crawl(payload)
        elif cmd == "doctor":
            out = cmd_doctor(payload)
        elif cmd == "detect_challenge":
            out = {
                "ok": True,
                "challenge": detect_challenge(
                    int(payload.get("status_code") or 200),
                    payload.get("headers") or {},
                    str(payload.get("html") or ""),
                ),
            }
        else:
            raise CrawlerError(f"Unknown command '{cmd}'", "WEB_PROVIDER_ERROR")

        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return 0
    except CrawlerError as exc:
        sys.stdout.write(json.dumps({"ok": False, "code": exc.code, "error": str(exc)}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return 0
    except Exception as exc:
        sys.stdout.write(json.dumps({"ok": False, "code": "WEB_PROVIDER_ERROR", "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
