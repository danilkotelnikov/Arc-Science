import asyncio
import io
import json
import time
import httpx
import pytest
from PIL import Image
from conftest import module
from test_core import context, NOW

def fixture(tmp_path, provider='openai'):
    c=module('contracts');s=module('store');store=s.ArtifactStore(tmp_path/'cas')
    buffer=io.BytesIO();Image.new('RGB',(64,64),'white').save(buffer,format='PNG')
    view=store.put(buffer.getvalue(),name='figure.png',media_type='image/png',role='render')
    brief=store.put(json.dumps({'version':1,'panels':[{'view_digest':view.digest,
        'caption':'Blank synthetic test canvas.', 'claim_ids':[]}], 'claims':[]}).encode(),
        name='visual-brief.json',media_type='application/json',role='metadata')
    candidate=c.Candidate(project_id='p',producer_id='builder',policy_digest='b'*64,artifacts=(view,brief))
    seat=c.Seat(seat_id='r',provider=provider,model='pinned-model',group=provider,credential_ref='vault:ref',
                qualification_digest='d'*64,qualification_expires_at=NOW+100,vision=True,agent_id='arc-reviewer')
    return c,store,candidate,seat

def wire_review(c,candidate,seat):
    return c.Review(candidate_digest=candidate.digest,policy_digest=candidate.policy_digest,
        seat_id=seat.seat_id,observed_model=seat.model,reviewed_digests=tuple(candidate.render_digests),
        checks=tuple(c.Check(criterion=x,status='pass',evidence_digests=tuple(candidate.render_digests))
                     for x in ('visual_clarity','caption_alignment'))).model_dump_json()

@pytest.mark.parametrize('provider',['openai','anthropic','openclaw'])
def test_real_multimodal_payload_and_no_credentials_in_prompt(tmp_path,provider):
    t=module('transport');c,store,candidate,seat=fixture(tmp_path,provider)
    endpoint='https://gateway.example/v1/'+('messages' if provider=='anthropic' else 'responses')
    seen=[]
    def handler(request):
        body=json.loads(request.content);seen.append(body)
        assert 'sensitive-token' not in request.content.decode()
        assert str(tmp_path) not in request.content.decode()
        if provider=='anthropic':
            assert request.headers['x-api-key']=='sensitive-token'
            assert body['messages'][0]['content'][0]['type']=='image'
            return httpx.Response(200,json={'model':seat.model,'stop_reason':'end_turn',
                        'content':[{'type':'text','text':wire_review(c,candidate,seat)}]})
        assert request.headers['authorization']=='Bearer sensitive-token'
        image=body['input'][0]['content'][0]
        if provider=='openclaw':
            assert image['source']['type']=='base64'
            assert body['model']=='openclaw/arc-reviewer'
            assert 'x-openclaw-auth-profile' not in request.headers
        else:assert image['image_url'].startswith('data:image/png;base64,')
        return httpx.Response(200,json={'model':seat.model,'status':'completed',
                    'output':[{'type':'message','content':[{'type':'output_text','text':wire_review(c,candidate,seat)}]}]})
    async def go():
        grant=t.AccessGrant(token='sensitive-token',principal='u',project_id='p',resource=endpoint,
                            credential_ref='vault:ref',expires_at=NOW+20,
                            auth_style='x-api-key' if provider=='anthropic' else 'bearer')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            vc=t.VisionClient(endpoint,client=client,grant_resolver=lambda *_:grant)
            return await vc.review(candidate,seat,store,principal='u',now=NOW)
    review=asyncio.run(go())
    assert review.candidate_digest==candidate.digest and len(seen)==1

@pytest.mark.parametrize('field,value',[('principal','other'),('project_id','other'),
    ('resource','https://evil.example'),('credential_ref','vault:other'),('expires_at',NOW-1)])
def test_credential_binding_blocks_before_network(tmp_path,field,value):
    t=module('transport');_,store,candidate,seat=fixture(tmp_path)
    options=dict(token='secret',principal='u',project_id='p',resource='https://gateway.example/v1/responses',
                 credential_ref='vault:ref',expires_at=NOW+20)
    options[field]=value
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:pytest.fail('egress occurred'))) as client:
            vc=t.VisionClient('https://gateway.example/v1/responses',client=client,
                              grant_resolver=lambda *_:t.AccessGrant(**options))
            with pytest.raises(t.AuthorizationError):await vc.review(candidate,seat,store,principal='u',now=NOW)
    asyncio.run(go())

@pytest.mark.parametrize('status,body',[(302,{}),(401,{}),(200,{'status':'incomplete'}),
    (200,{'status':'completed','model':'other','output':[]}),(200,{'status':'completed','output':[]})])
def test_provider_failures_are_not_success(tmp_path,status,body):
    t=module('transport');_,store,candidate,seat=fixture(tmp_path)
    endpoint='https://gateway.example/v1/responses'
    async def go():
        grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=endpoint,
                            credential_ref='vault:ref',expires_at=NOW+20)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(status,json=body,
                                      headers={'location':'https://evil.example'}))) as client:
            vc=t.VisionClient(endpoint,client=client,grant_resolver=lambda *_:grant)
            with pytest.raises(t.ProviderError):await vc.review(candidate,seat,store,principal='u',now=NOW)
    asyncio.run(go())

def test_grant_repr_excludes_secret():
    t=module('transport')
    grant=t.AccessGrant(token='secret-token',principal='u',project_id='p',resource='https://example.org',
                        credential_ref='r',expires_at=NOW)
    assert 'secret-token' not in repr(grant)

def test_http_and_credential_urls_rejected():
    t=module('transport')
    for url in ['http://example.org','https://u:p@example.org','https://example.org/#x','https://example.org/?x=1']:
        with pytest.raises(ValueError):t.validate_endpoint(url)

def test_parallel_reviews_record_commitments_before_reveal(tmp_path):
    h=module('harness');c,candidate,seats,checks,reviews=context()
    s=module('store');ledger=s.EventLedger(tmp_path/'events.sqlite')
    active=0;peak=0
    class Client:
        async def review(self, candidate, seat, store, **kwargs):
            nonlocal active,peak
            active+=1;peak=max(active,peak);await asyncio.sleep(.01);active-=1
            return next(r for r in reviews if r.seat_id==seat.seat_id)
    async def go():
        return await h.review_candidate(candidate,seats,Client(),None,checks,ledger,
                                        principal='u',now=NOW,run_id='run-1',expected_seq=0)
    result=asyncio.run(go())
    assert result.eligible and peak==2 and ledger.verify(candidate.project_id)
    import sqlite3
    with sqlite3.connect(ledger.path) as db:
        kinds=[r[0] for r in db.execute('SELECT kind FROM events ORDER BY seq')]
    assert kinds==['review.commit','review.commit','review.reveal','review.reveal','candidate.assessed']

def test_review_exception_blocks_instead_of_skipping(tmp_path):
    h=module('harness');_,candidate,seats,checks,reviews=context();s=module('store')
    class Client:
        async def review(self,candidate,seat,store,**kwargs):
            if seat==seats[0]:raise RuntimeError('credential must not be logged')
            return reviews[1]
    async def go():
        return await h.review_candidate(candidate,seats,Client(),None,checks,s.EventLedger(tmp_path/'l'),
                             principal='u',now=NOW,run_id='r',expected_seq=0)
    result=asyncio.run(go());assert not result.eligible
    assert b'credential must not be logged' not in (tmp_path/'l').read_bytes()

def test_visual_review_rejects_missing_semantic_brief(tmp_path):
    t=module('transport');c,store,candidate,seat=fixture(tmp_path)
    candidate=candidate.model_copy(update={'artifacts':tuple(a for a in candidate.artifacts if a.role=='render')})
    endpoint='https://gateway.example/v1/responses'
    async def go():
        grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=endpoint,
                            credential_ref='vault:ref',expires_at=NOW+20)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:pytest.fail('missing brief sent'))) as client:
            vc=t.VisionClient(endpoint,client=client,grant_resolver=lambda *_:grant)
            with pytest.raises(t.ProviderError):await vc.review(candidate,seat,store,principal='u',now=NOW)
    asyncio.run(go())


def test_visual_review_transmits_bound_expected_caption(tmp_path):
    t=module('transport');c,store,candidate,seat=fixture(tmp_path)
    brief=store.put(json.dumps({'version':1,'panels':[{'view_digest':next(iter(candidate.render_digests)),
        'caption':'Illustrative assay; no observed data.', 'claim_ids':[]}], 'claims':[]}).encode(),
        name='visual-brief.json',media_type='application/json',role='metadata')
    candidate=candidate.model_copy(update={'artifacts':tuple(a for a in candidate.artifacts if a.role=='render')+(brief,)})
    endpoint='https://gateway.example/v1/responses'
    def handler(req):
        assert b'Illustrative assay; no observed data.' in req.content
        return httpx.Response(200,json={'model':seat.model,'status':'completed','output':[
            {'type':'message','content':[{'type':'output_text','text':wire_review(c,candidate,seat)}]}]})
    async def go():
        grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=endpoint,
                            credential_ref='vault:ref',expires_at=NOW+20)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await t.VisionClient(endpoint,client=client,grant_resolver=lambda *_:grant).review(
                candidate,seat,store,principal='u',now=NOW)
    assert asyncio.run(go()).candidate_digest==candidate.digest

def test_provider_schema_uses_homogeneous_items_for_bounding_box():
    t=module('transport');c=module('contracts')
    schema=t.strict_schema(c.Review.model_json_schema())
    box=schema['$defs']['Finding']['properties']['box']['anyOf'][0]
    assert box['items']=={'type':'number'} and 'prefixItems' not in box
    assert box['minItems']==4 and box['maxItems']==4


def test_provider_schema_rejects_heterogeneous_tuple_conversion():
    t=module('transport')
    with pytest.raises(ValueError):
        t.strict_schema({'type':'array','prefixItems':[{'type':'number'},{'type':'string'}]})
