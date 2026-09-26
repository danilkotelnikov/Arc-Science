"""Outbound HTTP through the operating system's proxy.

urllib.request.getproxies() reads the *_PROXY variables and, on Windows, falls back to
the Internet Options registry keys, so a system proxy (for example xray on
127.0.0.1:10809) is found with no environment set. httpx keeps trust_env=False: only
the proxy is taken, explicitly; .netrc and other environment settings stay ignored.
"""
import ipaddress
import urllib.request
from urllib.parse import urlsplit

import httpx


class ProxyUnsupported(ValueError):
    """The system proxy is not an http:// or https:// proxy (socks needs extra packages)."""


def _loopback(host):
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def system_proxy(target: str | None = None) -> str | None:
    """The proxy URL for target (https by default), or None for a direct connection."""
    proxies = urllib.request.getproxies()
    parts = urlsplit(target or 'https://')
    host = parts.hostname or ''
    if host and (_loopback(host) or urllib.request.proxy_bypass_environment(host, proxies)):
        return None
    proxy = proxies.get(parts.scheme or 'https')
    if not proxy:
        return None
    scheme = urlsplit(proxy).scheme.lower()
    if scheme not in {'http', 'https'} or not urlsplit(proxy).hostname:
        raise ProxyUnsupported(f'The system proxy uses {scheme or "an unknown"}://; Arc Science supports '
                               'only an http:// or https:// proxy. Switch the proxy to HTTP mode.')
    return proxy


def outbound_client(target: str | None = None, *, asynchronous: bool = False, **kwargs):
    """An httpx client for target that goes through the system proxy when one is set."""
    kwargs.setdefault('follow_redirects', False)
    # An injected transport owns routing; a proxy mount would silently replace it.
    if kwargs.get('transport') is None:
        proxy = system_proxy(target)
        if proxy:
            kwargs['proxy'] = proxy
            if target is None:  # a shared client may also call loopback endpoints: keep those direct
                kwargs['mounts'] = {'all://localhost': None, 'all://127.0.0.1': None, 'all://[::1]': None,
                                    **kwargs.get('mounts', {})}
    return (httpx.AsyncClient if asynchronous else httpx.Client)(trust_env=False, **kwargs)


def proxy_environment(target: str | None = None) -> dict[str, str]:
    """Environment entries that give a child process the same proxy as this one."""
    proxy = system_proxy(target)
    if not proxy:
        return {}
    bypass = urllib.request.getproxies().get('no')
    return {'HTTPS_PROXY': proxy, 'HTTP_PROXY': proxy, **({'NO_PROXY': bypass} if bypass else {})}
