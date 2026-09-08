import asyncio
import json
import time
import httpx
import pytest


def agent(transport,**kwargs):
    from arc_science.exploration.providers import HTTPAgent, ModelEndpoint
    from arc_science.transport import AccessGrant
    client=httpx.AsyncClient(transport=httpx.MockTransport(transport))
    cfg=ModelEndpoint(provider=kwargs.get('provider','openai'),endpoint='https://api.example/v1/responses',model='qualified-model',credential_ref='model-secret')
    def grant(ref,principal,project):
        return AccessGrant(token='secret-value',principal=principal,project_id=project,resource=cfg.endpoint,
                           credential_ref=ref,expires_at=int(time.time())+300,
                           auth_style='x-api-key' if cfg.provider=='anthropic' else 'bearer')
    return HTTPAgent(cfg,client=client,resolver=grant,project='mission',principal='local')


def proposal():return {'branches':[],'actions':[],'stop':True,'reason':'No data available.'}


def test_openai_request_is_direct_structured_and_keeps_secret_out_of_body():
    def handle(request):
        body=json.loads(request.content)
        assert request.headers['authorization']=='Bearer secret-value'
        assert b'secret-value' not in request.content
        assert body['text']['format']['type']=='json_schema'
        assert body.get('tools',[])==[]
        return httpx.Response(200,json={'status':'completed','model':'qualified-model','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(proposal())}]}]})
    result=asyncio.run(agent(handle).propose({'goal':'Explore', 'tools':{}}))
    assert result==proposal()


def test_anthropic_response_contract():
    def handle(request):
        assert request.headers['x-api-key']=='secret-value'
        body=json.loads(request.content);assert body['messages'][0]['role']=='user'
        return httpx.Response(200,json={'model':'qualified-model','stop_reason':'end_turn','content':[{'type':'text','text':json.dumps(proposal())}]})
    assert asyncio.run(agent(handle,provider='anthropic').propose({}))==proposal()


@pytest.mark.parametrize('status',[301,401,429,500])
def test_provider_errors_and_redirects_do_not_return_success(status):
    from arc_science.transport import ProviderError
    def handle(request):return httpx.Response(status,headers={'Location':'https://evil.example'},text='secret-value')
    with pytest.raises(ProviderError) as exc:asyncio.run(agent(handle).propose({}))
    assert 'secret-value' not in str(exc.value)


def test_model_identity_mismatch_is_not_hidden():
    from arc_science.transport import ProviderError
    def handle(request):return httpx.Response(200,json={'status':'completed','model':'different','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(proposal())}]}]})
    with pytest.raises(ProviderError):asyncio.run(agent(handle).propose({}))


def test_schema_rejects_process_narration():
    from arc_science.transport import ProviderError
    def handle(request):return httpx.Response(200,json={'status':'completed','model':'qualified-model','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({**proposal(),'thought_process':'Firstly I checked'})}]}]})
    with pytest.raises(ProviderError):asyncio.run(agent(handle).propose({}))


def test_provider_schema_binds_tool_identity_to_its_argument_shape():
    def handle(request):
        schema=json.loads(request.content)['text']['format']['schema']
        actions=schema['$defs']['Action']['anyOf']
        polynomial=next(option for option in actions if option['properties']['tool'].get('const')=='polynomial_fit')
        assert polynomial['properties']['arguments']['properties']['degree']['maximum']==3
        assert polynomial['properties']['arguments']['additionalProperties'] is False
        return httpx.Response(200,json={'status':'completed','model':'qualified-model','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(proposal())}]}]})
    asyncio.run(agent(handle).propose({}))
