"""Untyped NIH files by magic bytes, tolerant entries and arc-bioart-asset/2 receipts."""
from io import BytesIO
import hashlib
import json
from pathlib import Path

import httpx
from PIL import Image
import pytest

from arc_science.bioart import BioArtClient, parse_entry
from arc_science.bioart.cache import digest, encoded
from test_bioart import page
from test_bioart_search import recorded

FIXTURES = Path(__file__).parent / 'fixtures/bioart'
FILES = {'SVG': 626860, 'PNG': 626859, 'AI': 626856, 'EPS': 626857}


def records(entry):
    return json.loads((FIXTURES / f'entry-{entry}-reduced.json').read_bytes())['records']


def png(size=(12, 8)):
    out = BytesIO()
    Image.new('RGB', size, '#336699').save(out, 'PNG')
    return out.getvalue()


def ai():
    """A one-page vector PDF, as NIH serves its PDF-compatible AI files."""
    from reportlab.pdfgen import canvas
    out = BytesIO()
    sheet = canvas.Canvas(out, pagesize=(200, 100))
    sheet.setFillColorRGB(0.2, 0.4, 0.6)
    sheet.rect(10, 10, 120, 60, fill=1)
    sheet.showPage(); sheet.save()
    return out.getvalue()


def eps_with_header(size):
    header = b''.join(b'%% comment %d\r\n' % i for i in range(size // 16 + 1))
    return header + b'%!PS-Adobe-3.1 EPSF-3.0\r\n%%BoundingBox: 0 0 10 10\r\n'


def provider(tmp_path, format, data, mime=None, *, entry=18, entry_records=None):
    calls = []
    file_id = FILES.get(format)

    def respond(request):
        calls.append(request.url.path)
        if request.url.path == f'/bioart/{entry}':
            return httpx.Response(200, content=page(entry_records).encode(), headers={'content-type': 'text/html'})
        assert request.url.path.startswith(f'/api/bioarts/{entry}/files/')
        return httpx.Response(200, content=data, headers={} if mime is None else {'content-type': mime})

    return BioArtClient(tmp_path / 'cache', allow_egress=True,
                        client=httpx.Client(transport=httpx.MockTransport(respond))), calls


@pytest.mark.parametrize('format,data,preview,importable', [
    ('PNG', png(), True, False),
    ('AI', ai(), False, True),
    ('EPS', recorded('file-626832-head.eps'), False, False),
    ('SVG', recorded('file-626835.svg'), True, False),
], ids=['png', 'ai-as-pdf', 'eps-recorded-header', 'svg-recorded-626835'])
def test_untyped_files_become_v2_receipts_by_magic_bytes(tmp_path, format, data, preview, importable):
    client, _ = provider(tmp_path, format, data)
    receipt = client.fetch(18, 64, format)
    value = client.verify(receipt.receipt_path)
    assert value['schema'] == 'arc-bioart-asset/2'
    assert value['source_content_type'] is None and value['sniffed_format'] == format
    assert value['sha256'] == hashlib.sha256(data).hexdigest()
    assert (value['preview_eligible'], value['import_eligible']) == (preview, importable)
    assert receipt.source_path.read_bytes() == data


@pytest.mark.parametrize('format,data', [
    ('AI', png()), ('PNG', b'<html><body>Not found</body></html>'), ('EPS', eps_with_header(5000)),
    ('EPS', ai()), ('PNG', recorded('file-626835.svg')), ('AI', recorded('file-626832-head.eps')),
    ('EPS', b'<html>%!PS-Adobe-3.0</html>'),
], ids=['png-as-ai', 'html-as-png', 'eps-comment-block-over-4k', 'pdf-as-eps', 'svg-as-png', 'eps-as-ai', 'html-as-eps'])
def test_mismatched_magic_bytes_never_become_a_receipt(tmp_path, format, data):
    client, _ = provider(tmp_path, format, data)
    with pytest.raises(ValueError, match='magic|signature'):
        client.fetch(18, 64, format)
    assert not list((tmp_path / 'cache').glob('*.receipt.json'))


@pytest.mark.parametrize('format,data,mime', [('PNG', png(), 'text/html'), ('AI', ai(), 'image/png'),
                                              ('EPS', recorded('file-626832-head.eps'), 'text/plain')])
def test_a_declared_but_wrong_mime_type_stays_refused(tmp_path, format, data, mime):
    client, _ = provider(tmp_path, format, data, mime)
    with pytest.raises(ValueError, match='MIME'):
        client.fetch(18, 64, format)


def test_ai_receipt_imports_as_pdf_without_any_svg_rasterizer(tmp_path, monkeypatch):
    monkeypatch.delenv('ARC_SVG2PNG', raising=False)
    client, _ = provider(tmp_path, 'AI', ai())
    receipt = client.fetch(18, 64, 'AI')
    manifest = client.import_asset(receipt.receipt_path, tmp_path / 'project')
    value = json.loads(manifest.read_bytes())
    assert value['source']['file'] == 'source.pdf' and value['source']['content_kind'] == 'vector'
    assert 'source format AI (PDF-compatible)' in value['provenance']['permission_note']


def test_import_vector_kind_overrides_the_suffix_and_rejects_unknown_kinds(tmp_path):
    from arc_science.vector_assets import import_vector
    source = tmp_path / 'art.ai'
    source.write_bytes(ai())
    provenance = {'origin': 'nih_bioart', 'title': 'Test', 'source_url': 'https://bioart.niaid.nih.gov/bioart/18',
                  'permission_note': 'Public Domain', 'external_rendering_authorized': True}
    with pytest.raises(ValueError, match='Only SVG and PDF'):
        import_vector(source, tmp_path / 'p', provenance)
    with pytest.raises(ValueError, match='kind'):
        import_vector(source, tmp_path / 'p', provenance, kind='eps')
    assert import_vector(source, tmp_path / 'p', provenance, kind='pdf').is_file()


def test_entry_without_a_credit_line_parses_and_fetches(tmp_path):
    entry = parse_entry(page(records(700)), 700)
    assert entry.credit is None and entry.title == 'Toll-like Receptor'
    assert entry.representations[0].files == {'EPS': 784254, 'SVG': 784256, 'PNG': 784257, 'AI': 784258}
    client, _ = provider(tmp_path, 'PNG', png(), entry=700, entry_records=records(700))
    value = client.verify(client.fetch(700, 2471, 'PNG').receipt_path)
    assert value['credit'] is None and value['schema'] == 'arc-bioart-asset/2'


def test_carousel_jpg_absent_from_the_mapping_is_preview_only():
    entry = parse_entry(page(records(300)), 300)
    [representation] = entry.representations
    assert representation.files == {'AI': 631662}
    assert representation.preview_file_id == 651048
    assert entry.credit == 'Courtesy of NIAID'


@pytest.mark.parametrize('change', ['group-missing', 'src-mismatch', 'mapped-format-other-file'])
def test_tolerance_keeps_every_other_drift_check(change):
    data = records(300)
    item = data[2]['carouselItems'][0]
    if change == 'group-missing': item['bioartFileGroupId'] = 9999
    if change == 'src-mismatch': item['srcImg'] = '/api/bioarts/300/files/1'
    if change == 'mapped-format-other-file': item['fileFormat'] = 'AI'
    with pytest.raises(ValueError, match='schema'):
        parse_entry(page(data), 300)


def _v1_receipt(client, data, *, format='SVG', content_type='image/svg+xml', preview=True, eligible=True,
                limitation=None):
    """Write a receipt exactly as arc-bioart-asset/1 did (the native client still writes these)."""
    html = page().encode()
    page_sha = digest(html)
    sha = digest(data)
    value = {'schema': 'arc-bioart-asset/1', 'entry_id': 18, 'entry_url': 'https://bioart.niaid.nih.gov/bioart/18',
             'title': 'Antibody', 'license': 'Public Domain', 'credit': 'Courtesy of NIAID',
             'creator': 'Ryan Kissinger', 'collection': 'NIAID Visual & Medical Arts',
             'citation': 'NIAID Visual & Medical Arts. (10/7/2024). Antibody. NIAID NIH BIOART Source. bioart.niaid.nih.gov/bioart/18',
             'representation_id': 64, 'caption': 'Antibody - Grey', 'format': format, 'file_id': FILES[format],
             'retrieved_at': 1_780_000_000.0, 'source_page_sha256': page_sha, 'sha256': sha, 'size': len(data),
             'source_file': sha + '.' + format.lower(), 'source_content_type': content_type,
             'preview_eligible': preview, 'import_eligible': eligible, 'limitation': limitation,
             'rights_verified': False, 'scientific_validity_established': False}
    raw = encoded(value)
    client.cache.write({page_sha + '.html': html, value['source_file']: data, digest(raw) + '.receipt.json': raw})
    return client.cache.root / (digest(raw) + '.receipt.json')


SAFE_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>'


def test_v1_receipts_stay_verifiable_under_v1_rules(tmp_path):
    client = BioArtClient(tmp_path / 'cache')
    assert client.verify(_v1_receipt(client, SAFE_SVG))['schema'] == 'arc-bioart-asset/1'
    observed = recorded('file-626835.svg')
    # v1 kept the observed viewBox-only shape download-only, and still does for v1 receipts.
    old = _v1_receipt(client, observed, content_type=None, preview=False, eligible=False,
                      limitation='SVG requires finite positive pixel dimensions')
    try:
        assert client.verify(old)['preview_eligible'] is False
    except ValueError as error:
        pytest.fail(f'v1 receipt no longer verifies: {error}')


def test_v1_receipt_cannot_claim_the_v2_preview_rule(tmp_path):
    client = BioArtClient(tmp_path / 'cache')
    forged = _v1_receipt(client, recorded('file-626835.svg'), content_type=None, preview=True, eligible=False,
                         limitation='SVG requires finite positive pixel dimensions')
    with pytest.raises(ValueError, match='eligibility'):
        client.verify(forged)


def test_v2_receipt_rechecks_magic_bytes(tmp_path):
    client, _ = provider(tmp_path, 'PNG', png())
    receipt = client.fetch(18, 64, 'PNG')
    value = json.loads(receipt.receipt_path.read_bytes())
    value['sniffed_format'] = 'AI'
    raw = encoded(value)
    client.cache.write({digest(raw) + '.receipt.json': raw})
    with pytest.raises(ValueError):
        client.verify(client.cache.root / (digest(raw) + '.receipt.json'))


def test_thumbnail_is_size_limited_and_must_be_an_image(tmp_path):
    thumb = recorded('thumbnail-650431.jpg')
    client, calls = provider(tmp_path, 'PNG', thumb, entry=250)
    data, media_type = client.thumbnail(250, 650431)
    assert (data, media_type) == (thumb, 'image/jpeg')
    client.allow_egress = False
    assert client.thumbnail(250, 650431) == (thumb, 'image/jpeg')
    assert calls == ['/api/bioarts/250/files/650431']
    for bad in (b'<html>nope</html>', b'\xff\xd8\xff' + b'\0' * (600 * 1024)):
        other, _ = provider(tmp_path / 'other', 'PNG', bad, entry=250)
        with pytest.raises(ValueError):
            other.thumbnail(250, 650431)
