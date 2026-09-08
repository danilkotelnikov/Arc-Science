import importlib
import pytest

def module(name):
    try:
        return importlib.import_module('arc_science.' + name)
    except ModuleNotFoundError as exc:
        pytest.fail(f'Implementation module missing: {exc.name}')


# Recorded discovery metadata only; the SVGs used with it remain synthetic.
_BIOR_RENDER_ID = '62c743fda5cf881ed2d8695f'
_BIOR_RENDER_DETAIL = 'https://app.biorender.com/biorender-templates/details/t-62c743fda5cf881ed2d8695f'


@pytest.fixture(params=[
    pytest.param((_BIOR_RENDER_DETAIL + '?source=mcp', _BIOR_RENDER_ID, True), id='recorded-detail'),
    pytest.param((_BIOR_RENDER_DETAIL, _BIOR_RENDER_ID, True), id='detail-without-query'),
    pytest.param((_BIOR_RENDER_DETAIL, '67a6525d6b16d9c8b3ac70a0', False), id='mismatched-id'),
    pytest.param(('https://app.biorender.com/templates/tpl-1', 'tpl-1', False), id='invented-templates-route'),
    *[pytest.param((url, _BIOR_RENDER_ID, False), id=label) for label, url in [
        ('http', _BIOR_RENDER_DETAIL.replace('https:', 'http:')),
        ('root-domain', _BIOR_RENDER_DETAIL.replace('app.biorender.com', 'biorender.com')),
        ('other-subdomain', _BIOR_RENDER_DETAIL.replace('app.biorender.com', 'other.biorender.com')),
        ('misleading-host', _BIOR_RENDER_DETAIL.replace('app.biorender.com', 'app.biorender.com.evil.example')),
        ('suffix-host', _BIOR_RENDER_DETAIL.replace('app.biorender.com', 'notbiorender.com')),
        ('username', _BIOR_RENDER_DETAIL.replace('app.', 'user@app.', 1)),
        ('credentials', _BIOR_RENDER_DETAIL.replace('app.', 'user:password@app.', 1)),
        ('port', _BIOR_RENDER_DETAIL.replace('app.biorender.com', 'app.biorender.com:443')),
        ('empty-port', _BIOR_RENDER_DETAIL.replace('app.biorender.com', 'app.biorender.com:')),
        ('invalid-port', _BIOR_RENDER_DETAIL.replace('app.biorender.com', 'app.biorender.com:bad')),
        ('fragment', _BIOR_RENDER_DETAIL + '#figure'),
        ('empty-fragment', _BIOR_RENDER_DETAIL + '#'),
        ('extra-path', _BIOR_RENDER_DETAIL + '/export'),
        ('trailing-slash', _BIOR_RENDER_DETAIL + '/'),
        ('missing-t-prefix', _BIOR_RENDER_DETAIL.replace('/t-', '/')),
        ('dot-segment', _BIOR_RENDER_DETAIL.replace('/details/', '/details/../details/')),
        ('encoded-path', _BIOR_RENDER_DETAIL.replace('/t-', '/%74-')),
        ('unknown-query', _BIOR_RENDER_DETAIL + '?download=1'),
        ('wrong-source', _BIOR_RENDER_DETAIL + '?source=web'),
        ('duplicate-query', _BIOR_RENDER_DETAIL + '?source=mcp&source=mcp'),
        ('extra-query', _BIOR_RENDER_DETAIL + '?source=mcp&download=1'),
        ('empty-query', _BIOR_RENDER_DETAIL + '?'),
        ('empty-source', _BIOR_RENDER_DETAIL + '?source='),
        ('encoded-query', _BIOR_RENDER_DETAIL + '?source=%6dcp'),
        ('trailing-query-separator', _BIOR_RENDER_DETAIL + '?source=mcp&'),
    ]],
])
def biorender_provenance_case(request):
    url, template_id, accepted = request.param
    return {
        'origin': 'biorender', 'title': 'Protein Homology Modeling',
        'source_url': url, 'template_id': template_id,
        'permission_note': 'Synthetic contract test; no BioRender export or rights qualification.',
        'external_rendering_authorized': True,
    }, accepted
