"""MCP servers and ACP agents as mission connectors: consented, bounded, untrusted."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from arc_science.exploration import acp_client, mcp_tools
from arc_science.exploration.engine import explore
from arc_science.exploration.models import MissionRequest

FIXTURES = Path(__file__).parent / 'fixtures'
pytest.importorskip('mcp')


def mcp_server(name='fake', args=(), **over):
    return {'name': name, 'transport': 'stdio', 'command': sys.executable, 'args': [str(FIXTURES / 'fake_mcp_server.py'), *args],
            'url': '', 'consent': True, 'enabled': True, **over}


def acp_agent(name='fake', mode='success', **over):
    return {'name': name, 'command': sys.executable, 'args': [str(FIXTURES / 'fake_acp_agent.py'), mode], 'enabled': True,
            'consent': True, **over}


def run(coroutine):
    return asyncio.run(coroutine)


def test_schemas_are_tightened_into_the_catalogue_form_or_refused_with_a_reason():
    tightened = mcp_tools.tighten({'type': 'object', 'properties': {'text': {'type': 'string', 'default': 'x', 'title': 'T'},
                                                                   'n': {'type': 'integer', 'minimum': 1, 'format': 'int32'}},
                                   'required': ['text'], '$schema': 'http://json-schema.org/draft-07/schema#'})
    assert tightened == {'type': 'object', 'properties': {'text': {'type': 'string'}, 'n': {'type': 'integer', 'minimum': 1}},
                         'required': ['n', 'text'], 'additionalProperties': False}
    assert mcp_tools.tighten({'enum': ['a', 'b']}) == {'type': 'string', 'enum': ['a', 'b']}
    for bad, reason in (({'$ref': '#/x'}, '\\$ref'), ({'type': ['string', 'null']}, 'several types'), ({}, 'unconstrained'),
                        ({'type': 'object', 'properties': {'a': {'allOf': []}}}, 'allOf'), ({'type': 'array'}, 'item schema'),
                        ({'description': 'no type'}, 'no type')):
        with pytest.raises(ValueError, match=reason):
            mcp_tools.tighten(bad)


def test_a_consented_server_offers_its_representable_tools_and_calls_are_bounded_observations():
    async def scenario():
        async with mcp_tools.McpToolset([mcp_server(args=['--with-ref'])], connect_timeout=60) as toolset:
            report = toolset.report[0]
            assert report['ok'] and {t['name'] for t in report['tools']} == {'echo', 'where', 'fail', 'nested'}
            nested = next(t for t in report['tools'] if t['name'] == 'nested')
            assert nested['offered'] is False and '$ref' in nested['reason'] or '$defs' in nested['reason']
            assert set(toolset.tools) == {'mcp_fake_echo', 'mcp_fake_where', 'mcp_fake_fail'}
            spec, echo = toolset.tools['mcp_fake_echo']
            assert spec['input_schema']['required'] == ['text', 'times'] and spec['execution'] == 'external_connector'
            assert spec['description'].startswith('[MCP fake]') and 'untrusted' in spec['description']
            result = await echo({'text': 'hi', 'times': 2})
            assert result['content'] == [{'type': 'text', 'text': 'hi hi '}] and result['is_error'] is False
            assert result['scope'] == 'untrusted_connector_content_not_evidence'
            # The server runs in a private empty directory, not the service's.
            where = await toolset.tools['mcp_fake_where'][1]({})
            assert Path(where['content'][0]['text']).name.startswith('arc-mcp-')
            with pytest.raises(ValueError, match='reported an error'):
                await toolset.tools['mcp_fake_fail'][1]({'reason': 'no'})
            return toolset.workdir
    workdir = run(scenario())
    assert not workdir.exists()


def test_servers_without_consent_or_disabled_are_not_connected_and_failures_are_reported():
    async def scenario():
        servers = [mcp_server(name='off', consent=False), mcp_server(name='disabled', enabled=False),
                   {'name': 'missing', 'transport': 'stdio', 'command': 'no-such-mcp-command', 'args': [], 'url': '', 'consent': True, 'enabled': True}]
        async with mcp_tools.McpToolset(servers, connect_timeout=15) as toolset:
            assert toolset.tools == {} and toolset.report == [{'server': 'missing', 'ok': False, 'tools': [],
                                                               'error': 'ValueError: command no-such-mcp-command is not on PATH'}]
        listed = await mcp_tools.inspect_servers([mcp_server(consent=False)], connect_timeout=60)
        assert listed[0]['ok'] and any(t['offered'] for t in listed[0]['tools'])
    run(scenario())


def test_a_mission_may_use_an_mcp_tool_only_with_egress_consent_and_records_it_as_an_observation():
    class Agent:
        model = 'fixture-agent'

        async def propose(self, context):
            if context['observations']:
                return {'stop': True, 'reason': 'consulted'}
            assert 'mcp_fake_echo' in context['tools']
            return {'branches': [{'id': 'b', 'title': 'Echo', 'hypothesis': 'The connector answers', 'falsifier': 'It does not', 'parents': []}],
                    'actions': [{'id': 'a', 'branch_id': 'b', 'tool': 'mcp_fake_echo', 'arguments': {'text': 'ping', 'times': 1}}]}

        async def assess(self, role, context):
            return {'assessments': [], 'summary': ''}

    async def scenario(allow):
        async with mcp_tools.McpToolset([mcp_server()], connect_timeout=60) as toolset:
            request = MissionRequest(goal='Consult the connector', mode='live' if allow else 'demo', allow_egress=allow, max_rounds=2)
            return await explore(request, Agent(), extra_tools=toolset.tools)
    state = run(scenario(True))
    observation = state.observations[0]
    assert observation.status == 'ok' and observation.data['content'][0]['text'] == 'ping '
    assert observation.tool_version == 'arc-external-snapshot-1' and observation.replayable is False
    # Without egress consent the connector is never called: the action fails as an observation.
    denied = run(scenario(False)).observations[0]
    assert denied.status == 'error' and 'no scientific conclusion' in denied.data['error']


def test_an_acp_agent_answers_a_consultation_and_every_request_it_makes_is_refused():
    async def scenario():
        consultations = acp_client.AcpConsultations([acp_agent(mode='permission'), acp_agent(name='off', consent=False)])
        try:
            assert list(consultations.tools) == ['acp_fake_consult']
            spec, consult = consultations.tools['acp_fake_consult']
            assert spec['execution'] == 'external_connector' and spec['input_schema']['properties']['prompt']['maxLength'] == 4000
            answer = await consult({'prompt': 'What is 2+2?'})
            assert answer['text'] == 'Echo: What is 2+2? | refusals=[{"outcome": "selected", "optionId": "no"}, -32601]'
            assert answer['stop_reason'] == 'end_turn' and answer['refused_requests'] == ['Run rm -rf', 'fs/read_text_file']
            assert answer['scope'] == 'consultation_untrusted_text_not_evidence'
            again = await consult({'prompt': 'again'})
            assert again['text'].startswith('Echo: again') and len(consultations.running) == 1
            with pytest.raises(acp_client.AcpError, match='exceeds'):
                await consult({'prompt': 'x' * 4001})
        finally:
            await consultations.close()
        assert consultations.running == {}
        report = await acp_client.inspect_agents([acp_agent(), {'name': 'gone', 'command': 'no-such-acp-agent', 'args': [], 'enabled': True}])
        assert report[0] == {'agent': 'fake', 'ok': True, 'protocol_version': 1, 'agent_info': {'name': 'fake-acp', 'version': '0.1'},
                             'capabilities': {'loadSession': False}, 'auth_methods': []}
        assert report[1]['ok'] is False and 'not on PATH' in report[1]['error']
    run(scenario())


def test_a_hung_acp_agent_is_cut_at_the_deadline_and_stopped():
    async def scenario():
        client = acp_client.AcpAgent('fake', sys.executable, [str(FIXTURES / 'fake_acp_agent.py'), 'hang'], prompt_timeout=2)
        await client.start()
        with pytest.raises(acp_client.AcpError, match='timed out'):
            await client.prompt('slow')
        await client.close()
        assert client.process.returncode is not None and not client.workdir.exists()
    run(scenario())
