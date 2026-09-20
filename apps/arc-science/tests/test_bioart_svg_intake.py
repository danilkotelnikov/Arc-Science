"""Synthetic regression cases for NIH's observed untyped, namespace-prefixed SVG."""
import hashlib
import json
import sys

import httpx
import pytest

from arc_science.bioart import BioArtClient
from test_bioart import page


SAFE_SVG = (b'<s:svg xmlns:s="http://www.w3.org/2000/svg" width="20" height="10">'
            b'<s:rect width="20" height="10" fill="#ffffff"/></s:svg>')
SOURCE_SVG = (b'<?xml version="1.0" encoding="utf-8"?>'
              b'<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 500 500">'
              b'<metadata><title>Synthetic antibody</title><license>Public Domain</license></metadata>'
              b'<ns0:defs><ns0:style>.cls-1 { fill: #222; }</ns0:style></ns0:defs>'
              b'<ns0:path class="cls-1" d="M 0 0 L 10 10"/></ns0:svg>')
STYLESHEET_SVG = ('<?xml version="1.0" encoding="utf-16"?>'
                  '<?xml-stylesheet type="text/css" href="https://outside.example/a.css"?>'
                  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">'
                  '<rect width="20" height="10"/></svg>').encode('utf-16')
SET_SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">'
           b'<image id="im"/><set href="#im" attributeName="href" '
           b'to="https://outside.example/a.png"/></svg>')


def _client(tmp_path, data, mime=None, *, metadata_mime='text/html'):
    calls=[]
    def respond(request):
        calls.append(str(request.url))
        if request.url.path=='/bioart/18':
            headers={} if metadata_mime is None else {'content-type':metadata_mime}
            return httpx.Response(200,content=page().encode(),headers=headers)
        assert request.url.path=='/api/bioarts/18/files/626860'
        headers={} if mime is None else {'content-type':mime}
        return httpx.Response(200,content=data,headers=headers)
    return BioArtClient(tmp_path/'cache',allow_egress=True,
        client=httpx.Client(transport=httpx.MockTransport(respond))),calls


def test_untyped_prefixed_svg_preserves_bytes_and_missing_type_with_existing_eligibility(tmp_path):
    client,calls=_client(tmp_path,SAFE_SVG)
    receipt=client.fetch(18,64,'SVG')
    value=client.verify(receipt.receipt_path)
    assert value['source_content_type'] is None
    assert value['sha256']==hashlib.sha256(SAFE_SVG).hexdigest()
    assert receipt.source_path.read_bytes()==SAFE_SVG
    assert value['preview_eligible'] is True and value['import_eligible'] is True
    client.allow_egress=False
    assert client.fetch(18,64,'SVG')==receipt
    assert len(calls)==2


def test_observed_viewbox_style_and_metadata_shape_remains_download_only(tmp_path):
    client,_=_client(tmp_path,SOURCE_SVG)
    receipt=client.fetch(18,64,'SVG')
    value=client.verify(receipt.receipt_path)
    assert value['source_content_type'] is None
    assert receipt.source_path.read_bytes()==SOURCE_SVG
    assert value['sha256']==hashlib.sha256(SOURCE_SVG).hexdigest()
    assert value['preview_eligible'] is False and value['import_eligible'] is False
    assert 'dimensions' in value['limitation']
    with pytest.raises(ValueError,match='eligible'):
        client.import_asset(receipt.receipt_path,tmp_path/'project')


@pytest.mark.parametrize('data',[
    b'<html><svg/></html>', b'{"error":"unavailable"}',
    b'<svg xmlns="https://wrong.example/svg" width="20" height="10"/>',
    b'<!DOCTYPE svg [<!ENTITY x "forbidden">]><svg>&x;</svg>',
    b'<?xml-stylesheet href="https://outside.example/a.css"?><svg/>',
    b'<svg><script>alert(1)</script></svg>',
    b'<svg><foreignObject><div>html</div></foreignObject></svg>',
    b'<svg onload="alert(1)"/>',
    b'<svg><image href="https://outside.example/a.png"/></svg>',
    b'<svg><style>@import "https://outside.example/a.css";</style></svg>',
    b'<svg><style>.x { fill: url(https://outside.example/a.svg); }</style></svg>',
])
def test_untyped_non_svg_or_active_xml_never_becomes_a_receipt(tmp_path,data):
    client,_=_client(tmp_path,data)
    with pytest.raises(ValueError): client.fetch(18,64,'SVG')
    assert not list((tmp_path/'cache').glob('*.receipt.json'))


def test_utf16_stylesheet_processing_instruction_is_rejected_before_receipt(tmp_path):
    client,_=_client(tmp_path,STYLESHEET_SVG)
    with pytest.raises(ValueError):
        client.verify(client.fetch(18,64,'SVG').receipt_path)
    assert not list((tmp_path/'cache').glob('*.receipt.json'))


def test_utf16_svg_without_processing_instruction_keeps_exact_safe_source(tmp_path):
    data=('<?xml version="1.0" encoding="utf-16"?>'+SAFE_SVG.decode()).encode('utf-16')
    client,_=_client(tmp_path,data)
    receipt=client.fetch(18,64,'SVG')
    value=client.verify(receipt.receipt_path)
    assert value['preview_eligible'] is True and value['import_eligible'] is True
    assert receipt.source_path.read_bytes()==data


@pytest.mark.parametrize('element',['set','animate','animateMotion','animateTransform','animateColor','discard'])
@pytest.mark.parametrize('target',['https://outside.example/a.png','javascript:alert(1)'])
def test_untyped_animation_cannot_rebind_a_reference(tmp_path,element,target):
    data=(f'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">'
          f'<image id="im"/><{element} href="#im" attributeName="href" to="{target}"/></svg>').encode()
    client,_=_client(tmp_path,data)
    with pytest.raises(ValueError):
        client.verify(client.fetch(18,64,'SVG').receipt_path)
    assert not list((tmp_path/'cache').glob('*.receipt.json'))


@pytest.mark.parametrize('data',[STYLESHEET_SVG,SET_SVG],ids=['utf16-stylesheet','animation'])
def test_existing_untyped_receipts_are_rechecked_for_active_content(tmp_path,data,monkeypatch):
    import arc_science.bioart.client as provider
    client,_=_client(tmp_path,data)
    # Simulate a receipt accepted before the passive-intake correction.
    with monkeypatch.context() as previous:
        previous.setattr(provider,'_validate_untyped_svg',lambda data:None)
        receipt=client.fetch(18,64,'SVG')
    with pytest.raises(ValueError): client.verify(receipt.receipt_path)


@pytest.mark.parametrize('mime',['text/html','application/json','application/octet-stream',''])
def test_declared_wrong_mime_stays_rejected_even_for_valid_svg(tmp_path,mime):
    client,_=_client(tmp_path,SAFE_SVG,mime)
    with pytest.raises(ValueError,match='MIME'): client.fetch(18,64,'SVG')
    assert not list((tmp_path/'cache').glob('*.receipt.json'))


def test_missing_metadata_mime_is_not_relaxed(tmp_path):
    client,_=_client(tmp_path,SAFE_SVG,metadata_mime=None)
    with pytest.raises(ValueError,match='MIME'): client.inspect(18)


def test_observed_declared_content_type_is_retained_without_reconstruction(tmp_path):
    client,_=_client(tmp_path,SAFE_SVG,'image/svg+xml; charset=utf-8')
    value=client.verify(client.fetch(18,64,'SVG').receipt_path)
    assert value['source_content_type']=='image/svg+xml; charset=utf-8'


def test_isolated_file_request_transfers_observed_missing_type(tmp_path,monkeypatch):
    import arc_science.bioart.client as provider
    calls=[]
    def child(path,limit,mimes,limits,*,metadata=None):
        calls.append(path)
        if path=='/bioart/18': return page().encode()
        assert path=='/api/bioarts/18/files/626860'
        assert metadata is not None
        metadata['content_type']=None
        return SAFE_SVG
    monkeypatch.setattr(provider,'request_in_child',child)
    client=BioArtClient(tmp_path/'cache',allow_egress=True)
    value=client.verify(client.fetch(18,64,'SVG').receipt_path)
    assert value['source_content_type'] is None
    assert len(calls)==2


@pytest.mark.parametrize('mimes',[{'image/png'},{'application/octet-stream'}])
def test_untyped_non_svg_downloads_stay_rejected(tmp_path,mimes):
    client,_=_client(tmp_path,SAFE_SVG)
    with pytest.raises(ValueError,match='MIME'):
        client._request('/api/bioarts/18/files/626860',1024,mimes)


@pytest.mark.parametrize('result',[
    {'ok':True}, {'ok':True,'content_type':42}, {'ok':True,'content_type':'a'*1025},
])
def test_worker_cannot_invent_or_omit_requested_response_metadata(tmp_path,result):
    from arc_science.bioart.isolation import run_worker
    # A trusted synthetic subprocess exercises the actual transfer schema, no network.
    code=('import pathlib,sys; p=pathlib.Path(sys.argv[1]); '
          'p.joinpath("response.bin").write_bytes(b"synthetic"); '
          f'p.joinpath("result.json").write_text({json.dumps(json.dumps(result))})')
    with pytest.raises(ValueError,match='response metadata'):
        run_worker([sys.executable,'-c',code],{},timeout=5,limit=1024,metadata={})


def test_owned_worker_environment_is_scrubbed_but_keeps_arc_science_importable(tmp_path, monkeypatch):
    from arc_science.bioart.isolation import run_worker

    monkeypatch.setenv('ARC_NATIVE_SESSION_SECRET', 'native-session-secret-must-not-leak')
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'operator-api-key-must-not-leak')
    monkeypatch.setenv('PYTHONPATH', '/unsafe/import/path')
    code = (
        'import json, os, pathlib, sys; '
        'import arc_science.bioart.worker; '
        'p=pathlib.Path(sys.argv[1]); '
        'payload={"has_secret":"ARC_NATIVE_SESSION_SECRET" in os.environ,'
        '"has_key":"ANTHROPIC_API_KEY" in os.environ,'
        '"pythonpath":os.environ.get("PYTHONPATH")}; '
        'p.joinpath("response.bin").write_bytes(json.dumps(payload).encode()); '
        'p.joinpath("result.json").write_text("{\\"ok\\": true}")'
    )

    payload = json.loads(run_worker([sys.executable, '-c', code], {}, timeout=5, limit=1024))

    assert payload['has_secret'] is False
    assert payload['has_key'] is False
    assert payload['pythonpath'] != '/unsafe/import/path'
    assert payload['pythonpath'].endswith('src')
