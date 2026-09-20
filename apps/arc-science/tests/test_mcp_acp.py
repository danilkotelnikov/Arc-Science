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
                        ({'description': 'no type'}, 'no type'),
                        # Assertions the catalogue cannot express withhold the tool; only annotations are dropped.
                        ({'type': 'array', 'items': {'type': 'string'}, 'uniqueItems': True}, 'uniqueItems'),
                        ({'type': 'number', 'multipleOf': 2}, 'multipleOf'), ({'type': 'integer', 'exclusiveMinimum': 0}, 'exclusiveMinimum'),
                        ({'type': 'object', 'properties': {}, 'minProperties': 1}, 'minProperties')):
        with pytest.raises(ValueError, match=reason):
            mcp_tools.tighten(bad)

    class Tool:
        name = 'either'
        description = 'union at the top'
        inputSchema = {'anyOf': [{'type': 'object', 'properties': {'a': {'type': 'string'}}}, {'type': 'string'}]}
    with pytest.raises(ValueError, match='not an object'):
        mcp_tools.catalog_entry('srv', Tool())


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


def test_connector_results_are_bounded_in_every_part():
    from types import SimpleNamespace as NS
    big = NS(content=[NS(type='text', text='x' * (65 * 1024))], structuredContent={'k': 'v' * (70 * 1024)}, isError=False)
    observation = mcp_tools.bounded_result('s', 't', big)
    assert len(observation['content'][0]['text']) == 64 * 1024 and observation['structured'] is None
    assert observation['notes'] == ['structured_dropped_over_limit', 'text_truncated']
    with pytest.raises(ValueError, match='block limit'):
        mcp_tools.bounded_result('s', 't', NS(content=[NS(type='text', text='a')] * 65, structuredContent=None, isError=False))
    with pytest.raises(ValueError, match='image exceeds'):
        mcp_tools.bounded_result('s', 't', NS(content=[NS(type='image', data='A' * (4 * 1024 * 1024 + 1), mimeType='image/png')], structuredContent=None, isError=False))
    with pytest.raises(ValueError, match='uri exceeds'):
        mcp_tools.bounded_result('s', 't', NS(content=[NS(type='resource', resource=NS(uri='u' * 2049, text=''))], structuredContent=None, isError=False))
    with pytest.raises(ValueError, match='size limit'):
        mcp_tools.bounded_result('s', 't', NS(content=[NS(type='text', text='x' * 60000)] * 5, structuredContent=None, isError=False))


def test_connector_content_is_read_but_never_supports_a_hypothesis():
    from arc_science.exploration import claim_scope

    class Agent:
        model = 'fixture-agent'

        async def propose(self, context):
            if context['observations']:
                return {'stop': True, 'reason': 'consulted'}
            return {'branches': [{'id': 'b', 'title': 'Echo', 'hypothesis': 'The connector answers', 'falsifier': 'It does not', 'parents': []}],
                    'actions': [{'id': 'a', 'branch_id': 'b', 'tool': 'mcp_fake_echo', 'arguments': {'text': 'ping', 'times': 1}}]}

        async def assess(self, role, context):
            # Both roles try to lean on the connector's answer as support.
            return {'assessments': [{'branch_id': 'b', 'position': 'support', 'finding': 'the server said so', 'evidence_ids': ['a'],
                                     'next_test': 'independent data'}], 'summary': 'leaning on the connector'}

    async def scenario():
        async with mcp_tools.McpToolset([mcp_server()], connect_timeout=60) as toolset:
            request = MissionRequest(goal='Consult the connector', mode='live', allow_egress=True, max_rounds=2)
            return await explore(request, Agent(), extra_tools=toolset.tools)
    state = run(scenario())
    assert state.observations[0].status == 'ok' and state.observations[0].claim_eligible is False
    # The reviews were rejected as unbound support, so nothing stands for the branch...
    assert state.assessments == () and any(e.kind == 'review_rejected' for e in state.events)
    # ...and the claim scope counts no successful test for it either.
    branch = claim_scope.derive_claim_scope(state).branches[0]
    assert branch.status == 'unassessed' and [u.reason for u in branch.uncertainties][:1] == ['untested']


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
            # Concurrent consultations share one agent and never mix their text.
            replies = await asyncio.gather(*(consult({'prompt': 'n' + str(i)}) for i in range(4)))
            assert sorted(r['text'].split(' | ')[0] for r in replies) == ['Echo: n0', 'Echo: n1', 'Echo: n2', 'Echo: n3']
            assert len(consultations.running) == 1
            with pytest.raises(acp_client.AcpError, match='exceeds'):
                await consult({'prompt': 'x' * 4001})
        finally:
            await consultations.close()
        assert consultations.running == {}
        report = await acp_client.inspect_agents([acp_agent(), {'name': 'gone', 'command': 'no-such-acp-agent', 'args': [], 'enabled': True}])
        assert report[0] == {'agent': 'fake', 'ok': True, 'protocol_version': 1, 'agent_info': {'name': 'fake-acp', 'version': '0.1'},
                             'capabilities': {'loadSession': False}, 'auth_methods': [], 'environment': 'allowlisted',
                             'contained': sys.platform == 'win32'}
        assert report[1]['ok'] is False and 'not on PATH' in report[1]['error']
    run(scenario())


def test_acp_names_that_collide_once_normalised_are_refused_and_a_failed_start_is_closed(monkeypatch):
    monkeypatch.setenv('ARC_TEST_SECRET', 'must-not-leak')
    with pytest.raises(ValueError, match='collide'):
        acp_client.AcpConsultations([acp_agent(name='agent.one'), acp_agent(name='agent_one')])

    async def scenario():
        consultations = acp_client.AcpConsultations([{'name': 'gone', 'command': 'no-such-acp-agent', 'args': [], 'enabled': True, 'consent': True},
                                                     acp_agent()])
        try:
            with pytest.raises(acp_client.AcpError, match='not on PATH'):
                await consultations.tools['acp_gone_consult'][1]({'prompt': 'x'})
            assert consultations.running == {}
            answer = await consultations.tools['acp_fake_consult'][1]({'prompt': 'env?'})
            # The allowlisted environment: no Arc token file, no provider key reaches the agent.
            assert 'LEAKED' not in answer['text']
        finally:
            await consultations.close()
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
