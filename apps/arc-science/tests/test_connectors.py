import asyncio
import base64
import hashlib
import json
from urllib.parse import urlsplit,parse_qs
import httpx
import pytest
from conftest import module
from test_core import NOW

ENDPOINT='https://mcp.services.biorender.com/mcp'


def modern_server(record, *, result_type='complete', supported_versions=None, call_result=None,
                  search_schema=None):
    search={'name':'search-biorender','inputSchema':{
        'type':'object','properties':{
            'analytics':{'type':'object','properties':{
                'searchSessionId':{'type':'string','x-mcp-header':'Search-Session'}},
                'required':['searchSessionId'],'additionalProperties':False},
            'query':{'type':'string','x-mcp-header':'Search-Query'},
            'includeThumbnails':{'type':'boolean'},'perPage':{'type':'integer'},
            'sources':{'type':'array','items':{'type':'string','enum':['files','templates']}}},
        'required':['analytics','query'],'additionalProperties':False}}
    if search_schema is not None:search['inputSchema']=search_schema
    def handle(request):
        body=json.loads(request.content);record.append((body,dict(request.headers)))
        assert request.headers['MCP-Protocol-Version']=='2026-07-28'
        assert request.headers['Mcp-Method']==body['method']
        assert 'mcp-session-id' not in request.headers
        meta=body['params']['_meta']
        assert meta['io.modelcontextprotocol/protocolVersion']=='2026-07-28'
        assert meta['io.modelcontextprotocol/clientCapabilities']=={}
        assert meta['io.modelcontextprotocol/clientInfo']['name']=='ArcScience'
        if body['method']=='server/discover':
            result={'resultType':'complete','supportedVersions':(
                    ['2026-07-28'] if supported_versions is None else supported_versions),
                    'capabilities':{'tools':{}},'ttlMs':60000,'cacheScope':'private'}
        elif body['method']=='tools/list':
            result={'resultType':'complete','tools':[search],'ttlMs':60000,'cacheScope':'private'}
        else:
            assert request.headers['Mcp-Name']=='search-biorender'
            assert request.headers['Mcp-Param-Search-Session']=='session-1'
            assert request.headers['Mcp-Param-Search-Query']=='protein'
            if call_result is not None:
                result=call_result
            elif result_type=='complete':
                result={'resultType':'complete','content':[{'type':'text','text':'ok'}],
                        'structuredContent':{'query':'protein','files':[],'templates':[]}}
            elif result_type=='legacy_complete':
                result={'content':[{'type':'text','text':'ok'}]}
            elif result_type=='input_required':
                result={'resultType':'input_required','requestState':'opaque'}
            else:
                result={'resultType':'task','taskId':'paid-side-effect'}
        return httpx.Response(200,json={'jsonrpc':'2.0','id':body['id'],'result':result})
    return handle

def test_oauth_pkce_is_resource_bound_and_one_use():
    o=module('oauth');flow=o.OAuthTransactions(allowed_issuers={'https://auth.example'})
    url,state=flow.begin(principal='u',project_id='p',resource=ENDPOINT,issuer='https://auth.example',
        authorization_endpoint='https://auth.example/authorize',token_endpoint='https://auth.example/token',
        client_id='arc-science',redirect_uri='https://arc.example/oauth/callback',scopes=('read',),now=NOW)
    query=parse_qs(urlsplit(url).query)
    assert query['resource']==[ENDPOINT] and query['code_challenge_method']==['S256']
    exchange=flow.consume(state,principal='u',project_id='p',issuer='https://auth.example',now=NOW+1)
    computed=base64.urlsafe_b64encode(hashlib.sha256(exchange['code_verifier'].encode()).digest()).rstrip(b'=').decode()
    assert query['code_challenge']==[computed]
    with pytest.raises(o.OAuthError):flow.consume(state,principal='u',project_id='p',issuer='https://auth.example',now=NOW+2)

@pytest.mark.parametrize('change',[{'principal':'other'},{'project_id':'other'},{'issuer':'https://evil.example'},{'now':NOW+1000}])
def test_oauth_rejects_mismatched_or_expired_callback(change):
    o=module('oauth');flow=o.OAuthTransactions(allowed_issuers={'https://auth.example'})
    _,state=flow.begin(principal='u',project_id='p',resource=ENDPOINT,issuer='https://auth.example',
        authorization_endpoint='https://auth.example/authorize',token_endpoint='https://auth.example/token',
        client_id='arc',redirect_uri='https://arc.example/cb',scopes=(),now=NOW)
    options=dict(principal='u',project_id='p',issuer='https://auth.example',now=NOW+1);options.update(change)
    with pytest.raises(o.OAuthError):flow.consume(state,**options)

def server(record,mode='json',bad=False):
    search={'name':'search-biorender','inputSchema':{'type':'object','properties':{'query':{'type':'string'}},
                                                     'required':['query'],'additionalProperties':False}}
    create={'name':'custom-figure-create-session','inputSchema':{'type':'object','properties':{'prompt':{'type':'string'}},
                                                     'required':['prompt'],'additionalProperties':False}}
    def handle(request):
        body=json.loads(request.content);record.append(body)
        if body['method']=='notifications/initialized':return httpx.Response(202)
        if body['method']=='initialize': result={'protocolVersion':'2025-11-25','capabilities':{'tools':{}},'serverInfo':{'name':'BioRender','version':'test'}}
        elif body['method']=='tools/list':result={'tools':[search,create]}
        else:
            assert request.headers['Mcp-Session-Id']=='session-a'
            result={'content':[{'type':'text','text':'{"title":"Binding pocket"}'}],'isError':bad}
        envelope={'jsonrpc':'2.0','id':body['id'],'result':result}
        if mode=='sse':return httpx.Response(200,text='event: message\ndata: '+json.dumps(envelope)+'\n\n',
                                            headers={'content-type':'text/event-stream','Mcp-Session-Id':'session-a'})
        return httpx.Response(200,json=envelope,headers={'Mcp-Session-Id':'session-a'})
    return handle

@pytest.mark.parametrize('mode',['json','sse'])
def test_biorender_mcp_initialization_discovery_search(mode):
    b=module('biorender');t=module('transport');records=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(server(records,mode))) as client:
            grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='biorender:u',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',
                                 credential_ref='biorender:u')
            digest=await br.discover(now=NOW)
            result=await br.call('search-biorender',{'query':'protein'},schema_digest=digest,now=NOW)
            assert result['provenance']['endpoint']==ENDPOINT
            assert result['untrusted_content']['content']
    asyncio.run(run())
    assert [x['method'] for x in records]==['initialize','notifications/initialized','tools/list','tools/call']
    assert 'secret' not in json.dumps(records)

@pytest.mark.parametrize('case',['unknown','schema_changed','bad_arguments','write_without_approval','wrong_approval','tool_error'])
def test_biorender_fails_closed(case):
    b=module('biorender');t=module('transport');records=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(server(records,bad=case=='tool_error'))) as client:
            grant=t.AccessGrant(token='s',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='r',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',credential_ref='r')
            d=await br.discover(now=NOW)
            tool='search-biorender';args={'query':'protein'};approval=None
            if case=='unknown':tool='export-all-private-files'
            if case=='schema_changed':d='0'*64
            if case=='bad_arguments':args={'query':'x','secret':True}
            if case in {'write_without_approval','wrong_approval'}:
                tool='custom-figure-create-session';args={'prompt':'test'}
            if case=='wrong_approval':
                approval=b.ActionApproval(principal='u',project_id='p',tool=tool,arguments_digest='0'*64,
                                          expires_at=NOW+5,approval_id='approval1')
            with pytest.raises(b.MCPError):await br.call(tool,args,schema_digest=d,now=NOW,approval=approval)
    asyncio.run(run())
    if case!='tool_error': assert not any(x['method']=='tools/call' for x in records)

def test_authorized_draft_is_exact_payload_bound_and_not_replayed():
    b=module('biorender');t=module('transport');c=module('contracts');records=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(server(records))) as client:
            grant=t.AccessGrant(token='s',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='r',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',credential_ref='r')
            d=await br.discover(now=NOW);args={'prompt':'A protein schematic'}
            approval=b.ActionApproval(principal='u',project_id='p',tool='custom-figure-create-session',
                                      arguments_digest=c.digest(args),expires_at=NOW+5,approval_id='approved1')
            await br.call('custom-figure-create-session',args,schema_digest=d,now=NOW,approval=approval)
            with pytest.raises(b.MCPError):
                await br.call('custom-figure-create-session',args,schema_digest=d,now=NOW,approval=approval)
    asyncio.run(run())


@pytest.mark.parametrize('result_type',['complete','legacy_complete'])
def test_explicit_modern_mcp_uses_stateless_metadata_and_mirror_headers(result_type):
    b=module('biorender');t=module('transport');records=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(modern_server(records,result_type=result_type))) as client:
            grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='biorender:u',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',
                                 credential_ref='biorender:u',protocol='2026-07-28')
            pinned=await br.discover(now=NOW)
            result=await br.call('search-biorender',{
                'analytics':{'searchSessionId':'session-1'},'query':'protein',
                'includeThumbnails':False,'perPage':8,'sources':['templates']},
                schema_digest=pinned,now=NOW)
            assert result['provenance']['protocol']=='2026-07-28'
    asyncio.run(run())
    assert [body['method'] for body,_ in records]==['server/discover','tools/list','tools/call']


@pytest.mark.parametrize('result_type',['input_required','task'])
def test_modern_mcp_rejects_unimplemented_result_extensions(result_type):
    b=module('biorender');t=module('transport');records=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(modern_server(records,result_type=result_type))) as client:
            grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='biorender:u',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',
                                 credential_ref='biorender:u',protocol='2026-07-28')
            pinned=await br.discover(now=NOW)
            with pytest.raises(b.MCPError,match='unsupported'):
                await br.call('search-biorender',{
                    'analytics':{'searchSessionId':'session-1'},'query':'protein',
                    'includeThumbnails':False,'perPage':8,'sources':['templates']},
                    schema_digest=pinned,now=NOW)
    asyncio.run(run())


def test_modern_mode_does_not_downgrade_after_protocol_error():
    b=module('biorender');t=module('transport');records=[]
    def handle(request):
        body=json.loads(request.content);records.append(body['method'])
        return httpx.Response(400,json={'jsonrpc':'2.0','id':body['id'],
            'error':{'code':-32022,'message':'Unsupported version'}})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='biorender:u',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',
                                 credential_ref='biorender:u',protocol='2026-07-28')
            with pytest.raises(b.MCPError):await br.discover(now=NOW)
    asyncio.run(run())
    assert records==['server/discover']


@pytest.mark.parametrize('branch',[
    {'additionalProperties':{'type':'string','x-mcp-header':'Hidden'}},
    {'patternProperties':{'^hidden$':{'type':'string','x-mcp-header':'Hidden'}}},
    {'dependentSchemas':{'query':{'properties':{
        'hidden':{'type':'string','x-mcp-header':'Hidden'}}}}},
    {'definitions':{'hidden':{'type':'string','x-mcp-header':'Hidden'}}},
])
def test_modern_discovery_excludes_annotations_outside_properties_paths(branch):
    b=module('biorender');t=module('transport');records=[]
    schema={'type':'object','properties':{'query':{'type':'string'}},
            'required':['query'],'additionalProperties':False,**branch}
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                modern_server(records,search_schema=schema))) as client:
            grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='biorender:u',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',
                                 credential_ref='biorender:u',protocol='2026-07-28')
            with pytest.raises(b.MCPError,match='usable'):
                await br.discover(now=NOW)
    asyncio.run(run())


def test_modern_discovery_rejects_non_string_supported_version():
    b=module('biorender');t=module('transport');records=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                modern_server(records,supported_versions=['2026-07-28',7]))) as client:
            grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='biorender:u',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',
                                 credential_ref='biorender:u',protocol='2026-07-28')
            with pytest.raises(b.MCPError,match='discovery'):
                await br.discover(now=NOW)
    asyncio.run(run())


@pytest.mark.parametrize('malformed',[
    {'resultType':'complete','content':[7],'isError':False,
     'structuredContent':{'query':'protein','files':[],'templates':[]}},
    {'resultType':'complete','content':[{'type':'text','text':'ok'}],'isError':0,
     'structuredContent':{'query':'protein','files':[],'templates':[]}},
])
def test_modern_call_rejects_malformed_content_and_non_boolean_error_flag(malformed):
    b=module('biorender');t=module('transport');records=[]
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                modern_server(records,call_result=malformed))) as client:
            grant=t.AccessGrant(token='secret',principal='u',project_id='p',resource=ENDPOINT,
                                credential_ref='biorender:u',expires_at=NOW+100)
            br=b.BioRenderClient(client=client,grant_resolver=lambda *_:grant,principal='u',project_id='p',
                                 credential_ref='biorender:u',protocol='2026-07-28')
            pinned=await br.discover(now=NOW)
            with pytest.raises(b.MCPError,match='result'):
                await br.call('search-biorender',{
                    'analytics':{'searchSessionId':'session-1'},'query':'protein',
                    'includeThumbnails':False,'perPage':8,'sources':['templates']},
                    schema_digest=pinned,now=NOW)
    asyncio.run(run())
