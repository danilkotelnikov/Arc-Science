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
    def use(value):
        monkeypatch.setattr(urllib.request, 'getproxies', lambda: dict(value))
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
    assert proxy_environment('https://bioart.niaid.nih.gov') == {}


@pytest.mark.parametrize('value', ['socks5://127.0.0.1:10808', 'socks://127.0.0.1:1080', 'ftp://proxy:21'])
def test_socks_or_other_proxy_schemes_are_refused_with_a_clear_error(system_proxy, value):
    from arc_science.net import ProxyUnsupported, outbound_client
    system_proxy({'https': value})
    with pytest.raises(ProxyUnsupported, match=r'http:// or https://'):
        outbound_client('https://bioart.niaid.nih.gov')


def test_child_processes_receive_the_same_proxy(system_proxy):
    from arc_science.net import proxy_environment
    assert proxy_environment('https://bioart.niaid.nih.gov') == {
        'HTTPS_PROXY': PROXY, 'HTTP_PROXY': PROXY, 'NO_PROXY': 'localhost,.internal.example'}


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


@pytest.mark.parametrize('module', ['bioart/client.py', 'prose.py', 'exploration/mcp_tools.py'])
def test_owned_modules_build_no_direct_proxyless_httpx_client(module):
    tree = ast.parse((SOURCE / module).read_text(encoding='utf-8'))
    direct = [node.lineno for node in ast.walk(tree)
              if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and node.func.attr in {'Client', 'AsyncClient'}
              and isinstance(node.func.value, ast.Name) and node.func.value.id == 'httpx']
    assert direct == [], f'{module} constructs httpx clients directly at lines {direct}; use net.outbound_client'
