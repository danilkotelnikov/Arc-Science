"""Source-derived metadata, synthetic file bytes; never live file-retrieval evidence."""
import hashlib
import importlib
import json
import os
from pathlib import Path

import httpx
import pytest

FIXTURE = Path(__file__).parent / 'fixtures/bioart/entry-18-reduced.json'
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#ffffff"/></svg>'


def api():
    try:
        return importlib.import_module('arc_science.bioart')
    except ModuleNotFoundError:
        pytest.fail('BioArt provider is not implemented')


def page(records=None):
    if records is None:
        records = json.loads(FIXTURE.read_text())['records']
    # Next serializes Flight rows within a JSON string, sometimes split mid-row.
    flight = '11:' + json.dumps(records) + '\n'
    cut = len(flight)//2
    return ''.join('<script>self.__next_f.push(' + json.dumps([1, chunk]) + ')</script>'
                   for chunk in (flight[:cut], flight[cut:]))


def transport_client(tmp_path, *, data=SVG, mime='image/svg+xml', status=200, limits=None, egress=True):
    requests = []
    def respond(request):
        requests.append(str(request.url))
        assert request.url.host == 'bioart.niaid.nih.gov'
        if request.url.path == '/bioart/18':
            return httpx.Response(200, text=page(), headers={'content-type':'text/html'})
        assert request.url.path == '/api/bioarts/18/files/626860'
        return httpx.Response(status, content=data, headers={'content-type':mime,'location':'https://evil.test/file','retry-after':'0'})
    client = api().BioArtClient(tmp_path/'cache', allow_egress=egress,
        client=httpx.Client(transport=httpx.MockTransport(respond)), limits=limits)
    return client, requests


def test_source_derived_mapping_and_credit():
    entry = api().parse_entry(page(), 18)
    assert entry.entry_id == 18
    assert entry.title == 'Antibody'
    assert entry.license == 'Public Domain'
    assert entry.creator == 'Ryan Kissinger'
    assert entry.credit == 'Courtesy of NIAID'
    assert entry.collection == 'NIAID Visual & Medical Arts'
    assert 'bioart.niaid.nih.gov/bioart/18' in entry.citation
    assert entry.representations[0].group_id == 64
    assert entry.representations[0].files['SVG'] == 626860
    assert entry.preferred_representation_id == 64


@pytest.mark.parametrize('change', ['license','mapping','duplicate','binding','identity','malformed'])
def test_schema_drift_rejected(change):
    records = json.loads(FIXTURE.read_text())['records']
    if change == 'license': records.pop(4)
    if change == 'mapping': records[3]['filemapping']['64']['PNG'] = 9
    if change == 'duplicate': records[3]['filemapping']['64']['SVG'] = 626859
    if change == 'binding': records[2]['carouselItems'][0]['srcImg'] = '/api/bioarts/505/files/626859'
    if change == 'identity': records[0]['children'] = 'BIOART-000505'
    html = page(records) if change != 'malformed' else '<script>self.__next_f.push([1,"11:{oops"])</script>'
    with pytest.raises(ValueError, match='schema|Schema'):
        api().parse_entry(html,18)


def test_search_deduplicates_links_and_rejects_shell():
    # Synthetic public-link shape, not the shell-only source capture.
    hits = api().parse_search('<a href="/bioart/18">Antibody</a><a href="/bioart/18">Antibody</a><a href="/bioart/505">Syringe</a>')
    assert [(h.entry_id,h.title) for h in hits] == [(18,'Antibody'),(505,'Syringe')]
    with pytest.raises(ValueError,match='schema|Schema'):
        api().parse_search('<html>Client rendering required</html>')


def test_cache_only_requires_no_network_and_fetch_is_bound(tmp_path):
    client, requests = transport_client(tmp_path, egress=False)
    with pytest.raises(ValueError, match='egress|cache'): client.inspect(18)
    assert requests == []
    client.allow_egress = True
    receipt = client.fetch(18,64,'svg')
    value = client.verify(receipt.receipt_path)
    assert value['schema'] == 'arc-bioart-asset/1'
    assert value['file_id'] == 626860
    assert value['sha256'] == hashlib.sha256(SVG).hexdigest()
    assert receipt.source_path.read_bytes() == SVG
    assert value['preview_eligible'] is True
    assert value['import_eligible'] is True
    client.allow_egress = False
    assert client.inspect(18).title == 'Antibody'
    again = client.fetch(18,64,'SVG')
    assert again == receipt
    assert requests == ['https://bioart.niaid.nih.gov/bioart/18','https://bioart.niaid.nih.gov/api/bioarts/18/files/626860']


@pytest.mark.parametrize('status,count',[(401,1),(403,1),(302,1),(429,3),(500,3)])
def test_denials_redirects_and_retries_are_bounded(tmp_path,status,count):
    client,requests=transport_client(tmp_path,status=status)
    with pytest.raises(ValueError,match='HTTP|redirect'): client.fetch(18,64,'svg')
    assert len(requests) == count+1


@pytest.mark.parametrize('data,mime',[(SVG,'text/html'),(b'<html>denied</html>','image/svg+xml'),(b'','image/svg+xml')])
def test_invalid_file_response_never_becomes_receipt(tmp_path,data,mime):
    client,_=transport_client(tmp_path,data=data,mime=mime)
    with pytest.raises(ValueError): client.fetch(18,64,'svg')
    assert not list((tmp_path/'cache').glob('*.receipt.json'))


def test_unsafe_svg_is_preserved_but_not_importable(tmp_path):
    client,_=transport_client(tmp_path,data=b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    receipt=client.fetch(18,64,'svg')
    value=client.verify(receipt.receipt_path)
    assert value['preview_eligible'] is False
    assert value['import_eligible'] is False
    with pytest.raises(ValueError,match='eligible'): client.import_asset(receipt.receipt_path,tmp_path/'project')


def test_missing_format_group_unknown_license(tmp_path):
    client,requests=transport_client(tmp_path)
    with pytest.raises(ValueError,match='representation'): client.fetch(18,999,'svg')
    with pytest.raises(ValueError,match='format'): client.fetch(18,64,'../../svg')
    records=json.loads(FIXTURE.read_text())['records']; records[4]['children'][1][3]['children']='Rights reserved'
    client=api().BioArtClient(tmp_path/'other',allow_egress=True,client=httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,text=page(records),headers={'content-type':'text/html'}))))
    with pytest.raises(ValueError,match='license.*review'): client.fetch(18,64,'svg')
    assert len(requests)==1


def test_corrupt_source_and_receipt_traversal_rejected(tmp_path):
    client,_=transport_client(tmp_path)
    receipt=client.fetch(18,64,'svg')
    original=receipt.source_path.read_bytes();receipt.source_path.write_bytes(b'tampered')
    with pytest.raises(ValueError,match='hash|digest|size'): client.verify(receipt.receipt_path)
    receipt.source_path.write_bytes(original)
    value=json.loads(receipt.receipt_path.read_text());value['source_file']='../outside.svg'
    receipt.receipt_path.write_text(json.dumps(value))
    with pytest.raises(ValueError): client.verify(receipt.receipt_path)


def test_symlink_cache_root_and_artifact_rejected(tmp_path):
    outside=tmp_path/'outside';outside.mkdir();(tmp_path/'cache').symlink_to(outside,target_is_directory=True)
    with pytest.raises(ValueError): transport_client(tmp_path)[0].inspect(18)
    (tmp_path/'cache').unlink()
    client,_=transport_client(tmp_path);receipt=client.fetch(18,64,'svg')
    receipt.source_path.unlink();(outside/'source.svg').write_bytes(SVG);receipt.source_path.symlink_to(outside/'source.svg')
    with pytest.raises(ValueError): client.verify(receipt.receipt_path)


def test_limits_and_native_environment_bridge(tmp_path,monkeypatch):
    monkeypatch.setenv('ARC_BIOART_MAX_FILE_BYTES','17')
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR','custom-cache')
    settings=api().BioArtSettings.from_environment(tmp_path)
    assert settings.cache_dir == tmp_path/'custom-cache'
    assert settings.limits.max_file_bytes == 17
    client,_=transport_client(tmp_path,limits=settings.limits)
    with pytest.raises(ValueError,match='size|limit'): client.fetch(18,64,'svg')
    for value in ('0','-1','nan','3.5','9999999999999999999'):
        monkeypatch.setenv('ARC_BIOART_MAX_FILE_BYTES',value)
        with pytest.raises(ValueError): api().BioArtSettings.from_environment(tmp_path)


def test_cli_cache_commands_and_import_match_both_validators(tmp_path,capsys,monkeypatch):
    client,_=transport_client(tmp_path)
    receipt=client.fetch(18,64,'svg')
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR',str(tmp_path/'cache'))
    from arc_science.cli import main
    assert main(['bioart','inspect','18','--project',str(tmp_path)])==0
    assert json.loads(capsys.readouterr().out)['title']=='Antibody'
    assert main(['bioart','verify',str(receipt.receipt_path)])==0
    assert json.loads(capsys.readouterr().out)['sha256']==hashlib.sha256(SVG).hexdigest()
    assert main(['bioart','import',str(receipt.receipt_path),'--project',str(tmp_path)])==0
    manifest=Path(json.loads(capsys.readouterr().out)['asset_manifest'])
    from arc_science.vector_assets import verify_asset
    from arc_science.figure_contract import validate_asset
    value=verify_asset(manifest)
    assert value['provenance']['origin']=='nih_bioart'
    assert value['source']['sha256']==hashlib.sha256(SVG).hexdigest()
    fd=os.open(manifest.parent,os.O_RDONLY|os.O_DIRECTORY)
    try: validate_asset(fd,manifest.parent.name)
    finally: os.close(fd)
    assert main(['bioart','inspect','505','--project',str(tmp_path)])==1
    assert 'egress' in capsys.readouterr().err


def test_source_replacement_between_verify_and_import_is_rejected(tmp_path,monkeypatch):
    client,_=transport_client(tmp_path);receipt=client.fetch(18,64,'svg')
    original=client.verify
    def verify_then_replace(path):
        value=original(path)
        receipt.source_path.write_bytes(SVG.replace(b'#ffffff',b'#000000'))
        return value
    monkeypatch.setattr(client,'verify',verify_then_replace)
    with pytest.raises(ValueError,match='hash|digest'):
        client.import_asset(receipt.receipt_path,tmp_path/'project')
    assert not (tmp_path/'project/assets').exists()


def test_svg_over_existing_import_limit_is_download_only(tmp_path):
    data=SVG.replace(b'</svg>',b'<!--'+b'a'*(16*1024**2)+b'--></svg>')
    client,_=transport_client(tmp_path,data=data)
    receipt=client.fetch(18,64,'svg')
    assert client.verify(receipt.receipt_path)['import_eligible'] is False


def test_search_snapshot_cli_records_source_without_egress(tmp_path,capsys):
    source=Path(__file__).parent/'fixtures/bioart/search-browser-reduced.html'
    from arc_science.cli import main
    assert main(['bioart','search','antibody','--project',str(tmp_path),'--search-html',str(source)])==0
    value=json.loads(capsys.readouterr().out)
    assert [(h['entry_id'],h['title']) for h in value['hits']]==[(18,'Antibody'),(17,'Antibody'),(250,'IgG'),(249,'IGE'),(248,'IgA'),(85,'Complement C1 Complex'),(575,'White Pulp')]
    assert value['source_kind']=='operator_supplied_browser_snapshot'
    assert value['source_url']=='https://bioart.niaid.nih.gov/discover?q=antibody&sort=relevance'
    assert value['source_sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
    assert Path(value['snapshot_record']).is_file()


@pytest.mark.parametrize('kind',['expired','corrupt','missing-page','truncated-index'])
def test_metadata_cache_faults_do_not_trigger_hidden_network(tmp_path,kind):
    client,requests=transport_client(tmp_path);client.inspect(18)
    index=next((tmp_path/'cache').glob('metadata-*.json'));value=json.loads(index.read_text())
    if kind=='expired': value['retrieved_at']=1;index.write_text(json.dumps(value))
    if kind=='corrupt': (tmp_path/'cache'/f"{value['sha256']}.html").write_text('bad')
    if kind=='missing-page': (tmp_path/'cache'/f"{value['sha256']}.html").unlink()
    if kind=='truncated-index': index.write_text('{')
    client.allow_egress=False
    with pytest.raises(ValueError):client.inspect(18)
    assert len(requests)==1


def test_changed_metadata_does_not_rebind_previous_receipt(tmp_path):
    client,requests=transport_client(tmp_path);first=client.fetch(18,64,'svg')
    index=next((tmp_path/'cache').glob('metadata-*.json'));value=json.loads(index.read_text());value['retrieved_at']=1;index.write_text(json.dumps(value))
    records=json.loads(FIXTURE.read_text())['records'];records[1]['children']='Updated Antibody'
    def respond(request):
        if request.url.path=='/bioart/18':return httpx.Response(200,text=page(records),headers={'content-type':'text/html'})
        return httpx.Response(200,content=SVG,headers={'content-type':'image/svg+xml'})
    client.client=httpx.Client(transport=httpx.MockTransport(respond))
    second=client.fetch(18,64,'svg')
    assert first.receipt_path!=second.receipt_path
    assert first.source_path==second.source_path
    assert client.verify(first.receipt_path)['title']=='Antibody'
    assert client.verify(second.receipt_path)['title']=='Updated Antibody'


def test_timeout_is_bounded_and_cache_budget_refuses_write(tmp_path):
    attempts=[]
    def timeout(request):
        attempts.append(request);raise httpx.ReadTimeout('synthetic timeout')
    client=api().BioArtClient(tmp_path/'cache',allow_egress=True,client=httpx.Client(transport=httpx.MockTransport(timeout)))
    with pytest.raises(ValueError,match='timeout'):client.inspect(18)
    assert len(attempts)==3
    client,_=transport_client(tmp_path,limits=api().BioArtLimits(max_cache_bytes=50))
    with pytest.raises(ValueError,match='budget'):client.inspect(18)
    assert list((tmp_path/'cache').iterdir())==[]


def test_stream_limit_without_content_length(tmp_path):
    class Body(httpx.SyncByteStream):
        def __iter__(self):
            yield b'a'*3000
            yield b'b'*3000
    client=api().BioArtClient(tmp_path/'cache',allow_egress=True,limits=api().BioArtLimits(max_metadata_bytes=5000),
        client=httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,stream=Body(),headers={'content-type':'text/html'}))))
    with pytest.raises(ValueError,match='size'):client.inspect(18)


def test_compressed_http_response_rejected_before_decompression(tmp_path):
    import gzip
    client=api().BioArtClient(tmp_path/'cache',allow_egress=True,client=httpx.Client(transport=httpx.MockTransport(
        lambda r:httpx.Response(200,content=gzip.compress(page().encode()),headers={'content-type':'text/html','content-encoding':'gzip'}))))
    with pytest.raises(ValueError,match='encoding'):client.inspect(18)


@pytest.mark.parametrize('retry_after',['99999','NaN','not-a-date'])
def test_unbounded_or_invalid_retry_after_stops(tmp_path,retry_after):
    calls=[]
    def respond(request):
        calls.append(request)
        return httpx.Response(429,headers={'retry-after':retry_after})
    client=api().BioArtClient(tmp_path/'cache',allow_egress=True,client=httpx.Client(transport=httpx.MockTransport(respond)))
    with pytest.raises(ValueError,match='Retry-After'):client.inspect(18)
    assert len(calls)==1


def test_search_image_alt_wins_over_decorative_anchor_text():
    assert api().parse_search('<a href="/bioart/18"><img alt="Antibody">Collection Grey BIOART-000018</a>')[0].title=='Antibody'


@pytest.mark.parametrize('field,value',[('max_retries',3),('timeout_seconds',0),('metadata_ttl_seconds',-1),('max_cache_bytes',True)])
def test_strict_limits(field,value):
    with pytest.raises(ValueError):api().BioArtLimits(**{field:value})


def test_config_bridge_invalid_path_and_unknown_values(tmp_path,monkeypatch):
    for path in ('../escape',str(tmp_path),''):
        monkeypatch.setenv('ARC_BIOART_CACHE_DIR',path)
        with pytest.raises(ValueError):api().BioArtSettings.from_environment(tmp_path)
    monkeypatch.delenv('ARC_BIOART_CACHE_DIR');monkeypatch.setenv('ARC_BIOART_MISSPELLED','3')
    with pytest.raises(ValueError):api().BioArtSettings.from_environment(tmp_path)


def test_verify_cli_respects_native_limit(tmp_path,monkeypatch,capsys):
    client,_=transport_client(tmp_path);receipt=client.fetch(18,64,'svg')
    from arc_science.cli import main
    monkeypatch.setenv('ARC_BIOART_MAX_FILE_BYTES','5')
    assert main(['bioart','verify',str(receipt.receipt_path)])==1
    error=capsys.readouterr().err
    assert 'bounded' in error or 'limit' in error


def test_http_truncated_body_not_cached(tmp_path):
    client=api().BioArtClient(tmp_path/'cache',allow_egress=True,client=httpx.Client(transport=httpx.MockTransport(
        lambda r:httpx.Response(200,content=page().encode(),headers={'content-type':'text/html','content-length':str(len(page().encode())+100)}))))
    with pytest.raises(ValueError,match='length|truncated'):client.inspect(18)
    assert list((tmp_path/'cache').iterdir())==[]


def test_corrupt_fetch_index_has_controlled_error(tmp_path):
    client,_=transport_client(tmp_path);client.fetch(18,64,'svg')
    index=next((tmp_path/'cache').glob('fetch-*.json'));index.write_text('{"receipt": []}')
    with pytest.raises(ValueError):client.fetch(18,64,'svg')


def test_svg_huge_dimensions_are_not_eligible(tmp_path):
    client,_=transport_client(tmp_path,data=SVG.replace(b'width="20"',b'width="9999999999999999999999999999999999999999999"'))
    receipt=client.fetch(18,64,'svg')
    assert client.verify(receipt.receipt_path)['import_eligible'] is False


@pytest.mark.parametrize('format,file_id,mime,data,preview',[('AI',626856,'application/postscript',b'%!PS-Adobe-3.0 synthetic',False),('EPS',626857,'application/postscript',b'%!PS-Adobe-3.0 EPSF-3.0 synthetic',False),('PNG',626859,'image/png',None,True)])
def test_non_svg_originals_have_explicit_download_preview_limits(tmp_path,format,file_id,mime,data,preview):
    if data is None:
        from io import BytesIO
        from PIL import Image
        stream=BytesIO();Image.new('RGBA',(4,4),(1,2,3,4)).save(stream,format='PNG');data=stream.getvalue()
    def respond(request):
        if request.url.path=='/bioart/18':return httpx.Response(200,text=page(),headers={'content-type':'text/html'})
        assert request.url.path==f'/api/bioarts/18/files/{file_id}'
        return httpx.Response(200,content=data,headers={'content-type':mime})
    client=api().BioArtClient(tmp_path/'cache',allow_egress=True,client=httpx.Client(transport=httpx.MockTransport(respond)))
    receipt=client.fetch(18,64,format);value=client.verify(receipt.receipt_path)
    assert receipt.source_path.read_bytes()==data
    assert value['sha256']==hashlib.sha256(data).hexdigest()
    assert value['import_eligible'] is False
    assert value['preview_eligible'] is preview
    assert value['limitation']


def test_search_query_is_encoded_and_reused_offline(tmp_path):
    calls=[]
    def respond(request):
        calls.append(str(request.url))
        return httpx.Response(200,text='<a href="/bioart/18">Antibody</a>',headers={'content-type':'text/html'})
    client=api().BioArtClient(tmp_path/'cache',allow_egress=True,client=httpx.Client(transport=httpx.MockTransport(respond)))
    assert client.search('antibody & grey')[0].entry_id==18
    client.allow_egress=False
    assert client.search('antibody & grey')[0].entry_id==18
    assert calls==['https://bioart.niaid.nih.gov/discover?q=antibody+%26+grey&sort=relevance']


def test_malicious_duplicate_flight_mapping_json_rejected():
    flight='11:{"filemapping":{"64":{"SVG":1,"SVG":2}}}\n'
    html='<script>self.__next_f.push('+json.dumps([1,flight])+')</script>'
    with pytest.raises(ValueError,match='schema'):api().parse_entry(html,18)
