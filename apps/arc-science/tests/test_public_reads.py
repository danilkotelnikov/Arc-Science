import asyncio
import httpx
import pytest


def tools(handler):
    from arc_science.exploration.public_reads import public_tools
    return public_tools(httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_literature_search_has_fixed_origin_and_snapshot_provenance():
    def handle(request):
        assert request.url.host=='www.ebi.ac.uk'
        assert request.url.params['query']=='protein ligand'
        return httpx.Response(200,json={'hitCount':1,'resultList':{'result':[{'id':'123','source':'MED','title':'A study','abstractText':'An abstract.'}]}})
    result=asyncio.run(tools(handle)['literature_search'][1]({'query':'protein ligand'}))
    assert result['records'][0]['title']=='A study'
    assert result['scope']=='retrieval_only_not_claim_verification'
    assert len(result['response_sha256'])==64


def test_pdb_metadata_does_not_accept_a_url_or_path():
    async def run():
        with pytest.raises(ValueError):await tools(lambda r:None)['pdb_metadata'][1]({'pdb_id':'../../secret'})
    asyncio.run(run())


def test_pdb_entry_snapshot_is_bound_to_accession():
    def handle(request):
        assert request.url.path.endswith('/1ATP')
        return httpx.Response(200,json={'rcsb_id':'1ATP','struct':{'title':'Structure'},'exptl':[{'method':'X-RAY DIFFRACTION'}]})
    result=asyncio.run(tools(handle)['pdb_metadata'][1]({'pdb_id':'1atp'}))
    assert result['accession']=='1ATP'
    assert result['snapshot']['rcsb_id']=='1ATP'


def test_public_read_redirect_is_not_followed():
    def handle(request):return httpx.Response(302,headers={'Location':'http://169.254.169.254'})
    with pytest.raises(ValueError):asyncio.run(tools(handle)['literature_search'][1]({'query':'test'}))
