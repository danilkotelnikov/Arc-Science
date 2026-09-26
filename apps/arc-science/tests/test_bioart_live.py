"""Opt-in live check against NIH BioArt through the system proxy: ARC_LIVE_BIOART=1."""
import json
import os

import pytest

pytestmark = pytest.mark.skipif(os.environ.get('ARC_LIVE_BIOART') != '1',
                                reason='live NIH request; set ARC_LIVE_BIOART=1 to run')


def test_live_search_inspect_fetch_and_import(tmp_path):
    from arc_science.bioart import BioArtClient
    client = BioArtClient(tmp_path / 'cache', allow_egress=True)
    hits = client.search('antibody')
    antibody = next(hit for hit in hits if hit.entry_id == 18)
    assert antibody.title == 'Antibody' and antibody.thumbnail_file_id
    data, media_type = client.thumbnail(18, antibody.thumbnail_file_id)
    assert media_type in {'image/jpeg', 'image/png'} and data
    entry = client.inspect(18)
    assert entry.license == 'Public Domain'
    svg = client.verify(client.fetch(18, None, 'SVG').receipt_path)
    assert svg['schema'] == 'arc-bioart-asset/2' and svg['preview_eligible'] is True
    ai = client.fetch(18, None, 'AI')
    manifest = json.loads(client.import_asset(ai.receipt_path, tmp_path / 'project').read_bytes())
    assert manifest['source']['content_kind'] in {'vector', 'mixed_vector_image'}
