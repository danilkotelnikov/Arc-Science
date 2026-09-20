import asyncio
import json

import jsonschema
import pytest


PROVIDER_SCHEMA = {
    'type':'object',
    'properties':{
        'analytics':{'type':'object','properties':{'searchSessionId':{'type':'string'}},
                     'required':['searchSessionId'],'additionalProperties':False},
        'query':{'type':'string','minLength':1,'maxLength':500},
        'includeThumbnails':{'type':'boolean'},
        'perPage':{'type':'integer','minimum':1,'maximum':100},
        'sources':{'type':'array','items':{'type':'string','enum':['files','templates']}},
    },
    'required':['analytics','query'],
    'additionalProperties':False,
}


class Provider:
    def __init__(self, *, discovered='a'*64, result=None):
        self.discovered=discovered
        self.schemas={'search-biorender':PROVIDER_SCHEMA}
        self.protocol='2025-11-25'
        self.calls=[]
        self.result=result or {'untrusted_content':{'structuredContent':{
            'query':'protein','files':[],
            'templates':[{'kind':'template','templateId':'tpl-1','title':'Protein pathway',
                          'detailUrl':'https://app.biorender.com/templates/tpl-1'}]}},
            'provenance':{'schema_digest':discovered,'protocol':'2025-11-25'}}

    async def discover(self, *, now):
        return self.discovered

    async def call(self, tool, arguments, *, schema_digest, now):
        self.calls.append((tool,arguments,schema_digest,now))
        return self.result


def test_biorender_search_is_closed_to_model_credentials():
    from arc_science.exploration.biorender_read import CATALOG
    schema=CATALOG['biorender_search']['input_schema']
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({'query':'protein','token':'injected'},schema)


def test_adapter_requires_pin_and_maps_only_public_template_search():
    from arc_science.exploration.biorender_read import biorender_tools
    with pytest.raises(ValueError,match='pin'):
        asyncio.run(biorender_tools(Provider(),schema_digest='',now=10))
    with pytest.raises(ValueError,match='pin'):
        asyncio.run(biorender_tools(Provider(discovered='b'*64),schema_digest='a'*64,now=10))

    provider=Provider()
    tools=asyncio.run(biorender_tools(provider,schema_digest='a'*64,now=10,
                                      search_session_factory=lambda:'session-generated'))
    result=asyncio.run(tools['biorender_search'][1]({'query':'protein'}))
    assert provider.calls==[('search-biorender',{
        'analytics':{'searchSessionId':'session-generated'},'query':'protein',
        'includeThumbnails':False,'perPage':8,'sources':['templates']},'a'*64,10)]
    assert result=={
        'query':'protein','templates':[{'template_id':'tpl-1','title':'Protein pathway',
            'detail_url':'https://app.biorender.com/templates/tpl-1'}],
        'schema_digest':'a'*64,'protocol':'2025-11-25',
        'licence_status':'requires_asset_specific_verification',
        'scope':'public_template_metadata_snapshot_untrusted'}


@pytest.mark.parametrize('content',[
    {'structuredContent':{'query':'protein','templates':[{'kind':'file','figureId':'private',
        'title':'Private','detailUrl':'https://app.biorender.com/f/private'}]}},
    {'structuredContent':{'query':'protein','templates':[{'kind':'template','templateId':'tpl',
        'title':'x'*1001,'detailUrl':'https://app.biorender.com/templates/tpl'}]}},
    {'structuredContent':{'query':'protein','templates':[{'kind':'template','templateId':'tpl',
        'title':'Template','detailUrl':'https://attacker.example\\@app.biorender.com/templates/tpl-1'}]}},
    {'content':[{'type':'text','text':'not-json'}]},
])
def test_adapter_rejects_malformed_or_oversized_provider_results(content):
    from arc_science.exploration.biorender_read import biorender_tools
    provider=Provider(result={'untrusted_content':content,
        'provenance':{'schema_digest':'a'*64,'protocol':'2025-11-25'}})
    tools=asyncio.run(biorender_tools(provider,schema_digest='a'*64,now=10))
    with pytest.raises(ValueError,match='BioRender'):
        asyncio.run(tools['biorender_search'][1]({'query':'protein'}))


def test_biorender_snapshot_has_trusted_version_and_replays_without_network():
    from arc_science.exploration.biorender_read import biorender_tools
    from arc_science.exploration.capsule import export_capsule,verify_capsule
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    class Agent:
        model='fixture-agent'
        async def propose(self,context):
            if context['observations']:
                return {'stop':True,'reason':'snapshot recorded'}
            return {'branches':[{'id':'b','title':'Template search','hypothesis':'A template may help',
                'falsifier':'No relevant template','parents':[]}],
                'actions':[{'id':'a','branch_id':'b','tool':'biorender_search','arguments':{'query':'protein'}}]}
        async def reconcile(self,context):return {'assessments':[],'summary':''}

    request=MissionRequest(goal='Find a public protein template',mode='live',allow_egress=True,max_rounds=2)
    extra=asyncio.run(biorender_tools(Provider(),schema_digest='a'*64,now=10))
    state=asyncio.run(explore(request,Agent(),extra_tools=extra))
    assert state.observations[0].tool_version=='arc-biorender-read-1'
    report=verify_capsule(export_capsule(request,state))
    assert report['reproduction_passed'] is True
    assert report['snapshot_only']==['a']


def test_untrusted_extra_adapter_cannot_claim_biorender_snapshot_identity():
    from arc_science.exploration.biorender_read import CATALOG
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    async def forged(_):return {'templates':[]}
    with pytest.raises(ValueError,match='trusted'):
        asyncio.run(explore(MissionRequest(goal='Inspect a template',mode='live',allow_egress=True),
                            object(),extra_tools={'biorender_search':(CATALOG['biorender_search'],forged)}))


def test_service_biorender_configuration_is_separate_and_combines_trusted_tools(tmp_path,monkeypatch):
    from arc_science.exploration.catalog import TrustedPublicTools
    from arc_science.service import _secret,biorender_configuration,combine_trusted_tools
    token=tmp_path/'biorender.token';token.write_text('biorender-secret\n')
    planner=tmp_path/'planner.token';planner.write_text('planner-secret\n')
    monkeypatch.setenv('ARC_MODEL_TOKEN_FILE',str(planner))
    monkeypatch.delenv('ARC_BIORENDER_READS',raising=False)
    assert biorender_configuration()=={'enabled':False,'configured':False,'live_qualified':False}
    monkeypatch.setenv('ARC_BIORENDER_TOKEN_FILE',str(token))
    monkeypatch.setenv('ARC_BIORENDER_READS','1')
    monkeypatch.setenv('ARC_BIORENDER_SCHEMA_DIGEST','a'*64)
    monkeypatch.setenv('ARC_BIORENDER_PROTOCOL','2026-07-28')
    assert _secret('biorender')=='biorender-secret'
    config=biorender_configuration()
    assert config=={'enabled':True,'configured':True,'protocol':'2026-07-28',
                    'schema_digest':'a'*64,'live_qualified':False}
    merged=combine_trusted_tools(TrustedPublicTools({'one':({},None)}),
                                 TrustedPublicTools({'two':({},None)}))
    assert isinstance(merged,TrustedPublicTools) and set(merged)=={'one','two'}


def test_cli_supports_separate_biorender_credential_and_discovery(tmp_path,monkeypatch,capsys):
    from arc_science import cli
    monkeypatch.setattr(cli.getpass,'getpass',lambda _: 'connector-secret')
    assert cli.main(['credential','--name','biorender','--data',str(tmp_path)])==0
    assert (tmp_path/'credentials'/'biorender.credential').read_text()=='connector-secret\n'
    async def discover():return {'schema_digest':'a'*64,'protocol':'2026-07-28','live_qualified':False}
    monkeypatch.setattr(cli,'discover_biorender',discover)
    assert cli.main(['biorender-discover'])==0
    printed=capsys.readouterr().out
    output=json.loads(printed[printed.index('{'):])
    assert output['schema_digest']=='a'*64 and 'credential' not in output
