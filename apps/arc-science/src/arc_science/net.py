"""Outbound HTTP through the operating system's proxy.

urllib.request.getproxies() reads the *_PROXY variables and, on Windows, falls back to
the Internet Options registry keys, so a system proxy (for example xray on
127.0.0.1:10809) is found with no environment set. httpx keeps trust_env=False: only
the proxy is taken, explicitly; .netrc and other environment settings stay ignored.
"""
from fnmatch import fnmatchcase
import ipaddress
import sys
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


def _registry_override() -> str | None:
    """Windows ProxyOverride for a registry proxy; getproxies_registry() never reports it as 'no'."""
    if sys.platform != 'win32' or urllib.request.getproxies_environment():
        return None  # *_PROXY variables win over the registry, with their own NO_PROXY
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
            return str(winreg.QueryValueEx(key, 'ProxyOverride')[0]) or None
    except OSError:
        return None


def _override_entries(override):
    return [entry.strip().lower() for entry in (override or '').split(';') if entry.strip()]


def _registry_bypass(host):
    """The ProxyOverride match urllib.request.proxy_bypass_registry() makes."""
    return any(('.' not in host) if entry == '<local>' else fnmatchcase(host.lower(), entry)
               for entry in _override_entries(_registry_override()))


def system_proxy(target: str | None = None) -> str | None:
    """The proxy URL for target (https by default), or None for a direct connection."""
    proxies = urllib.request.getproxies()
    parts = urlsplit(target or 'https://')
    host = parts.hostname or ''
    # host:port lets a port-specific NO_PROXY entry match; urllib also tries the bare host.
    netloc = f'{host}:{parts.port}' if parts.port is not None and ':' not in host else host
    if host and (_loopback(host) or urllib.request.proxy_bypass_environment(netloc, proxies)
                 or _registry_bypass(host)):
        return None
    proxy = proxies.get(parts.scheme or 'https') or proxies.get('all')
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


def proxy_environment(target: str) -> dict[str, str]:
    """Environment that pins a child calling only target to this process's decision for it.

    No bypass list is passed on: NO_PROXY and ProxyOverride match hosts differently, so a
    translated list could flip the target. A direct decision is pinned with NO_PROXY=* so
    the child does not fall back to a registry proxy the parent bypassed."""
    proxy = system_proxy(target)
    return {'HTTPS_PROXY': proxy, 'HTTP_PROXY': proxy} if proxy else {'NO_PROXY': '*'}
