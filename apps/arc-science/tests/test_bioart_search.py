"""Search through NIH's discoverSearch Server Action, from recorded responses (2026-09-26)."""
import json
from pathlib import Path

import httpx
import pytest

from arc_science.bioart import BioArtClient
from arc_science.bioart.errors import BioArtError, describe

FIXTURES = Path(__file__).parent / 'fixtures/bioart'
ACTION = '4026f1528e81a7884142b2affd16c95633da420e11'
CHUNK = '/_next/static/chunks/app/(standard)/discover/page-6080d85019a6f7dc.js'


def recorded(name):
    return (FIXTURES / name).read_bytes()


def nih(*, page=None, chunk=None, action=None, files=None, calls=None):
    """A MockTransport answering like NIH did, from the recorded fixtures."""
    calls = [] if calls is None else calls
    actions = list(action) if isinstance(action, list) else None

    def respond(request):
        calls.append((request.method, request.url.path, request))
        if request.method == 'POST' and request.url.path == '/discover':
            body = actions.pop(0) if actions is not None else (action or recorded('discover-action-antibody.rsc'))
            if body == 'stale':
                return httpx.Response(404, content=recorded('discover-action-not-found.txt'),
                                      headers={'content-type': 'text/plain', 'x-nextjs-action-not-found': '1'})
            return httpx.Response(200, content=body, headers={'content-type': 'text/x-component'})
        if request.url.path == '/discover':
            return httpx.Response(200, content=page or recorded('discover-page-reduced.html'),
                                  headers={'content-type': 'text/html; charset=utf-8'})
        if request.url.path == CHUNK:
            return httpx.Response(200, content=chunk or recorded('discover-chunk-reduced.js'),
                                  headers={'content-type': 'application/javascript; charset=UTF-8'})
        if files and request.url.path in files:
            data, mime = files[request.url.path]
            return httpx.Response(200, content=data, headers={} if mime is None else {'content-type': mime})
        return httpx.Response(404, text='not recorded', headers={'content-type': 'text/html'})

    return httpx.MockTransport(respond), calls


def provider(tmp_path, transport, egress=True):
    return BioArtClient(tmp_path / 'cache', allow_egress=egress, client=httpx.Client(transport=transport))


def test_search_resolves_the_action_and_posts_the_escaped_query(tmp_path):
    transport, calls = nih()
    hits = provider(tmp_path, transport).search("antibody")
    by_id = {hit.entry_id: hit for hit in hits}
    assert by_id[18].title == 'Antibody' and by_id[250].title == 'IgG'
    assert by_id[250].thumbnail_file_id == 650431
    assert len(hits) == 7
    assert [(method, path) for method, path, _ in calls] == [
        ('GET', '/discover'), ('GET', CHUNK), ('POST', '/discover')]
    post = calls[2][2]
    assert post.headers['next-action'] == ACTION
    assert post.headers['accept'] == 'text/x-component'
    assert post.headers['content-type'] == 'text/plain;charset=UTF-8'
    assert json.loads(post.content) == ['type:bioart AND antibody?start=0&size=24']


def test_search_is_cached_under_the_discover_key_and_replays_without_egress(tmp_path):
    transport, calls = nih()
    client = provider(tmp_path, transport)
    first = client.search('antibody')
    client.allow_egress = False
    assert client.search('antibody') == first
    assert len(calls) == 3


def test_stale_action_is_re_resolved_exactly_once(tmp_path):
    transport, calls = nih(action=['stale', recorded('discover-action-antibody.rsc')])
    assert provider(tmp_path, transport).search('antibody')[0].entry_id == 18
    assert [method for method, _, _ in calls] == ['GET', 'GET', 'POST', 'GET', 'GET', 'POST']


def test_stale_action_after_re_resolving_is_drift(tmp_path):
    transport, calls = nih(action=['stale', 'stale'])
    with pytest.raises(BioArtError) as raised:
        provider(tmp_path, transport).search('antibody')
    assert raised.value.code == 'bioart.drift'
    assert sum(method == 'POST' for method, _, _ in calls) == 2


@pytest.mark.parametrize('change', ['no-chunk', 'no-action', 'bad-rsc'])
def test_missing_chunk_action_or_result_is_drift(tmp_path, change):
    transport, _ = nih(
        page=b'<html><script src="/_next/static/chunks/main-app-1.js"></script></html>' if change == 'no-chunk' else None,
        chunk=recorded('discover-chunk-reduced.js').replace(b'"discoverSearch"', b'"somethingElse"') if change == 'no-action' else None,
        action=b'0:{"a":"$@1"}\n1:{"status":{}}\n' if change == 'bad-rsc' else None)
    with pytest.raises(BioArtError) as raised:
        provider(tmp_path, transport).search('antibody')
    assert raised.value.code == 'bioart.drift'


@pytest.mark.parametrize('query', ['a?start=999', 'x AND license:*', '"', 'a&b', '(x)', '[x]', '{x}',
                                   'x\\y', 'type:3d', 'a*', ' ', 'x' * 201])
def test_query_syntax_is_refused_before_any_request(tmp_path, query):
    transport, calls = nih()
    with pytest.raises(BioArtError) as raised:
        provider(tmp_path, transport).search(query)
    assert raised.value.code == 'bioart.invalid_query'
    assert calls == []


@pytest.mark.parametrize('query', ["Crohn's", 'T-cell', 'antibody 2', 'Антитело'])
def test_plain_words_hyphens_and_apostrophes_are_searchable(tmp_path, query):
    transport, calls = nih()
    provider(tmp_path, transport).search(query)
    assert json.loads(calls[2][2].content) == [f'type:bioart AND {query}?start=0&size=24']


def test_connection_failure_is_unreachable_and_never_reads_as_a_timeout(tmp_path):
    def refuse(request):
        raise httpx.ConnectError('getaddrinfo failed', request=request)
    with pytest.raises(BioArtError) as raised:
        provider(tmp_path, httpx.MockTransport(refuse)).search('antibody')
    assert raised.value.code == 'bioart.unreachable'
    assert 'timeout' not in str(raised.value).lower()
    assert describe(raised.value)['code'] == 'bioart.unreachable'


def test_codes_survive_the_worker_process_boundary_as_text():
    from arc_science.bioart.errors import from_text
    original = BioArtError('bioart.http_status', 'BioArt HTTP 404; no redirect or access fallback', status=404)
    rebuilt = from_text('BioArt CLI failed: ' + str(original))
    assert (rebuilt.code, rebuilt.facts) == ('bioart.http_status', {'status': 404})
    assert describe(ValueError('Missing or stale cache; explicit --allow-egress required'))['code'] == 'bioart.failed'
    assert describe(ValueError('BioArt request total timeout'))['code'] == 'bioart.timeout'
