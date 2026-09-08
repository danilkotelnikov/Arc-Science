"""Selection and CLI behavior using synthetic bytes and local HTTP transports only."""
import hashlib
import json

import httpx
import pytest

from arc_science.bioart import BioArtClient, parse_entry
from arc_science.cli import main


ENTRY_ID = 18
SYNTHETIC_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8">'
    b'<rect width="12" height="8" fill="#123456"/></svg>'
)


def _label(label, value):
    return {
        'children': [
            ['$', 'label', None, {'children': label}],
            ['$', 'value', None, {'children': value}],
        ]
    }


def _page(representations, *, license='Public Domain'):
    carousel = []
    mapping = {}
    for representation in representations:
        files = representation['files']
        preview_format = 'PNG' if 'PNG' in files else next(iter(files))
        preview_file = files[preview_format]
        group_id = representation['group_id']
        carousel.append({
            'fileId': preview_file,
            'fileFormat': preview_format,
            'bioartFileGroupId': group_id,
            'caption': representation['caption'],
            'srcImg': f'/api/bioarts/{ENTRY_ID}/files/{preview_file}',
        })
        mapping[str(group_id)] = files
    records = [
        {'children': 'BIOART-000018'},
        {'variant': 'h4', 'children': 'Synthetic antibody'},
        {'carouselItems': carousel},
        {'filemapping': mapping},
        _label('Licensing:', license),
        _label('Collection', 'Synthetic test collection'),
        _label('Creator', 'Synthetic test creator'),
        _label('Credit', 'Synthetic test credit'),
        _label('Cite This Entry', 'Synthetic test citation'),
    ]
    flight = '11:' + json.dumps(records) + '\n'
    return '<script>self.__next_f.push(' + json.dumps([1, flight]) + ')</script>'


def _client(tmp_path, representations, *, license='Public Domain', allow_egress=True):
    requests = []
    page = _page(representations, license=license)
    svg_file_ids = {
        representation['files']['SVG']
        for representation in representations
        if 'SVG' in representation['files']
    }

    def respond(request):
        requests.append(str(request.url))
        if request.url.path == f'/bioart/{ENTRY_ID}':
            return httpx.Response(200, text=page, headers={'content-type': 'text/html'})
        file_id = int(request.url.path.rsplit('/', 1)[1])
        assert file_id in svg_file_ids
        return httpx.Response(200, content=SYNTHETIC_SVG,
                              headers={'content-type': 'image/svg+xml'})

    transport = httpx.MockTransport(respond)
    client = BioArtClient(tmp_path / 'cache', allow_egress=allow_egress,
                          client=httpx.Client(transport=transport))
    return client, requests


def _verified(client, receipt):
    return client.verify(receipt.receipt_path)


def test_fetch_defaults_to_svg_and_prefers_compatible_neutral_caption(tmp_path):
    client, requests = _client(tmp_path, [
        {'group_id': 101, 'caption': 'Antibody - Colored',
         'files': {'PNG': 1001, 'SVG': 1002}},
        {'group_id': 102, 'caption': 'Antibody - Grey',
         'files': {'PNG': 1003, 'SVG': 1004}},
    ])

    value = _verified(client, client.fetch(ENTRY_ID))

    assert value['format'] == 'SVG'
    assert value['representation_id'] == 102
    assert value['file_id'] == 1004
    assert value['caption'] == 'Antibody - Grey'
    assert requests[-1].endswith('/api/bioarts/18/files/1004')


def test_neutral_representation_without_svg_is_filtered_before_preference(tmp_path):
    client, _ = _client(tmp_path, [
        {'group_id': 111, 'caption': 'Antibody - Colored',
         'files': {'PNG': 1101, 'SVG': 1102}},
        {'group_id': 112, 'caption': 'Antibody - Grey',
         'files': {'PNG': 1103}},
    ])

    value = _verified(client, client.fetch(ENTRY_ID))

    assert (value['representation_id'], value['file_id']) == (111, 1102)


def test_no_compatible_format_fails_without_file_request(tmp_path):
    client, requests = _client(tmp_path, [
        {'group_id': 121, 'caption': 'Antibody - Grey', 'files': {'PNG': 1201}},
        {'group_id': 122, 'caption': 'Antibody - Colored', 'files': {'PNG': 1202}},
    ])

    with pytest.raises(ValueError, match='SVG.*representation|representation.*SVG'):
        client.fetch(ENTRY_ID)

    assert requests == ['https://bioart.niaid.nih.gov/bioart/18']


def test_explicit_colored_representation_is_authoritative(tmp_path):
    client, requests = _client(tmp_path, [
        {'group_id': 131, 'caption': 'Antibody - Colored',
         'files': {'PNG': 1301, 'SVG': 1302}},
        {'group_id': 132, 'caption': 'Antibody - Grayscale',
         'files': {'PNG': 1303, 'SVG': 1304}},
    ])

    value = _verified(client, client.fetch(ENTRY_ID, 131, 'svg'))

    assert (value['representation_id'], value['file_id'], value['caption']) == (
        131, 1302, 'Antibody - Colored')
    assert requests[-1].endswith('/api/bioarts/18/files/1302')


def test_explicit_group_missing_requested_format_is_not_substituted(tmp_path):
    client, requests = _client(tmp_path, [
        {'group_id': 141, 'caption': 'Antibody - Colored', 'files': {'PNG': 1401}},
        {'group_id': 142, 'caption': 'Antibody - Grey',
         'files': {'PNG': 1402, 'SVG': 1403}},
    ])

    with pytest.raises(ValueError, match='Format absent from representation'):
        client.fetch(ENTRY_ID, 141, 'SVG')

    assert requests == ['https://bioart.niaid.nih.gov/bioart/18']


@pytest.mark.parametrize('caption', [
    'Grayling antibody',
    'Disagreement antibody',
    'Blackwhiteboard antibody',
])
def test_neutral_like_substrings_do_not_match(caption, tmp_path):
    client, _ = _client(tmp_path, [
        {'group_id': 151, 'caption': 'Antibody - Colored',
         'files': {'PNG': 1501, 'SVG': 1502}},
        {'group_id': 152, 'caption': caption,
         'files': {'PNG': 1503, 'SVG': 1504}},
    ])

    value = _verified(client, client.fetch(ENTRY_ID))

    assert value['representation_id'] == 151


@pytest.mark.parametrize('caption', [
    'Antibody GREY',
    'Antibody gray',
    'Antibody greyscale',
    'Antibody Grayscale',
    'Antibody black-and-white',
    'Antibody black and white',
    'Antibody blackwhite',
])
def test_all_explicit_neutral_labels_are_recognized(caption):
    entry = parse_entry(_page([
        {'group_id': 161, 'caption': 'Antibody - Colored',
         'files': {'PNG': 1601, 'SVG': 1602}},
        {'group_id': 162, 'caption': caption,
         'files': {'PNG': 1603, 'SVG': 1604}},
    ]), ENTRY_ID)

    assert entry.preferred_representation_id == 162


def test_neutral_ties_keep_source_order(tmp_path):
    client, _ = _client(tmp_path, [
        {'group_id': 171, 'caption': 'Antibody - Grayscale',
         'files': {'PNG': 1701, 'SVG': 1702}},
        {'group_id': 172, 'caption': 'Antibody - Grey',
         'files': {'PNG': 1703, 'SVG': 1704}},
    ])

    value = _verified(client, client.fetch(ENTRY_ID))

    assert value['representation_id'] == 171


def test_restricted_license_blocks_selected_fetch_before_file_request(tmp_path):
    client, requests = _client(tmp_path, [
        {'group_id': 181, 'caption': 'Antibody - Grey',
         'files': {'PNG': 1801, 'SVG': 1802}},
    ], license='CC BY 4.0')

    with pytest.raises(ValueError, match='restricted license.*blocked'):
        client.fetch(ENTRY_ID)

    assert requests == ['https://bioart.niaid.nih.gov/bioart/18']


def test_validation_and_cache_miss_never_create_hidden_egress(tmp_path):
    client, requests = _client(tmp_path, [
        {'group_id': 191, 'caption': 'Antibody - Grey',
         'files': {'PNG': 1901, 'SVG': 1902}},
    ], allow_egress=False)

    with pytest.raises(ValueError, match='Unsupported BioArt format'):
        client.fetch(ENTRY_ID, format='pdf')
    with pytest.raises(ValueError, match='Invalid BioArt identity'):
        client.fetch(ENTRY_ID, 0)
    with pytest.raises(ValueError, match='egress'):
        client.fetch(ENTRY_ID)

    assert requests == []


def test_second_default_fetch_is_fully_cached_and_legacy_interface_still_works(tmp_path):
    representations = [
        {'group_id': 201, 'caption': 'Antibody - Colored',
         'files': {'PNG': 2001, 'SVG': 2002}},
        {'group_id': 202, 'caption': 'Antibody - Black and White',
         'files': {'PNG': 2003, 'SVG': 2004}},
    ]
    client, requests = _client(tmp_path, representations)

    first = client.fetch(ENTRY_ID)
    client.allow_egress = False
    second = client.fetch(ENTRY_ID)
    legacy = client.fetch(ENTRY_ID, 202, 'svg')

    assert second == first
    assert legacy == first
    assert requests == [
        'https://bioart.niaid.nih.gov/bioart/18',
        'https://bioart.niaid.nih.gov/api/bioarts/18/files/2004',
    ]


def test_real_cli_default_fetch_uses_seeded_cache_and_reports_verified_ids(tmp_path, capsys,
                                                                          monkeypatch):
    representations = [
        {'group_id': 211, 'caption': 'Antibody - Colored',
         'files': {'PNG': 2101, 'SVG': 2102}},
        {'group_id': 212, 'caption': 'Antibody - Grey',
         'files': {'PNG': 2103, 'SVG': 2104}},
    ]
    client, requests = _client(tmp_path, representations)
    seeded = client.fetch(ENTRY_ID, 212, 'SVG')
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', str(tmp_path / 'cache'))

    assert main(['bioart', 'fetch', str(ENTRY_ID), '--project', str(tmp_path)]) == 0
    value = json.loads(capsys.readouterr().out)

    assert value['representation_id'] == 212
    assert value['file_id'] == 2104
    assert value['caption'] == 'Antibody - Grey'
    assert value['sha256'] == hashlib.sha256(SYNTHETIC_SVG).hexdigest()
    assert value['source'] == str(seeded.source_path)
    assert requests == [
        'https://bioart.niaid.nih.gov/bioart/18',
        'https://bioart.niaid.nih.gov/api/bioarts/18/files/2104',
    ]
