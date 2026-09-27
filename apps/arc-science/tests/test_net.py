"""Outbound clients take the operating system's proxy explicitly (finding F004)."""
import ast
from pathlib import Path
import urllib.request

import httpx
import pytest

PROXY = 'http://127.0.0.1:10809'
SOURCE = Path(__file__).resolve().parents[1] / 'src' / 'arc_science'


@pytest.fixture
def system_proxy(monkeypatch):
    def use(value, override=None):
        monkeypatch.setattr(urllib.request, 'getproxies', lambda: dict(value))
        monkeypatch.setattr('arc_science.net._registry_override', lambda: override)
    use({'https': PROXY, 'http': PROXY, 'no': 'localhost,.internal.example'})
    return use


@pytest.fixture
def captured(monkeypatch):
    calls = []

    class Spy:
        def __init__(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr(httpx, 'Client', Spy)
    monkeypatch.setattr(httpx, 'AsyncClient', Spy)
    return calls


def test_outbound_client_uses_the_registry_or_environment_proxy(system_proxy, captured):
    from arc_science.net import outbound_client
    outbound_client('https://bioart.niaid.nih.gov', timeout=5)
    outbound_client('https://api.example.org', asynchronous=True)
    assert captured[0] == {'trust_env': False, 'follow_redirects': False, 'timeout': 5, 'proxy': PROXY}
    assert captured[1]['proxy'] == PROXY and captured[1]['trust_env'] is False


def test_loopback_and_no_proxy_hosts_bypass_the_proxy(system_proxy, captured):
    from arc_science.net import outbound_client, system_proxy as resolve
    for target in ('http://127.0.0.1:8765/mcp', 'http://localhost:9000', 'http://[::1]:80',
                   'https://api.internal.example/x'):
        assert resolve(target) is None, target
    outbound_client('http://127.0.0.1:8765/mcp')
    assert 'proxy' not in captured[0]


def test_a_shared_client_without_target_keeps_loopback_direct(system_proxy):
    from arc_science.net import outbound_client
    with outbound_client() as client:
        assert client._transport_for_url(httpx.URL('http://127.0.0.1:11434/v1')) is client._transport
        assert client._transport_for_url(httpx.URL('http://localhost:8765/mcp')) is client._transport
        assert client._transport_for_url(httpx.URL('https://api.example.org/v1')) is not client._transport


def test_injected_transport_is_never_overridden_by_the_proxy(system_proxy, captured):
    from arc_science.net import outbound_client
    transport = httpx.MockTransport(lambda request: httpx.Response(200))
    outbound_client('https://bioart.niaid.nih.gov', transport=transport)
    assert 'proxy' not in captured[0] and captured[0]['transport'] is transport


def test_no_system_proxy_means_a_direct_client(system_proxy, captured):
    from arc_science.net import outbound_client, proxy_environment
    system_proxy({})
    outbound_client('https://bioart.niaid.nih.gov')
    assert 'proxy' not in captured[0]
    assert proxy_environment('https://bioart.niaid.nih.gov') == {'NO_PROXY': '*'}


@pytest.mark.parametrize('value', ['socks5://127.0.0.1:10808', 'socks://127.0.0.1:1080', 'ftp://proxy:21'])
def test_socks_or_other_proxy_schemes_are_refused_with_a_clear_error(system_proxy, value):
    from arc_science.net import ProxyUnsupported, outbound_client
    system_proxy({'https': value})
    with pytest.raises(ProxyUnsupported, match=r'http:// or https://'):
        outbound_client('https://bioart.niaid.nih.gov')


def test_child_processes_receive_the_same_proxy(system_proxy):
    from arc_science.net import proxy_environment
    assert proxy_environment('https://bioart.niaid.nih.gov') == {'HTTPS_PROXY': PROXY, 'HTTP_PROXY': PROXY}


def test_bioart_worker_and_cli_children_inherit_the_system_proxy(system_proxy, monkeypatch):
    from arc_science.bioart.isolation import _worker_environment
    from arc_science.bioart.web import _cli_environment
    monkeypatch.setenv('TOP_SECRET', 'do-not-forward')
    for environment in (_worker_environment(), _cli_environment()):
        assert environment['HTTPS_PROXY'] == PROXY
        assert 'TOP_SECRET' not in environment


def test_bioart_owned_transport_passes_the_proxy_to_httpx(system_proxy, monkeypatch):
    from arc_science.bioart import BioArtClient
    import arc_science.net as net
    seen = []
    real = net.outbound_client

    def spy(target=None, **kwargs):
        seen.append(net.system_proxy(target))
        return real(target, transport=httpx.MockTransport(
            lambda request: httpx.Response(200, text='<html></html>', headers={'content-type': 'text/html'})), **kwargs)

    monkeypatch.setattr('arc_science.bioart.client.outbound_client', spy)
    client = BioArtClient(Path('unused'), allow_egress=True)
    assert client._request_bounded('/bioart/18', 1024, {'text/html'}, lambda: 5.0) == b'<html></html>'
    assert seen == [PROXY]


def test_windows_proxy_override_list_is_honoured_like_the_os(system_proxy, captured):
    from arc_science.net import outbound_client, system_proxy as resolve
    # A registry proxy: getproxies_registry() reports no 'no' key; ProxyOverride holds the bypass list.
    system_proxy({'https': PROXY, 'http': PROXY}, override='192.168.*; *.corp.example;<local>')
    for target in ('https://mcp.corp.example/mcp', 'https://MCP.Corp.Example/mcp', 'http://192.168.1.20:8000',
                   'http://intranet/x'):
        assert resolve(target) is None, target
    assert resolve('https://bioart.niaid.nih.gov') == PROXY
    assert resolve('https://corp.example.org') == PROXY
    outbound_client('https://mcp.corp.example/mcp', asynchronous=True)
    assert 'proxy' not in captured[0]



def test_registry_override_is_read_only_for_a_registry_proxy(monkeypatch):
    import sys
    from arc_science import net
    monkeypatch.setattr(sys, 'platform', 'win32')
    monkeypatch.setattr(urllib.request, 'getproxies_environment', lambda: {'https': PROXY})
    assert net._registry_override() is None  # *_PROXY variables win, with their own NO_PROXY


def test_biorender_discovery_reaches_biorender_through_the_system_proxy(system_proxy, monkeypatch, tmp_path):
    import asyncio
    from arc_science.biorender import BIORENDER_ENDPOINT
    from arc_science.exploration import biorender_read
    token = tmp_path / 'token'
    token.write_text('test-token', encoding='utf-8')
    monkeypatch.setenv('ARC_BIORENDER_TOKEN_FILE', str(token))
    monkeypatch.delenv('ARC_BIORENDER_PROTOCOL', raising=False)
    routed = []

    class Provider:
        def __init__(self, *, client, protocol, **_):
            routed.append(client._transport_for_url(httpx.URL(BIORENDER_ENDPOINT)) is not client._transport)
            self.protocol, self.schemas = protocol, {}

        async def discover(self, now):
            return 'sha256:test'

    monkeypatch.setattr(biorender_read, 'BioRenderClient', Provider)
    assert asyncio.run(biorender_read.discover_biorender())['schema_digest'] == 'sha256:test'
    assert routed == [True]


@pytest.mark.parametrize('module', ['bioart/client.py', 'prose.py', 'exploration/mcp_tools.py',
                                    'exploration/biorender_read.py', 'biorender.py'])
def test_owned_modules_build_no_direct_proxyless_httpx_client(module):
    tree = ast.parse((SOURCE / module).read_text(encoding='utf-8'))
    direct = [node.lineno for node in ast.walk(tree)
              if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and node.func.attr in {'Client', 'AsyncClient'}
              and isinstance(node.func.value, ast.Name) and node.func.value.id == 'httpx']
    assert direct == [], f'{module} constructs httpx clients directly at lines {direct}; use net.outbound_client'


ORIGIN = 'https://bioart.niaid.nih.gov'


def resolve_in_child(monkeypatch, environment, registry=None):
    """What a child process given exactly this environment resolves for ORIGIN."""
    import os
    from arc_science import net
    for name in list(os.environ):
        if name.lower().endswith('_proxy'):
            monkeypatch.delenv(name)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(urllib.request, 'getproxies',
                        lambda: urllib.request.getproxies_environment() or dict(registry or {}))
    monkeypatch.setattr(net, '_registry_override', lambda: None)
    return net.system_proxy(ORIGIN)


def test_a_registry_override_never_makes_the_child_bypass_a_proxied_origin(system_proxy, monkeypatch):
    from arc_science.net import proxy_environment, system_proxy as resolve
    # *.bioart.niaid.nih.gov does not match bioart.niaid.nih.gov itself, so the parent proxies it.
    system_proxy({'https': PROXY, 'http': PROXY}, override='*.bioart.niaid.nih.gov')
    assert resolve(ORIGIN) == PROXY
    assert resolve_in_child(monkeypatch, proxy_environment(ORIGIN)) == PROXY


def test_a_bypassed_origin_stays_direct_in_the_child_despite_a_registry_proxy(system_proxy, monkeypatch):
    from arc_science.net import proxy_environment
    system_proxy({'https': PROXY, 'http': PROXY, 'no': '.nih.gov'})
    assert resolve_in_child(monkeypatch, proxy_environment(ORIGIN), registry={'https': PROXY}) is None


def test_a_port_specific_no_proxy_entry_bypasses_that_port_only(system_proxy):
    from arc_science.net import system_proxy as resolve
    system_proxy({'https': PROXY, 'no': 'mcp.corp.example:8443'})
    assert resolve('https://mcp.corp.example:8443/mcp') is None
    assert resolve('https://mcp.corp.example/mcp') == PROXY


def test_a_port_specific_no_proxy_entry_matches_the_scheme_default_port(system_proxy):
    from arc_science.net import system_proxy as resolve
    system_proxy({'https': PROXY, 'http': PROXY, 'no': 'mcp.corp.example:443'})
    assert resolve('https://mcp.corp.example/mcp') is None
    assert resolve('https://mcp.corp.example:443/mcp') is None
    assert resolve('http://mcp.corp.example/mcp') == PROXY  # port 80 is not the listed port


def test_ipv6_no_proxy_entries_match_with_and_without_a_port(system_proxy):
    from arc_science.net import system_proxy as resolve
    system_proxy({'https': PROXY, 'no': '[2001:db8::123]:8443,2001:db8::7'})
    assert resolve('https://[2001:db8::123]:8443/x') is None
    assert resolve('https://[2001:db8::123]:9443/x') == PROXY
    assert resolve('https://[2001:db8::7]/x') is None


def test_all_proxy_applies_when_no_scheme_specific_proxy_is_set(system_proxy):
    from arc_science.net import ProxyUnsupported, system_proxy as resolve
    system_proxy({'all': PROXY})
    assert resolve(ORIGIN) == PROXY
    system_proxy({'all': 'socks5://127.0.0.1:10808', 'https': PROXY})
    assert resolve(ORIGIN) == PROXY  # the scheme-specific proxy wins
    system_proxy({'all': 'socks5://127.0.0.1:10808'})
    with pytest.raises(ProxyUnsupported):
        resolve(ORIGIN)
