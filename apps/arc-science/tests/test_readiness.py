"""Readiness: the server decides every seat's state from the settings, the credential
store, the CLI login cache and the probe records; the reading is passive."""
import json
from pathlib import Path

from fastapi.testclient import TestClient

from arc_science import readiness, settings
from arc_science.exploration import effort
from test_settings import AUTH, app, launcher, stub  # noqa: F401  (stub is a fixture)

NATIVE = 'native-session-secret-A-0123456789abcdef0123456789abcdef'
CATALOG = effort.load_catalog()


def seats(**overrides):
    base = {r: {'provider': '', 'model': '', 'effort': 'medium', 'auth': 'api_key', 'credential': ''} for r in ('planner', 'reviewer', 'falsifier', 'vision', 'prose')}
    for role, values in overrides.items():
        base[role].update(values)
    return {'settings': {'seats': base, 'providers': {}, 'mcp_servers': [], 'acp_agents': []}, 'revision': 'a' * 64, 'path': 'settings.toml'}


def build(snapshot, *, stored=lambda ref: True, cli=lambda provider: None, probes=lambda provider: None):
    return readiness.build_readiness('token', settings_snapshot=snapshot, credential_stored=stored, cli_transport_reader=cli, probes_reader=probes,
                                     catalog=CATALOG, memory_health={'configured': False, 'capture': {'status': 'unconfigured'}},
                                     renderer={'configured': False, 'exists': None, 'default_preset': None}, storage={'missions_db': True, 'missions': 0})


def test_seat_states_follow_the_contract_matrix():
    empty = build(seats())
    assert (empty['seats']['planner']['state'], empty['seats']['planner']['code']) == ('blocked', 'seat.unconfigured')
    assert empty['seats']['reviewer']['code'] == 'seat.unconfigured' and empty['seats']['falsifier']['code'] == 'seat.unconfigured'
    assert empty['seats']['vision']['meaning'] == 'Visual review is unavailable until a vision seat is set'
    assert empty['seats']['prose']['meaning'] == 'Prose edits through a model are unavailable; the local rewrite still works'
    assert empty['live_mission'] == {**empty['live_mission'], 'state': 'blocked', 'code': 'live.blocked', 'blocking': ['planner']}
    assert empty['settings']['code'] == 'settings.available' and empty['session']['label'] == 'Operator token'
    for node in empty['seats'].values():
        assert node['state'] in readiness.STATES and node['meaning'] and node['next_action'] and node['source'] == 'settings revision aaaaaaaaaaaa'
    # Inheritance follows endpoints_from_settings: reviewer <- planner, falsifier <- reviewer, else planner.
    planner = build(seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol'}))
    assert planner['seats']['planner']['code'] == 'seat.not_tested' and planner['seats']['planner']['facts']['credential_ref'] == 'planner'
    assert planner['seats']['reviewer'] == {**planner['seats']['reviewer'], 'state': 'not_tested', 'code': 'seat.inherits'}
    assert planner['seats']['reviewer']['facts']['inherits_from'] == 'planner' and planner['seats']['falsifier']['facts']['inherits_from'] == 'planner'
    assert planner['live_mission']['code'] == 'live.not_tested'
    with_reviewer = build(seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol'}, reviewer={'provider': 'anthropic', 'model': 'claude-opus-5', 'credential': 'ant-key'}))
    assert with_reviewer['seats']['falsifier']['facts']['inherits_from'] == 'reviewer' and with_reviewer['seats']['reviewer']['facts']['credential_ref'] == 'ant-key'
    # Model missing, credential missing, CLI missing, CLI not signed in.
    assert build(seats(planner={'provider': 'openai'}))['seats']['planner']['code'] == 'seat.model_missing'
    missing = build(seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol'}), stored=lambda ref: False)['seats']['planner']
    assert (missing['state'], missing['code'], missing['facts']['credential_stored']) == ('blocked', 'seat.credential_missing', False)
    assert 'arc-science credential --name planner' in missing['next_action']
    cli_seat = seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol', 'auth': 'cli'})
    assert build(cli_seat)['seats']['planner']['code'] == 'seat.cli_missing'
    out = build(cli_seat, cli=lambda p: {'executable': 'codex.cmd', 'executable_sha256': 'e' * 64, 'logged_in': False, 'auth_method': 'none'})['seats']['planner']
    assert (out['state'], out['code'], out['facts']['cli_logged_in'], out['facts']['executable']) == ('blocked', 'seat.cli_not_signed_in', False, 'codex.cmd')
    assert build(cli_seat)['live_mission']['blocking'] == ['planner']


def test_vision_seat_is_blocked_where_configured_vision_endpoint_refuses_it():
    from arc_science import service
    # A CLI login: even a passed probe of the same (model, effort, executable) never makes it ready.
    snap = seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol'}, vision={'provider': 'openai', 'model': 'gpt-5.6-sol', 'auth': 'cli'})
    cli = lambda p: {'executable': 'codex.cmd', 'executable_sha256': 'e' * 64, 'logged_in': True, 'auth_method': 'chatgpt'}  # noqa: E731
    current = readiness.subject_digest(readiness.subject('openai', 'cli', 'gpt-5.6-sol', 'medium', executable_sha256='e' * 64))
    probes = lambda p: {'at': 1, 'results': [{'model': 'gpt-5.6-sol', 'ok': True, 'subject_digest': current}]}  # noqa: E731
    vision = build(snap, cli=cli, probes=probes)['seats']['vision']
    assert vision['verification']['status'] == 'not_applicable' and vision['facts']['transport'] == 'cli'
    assert (vision['state'], vision['code']) == ('blocked', 'seat.transport_not_accepted')
    assert vision['next_action'] == 'Give the vision seat an API credential from OpenAI, Anthropic or Gemini'
    try:
        service.configured_vision_endpoint(snap['settings'])
    except ValueError as why:
        assert vision['meaning'] == str(why)
    else:
        raise AssertionError('configured_vision_endpoint accepted a CLI vision seat')
    # OpenClaw over an API credential is refused the same way.
    snap = seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol'}, vision={'provider': 'openclaw', 'model': 'agent', 'credential': 'claw'})
    snap['settings']['providers'] = {'openclaw': {'endpoint': 'http://127.0.0.1:18789/v1', 'agent_id': 'a'}}
    vision = build(snap)['seats']['vision']
    assert (vision['state'], vision['code']) == ('blocked', 'seat.transport_not_accepted')
    try:
        service.configured_vision_endpoint(snap['settings'])
    except ValueError as why:
        assert vision['meaning'] == str(why)
    else:
        raise AssertionError('configured_vision_endpoint accepted an OpenClaw vision seat')
    # An API vision seat keeps the ordinary path.
    assert build(seats(vision={'provider': 'openai', 'model': 'gpt-5.6-sol'}))['seats']['vision']['code'] == 'seat.not_tested'


def test_effort_is_checked_against_the_transport_and_the_catalogue_entry():
    gemini = build(seats(planner={'provider': 'gemini', 'model': 'gemini-2.5-pro', 'effort': 'max'}))['seats']['planner']
    assert (gemini['state'], gemini['code'], gemini['facts']['effort_accepted']) == ('blocked', 'seat.effort_not_accepted', False)
    assert 'low, medium, high' in gemini['next_action']
    haiku = build(seats(planner={'provider': 'anthropic', 'model': 'claude-haiku-4-5-20251001', 'effort': 'high'}))['seats']['planner']
    assert haiku['code'] == 'seat.effort_not_accepted' and haiku['facts']['in_catalog'] is True and 'medium' in haiku['next_action']
    assert build(seats(planner={'provider': 'anthropic', 'model': 'claude-haiku-4-5-20251001', 'effort': 'medium'}))['seats']['planner']['code'] == 'seat.not_tested'
    custom = build(seats(planner={'provider': 'openai', 'model': 'gpt-99', 'effort': 'xhigh'}))['seats']['planner']
    assert (custom['state'], custom['code'], custom['facts']['in_catalog']) == ('not_tested', 'seat.custom_model', False)
    assert custom['facts']['catalog_version'] == CATALOG['catalog_version']


def test_supported_efforts_equal_the_catalogue_table():
    assert {p + ':' + t: list(levels) for (p, t), levels in effort.SUPPORTED.items()} == CATALOG['efforts_by_transport']
    assert effort.accepted_efforts('openai', 'api', 'gpt-6-astra') == ('low', 'medium', 'high', 'xhigh', 'max')
    assert effort.accepted_efforts('anthropic', 'cli', 'claude-haiku-4-5-20251001') == ()
    assert effort.accepted_efforts('gemini', 'cli', 'gemini-2.5-pro') == ()
    assert effort.accepted_efforts('openai', 'cli', 'unlisted') == effort.EFFORTS
    assert effort.model_entry('openai', 'gpt-5.6-sol')['label'] == 'GPT-5.6 Sol' and effort.model_entry('openai', 'nope') is None


def test_probe_records_are_matched_to_the_seat_by_subject_digest():
    cli = lambda p: {'executable': 'codex.cmd', 'executable_sha256': 'e' * 64, 'logged_in': True, 'auth_method': 'chatgpt'}
    doc = seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol', 'effort': 'high', 'auth': 'cli'})
    current = readiness.subject_digest(readiness.subject('openai', 'cli', 'gpt-5.6-sol', 'high', executable_sha256='e' * 64))
    # A CLI subject is role-independent: the credential ref is None whatever the role passed.
    assert readiness.subject('openai', 'cli', 'm', 'high', executable_sha256='x', credential_ref='planner')['credential_ref'] is None
    assert readiness.subject('openai', 'api', 'm', 'high', endpoint='https://api.openai.com', credential_ref='k') == {
        'provider': 'openai', 'transport': 'api', 'model': 'm', 'effort': 'high', 'endpoint': 'https://api.openai.com', 'credential_ref': 'k'}
    none = build(doc, cli=cli)['seats']['planner']
    assert (none['state'], none['code'], none['verification']['status'], none['verification']['subject_digest']) == ('not_tested', 'seat.not_tested', 'not_tested', current)
    ok = {'at': 1700000000, 'transport': 'codex', 'provider': 'openai', 'results': [{'model': 'gpt-5.6-sol', 'effort': 'high', 'ok': True, 'observed_model': None,
                                                                                       'identity_verified': False, 'subject_digest': current}]}
    verified = build(doc, cli=cli, probes=lambda p: ok)
    assert (verified['seats']['planner']['state'], verified['seats']['planner']['code']) == ('ready', 'seat.verified')
    assert verified['seats']['planner']['verification'] == {'status': 'ok', 'checked_at': 1700000000, 'subject_digest': current, 'observed_model': None,
                                                             'identity_verified': False, 'error': None}
    assert verified['live_mission'] == {'state': 'ready', 'code': 'live.verified', 'blocking': [], 'meaning': verified['live_mission']['meaning'], 'next_action': None}
    stale = build(doc, cli=lambda p: {**cli(p), 'executable_sha256': 'f' * 64}, probes=lambda p: ok)['seats']['planner']
    assert (stale['state'], stale['code'], stale['verification']['status']) == ('not_tested', 'seat.probe_stale', 'stale')
    other = build(seats(planner={'provider': 'openai', 'model': 'gpt-5.6-terra', 'effort': 'high', 'auth': 'cli'}), cli=cli, probes=lambda p: ok)['seats']['planner']
    assert other['code'] == 'seat.not_tested'
    failed = build(doc, cli=cli, probes=lambda p: {**ok, 'results': [{**ok['results'][0], 'ok': False, 'error': 'quota'}]})
    assert (failed['seats']['planner']['state'], failed['seats']['planner']['code']) == ('failed', 'seat.probe_failed')
    assert failed['seats']['planner']['verification']['error'] == 'quota' and failed['live_mission']['code'] == 'live.failed'
    assert failed['live_mission']['blocking'] == ['planner']


def test_settings_unavailable_leaves_every_seat_unknown_and_the_other_nodes_still_read():
    out = readiness.build_readiness('native', settings_snapshot=None, credential_stored=lambda r: True, cli_transport_reader=lambda p: None,
                                    probes_reader=lambda p: None, catalog=CATALOG, memory_health={'configured': True, 'capture': {'status': 'ready'}, 'health': {'protocol': 1, 'sqlite': '3.45'}},
                                    renderer={'configured': True, 'exists': True, 'default_preset': 'publication_white'}, storage={'missions_db': False, 'missions': None})
    assert out['session'] == {**out['session'], 'kind': 'native', 'code': 'session.native', 'label': 'Desktop session'}
    assert out['settings']['code'] == 'settings.unavailable' and all(s['state'] == 'unknown' for s in out['seats'].values())
    assert out['live_mission']['state'] == 'unknown' and out['seats']['planner']['source'] == 'settings unavailable'
    assert out['memory'] == {**out['memory'], 'state': 'ready', 'code': 'memory.available', 'facts': {'protocol': 1, 'sqlite': '3.45', 'capture': {'status': 'ready'}}}
    assert out['renderer'] == {**out['renderer'], 'state': 'not_tested', 'code': 'renderer.configured'}
    assert out['storage'] == {**out['storage'], 'state': 'blocked', 'code': 'storage.missing', 'next_action': readiness.STORAGE_NEXT}
    read_only = readiness.build_readiness('token', settings_snapshot={**seats(), 'read_only': True}, credential_stored=lambda r: True, cli_transport_reader=lambda p: None,
                                          probes_reader=lambda p: None, catalog=CATALOG, memory_health={'configured': True, 'capture': {}},
                                          renderer={'configured': True, 'exists': False, 'default_preset': None}, storage={'missions_db': True, 'missions': 2})
    assert (read_only['settings']['state'], read_only['settings']['code'], read_only['settings']['source']) == ('blocked', 'settings.read_only', 'file')
    assert (read_only['memory']['state'], read_only['memory']['code']) == ('unknown', 'memory.not_checked')
    assert read_only['renderer']['code'] == 'renderer.not_configured' and 'does not exist' in read_only['renderer']['meaning']


def test_connectors_report_consent_and_enablement():
    snap = seats()
    snap['settings']['mcp_servers'] = [{'name': 'a', 'transport': 'stdio', 'enabled': True, 'consent': True}, {'name': 'b', 'transport': 'http', 'enabled': True, 'consent': False},
                                       {'name': 'c', 'transport': 'stdio', 'enabled': False, 'consent': True}]
    snap['settings']['acp_agents'] = [{'name': 'd', 'enabled': True, 'consent': True}]
    out = build(snap)['connectors']
    assert [(m['name'], m['state'], m['code']) for m in out['mcp']] == [('a', 'not_tested', 'connector.eligible'), ('b', 'blocked', 'connector.not_consented'), ('c', 'blocked', 'connector.disabled')]
    assert out['mcp'][0]['transport'] == 'stdio' and 'transport' not in out['acp'][0] and out['acp'][0]['code'] == 'connector.eligible'
    assert out['acp_protocol'] == 1 and all(m['meaning'] and m['next_action'] for m in out['mcp'] + out['acp'])


def test_the_route_is_authorized_names_the_session_kind_and_reads_probe_records(tmp_path, stub, monkeypatch):
    for key in ('ARC_PROVIDER', 'ARC_MODEL', 'ARC_REVIEWER_MODEL', 'ARC_CLAUDE_CODE_EXE', 'ARC_MODEL_TOKEN_FILE', 'ARC_MOLECULAR_BLENDER_PYTHON', 'ARC_MEMORY_WORKER'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('ARC_NATIVE_SESSION_SECRET', NATIVE)
    with TestClient(app(tmp_path)) as c:
        assert c.get('/api/readiness').status_code == 401
        out = c.get('/api/readiness', headers=AUTH).json()
        assert out['session']['kind'] == 'token' and out['settings']['code'] == 'settings.available' and len(out['settings']['revision']) == 64
        native = c.get('/api/readiness', headers={'X-Arc-Native-Session': NATIVE}).json()['session']
        assert (native['kind'], native['code'], native['label'], native['state']) == ('native', 'session.native', 'Desktop session', 'ready')
        assert out['seats']['planner']['code'] == 'seat.unconfigured' and out['live_mission']['state'] == 'blocked'
        assert out['catalog'] == CATALOG and out['public_reads'] == {'enabled': False}
        assert out['storage'] == {**out['storage'], 'code': 'storage.present', 'facts': {'missions_db': True, 'missions': 0}}
        assert out['memory']['code'] == 'memory.unavailable' and out['renderer']['code'] == 'renderer.not_configured'
        assert out['connectors']['acp_protocol'] == 1 and [r['role'] for r in out['roles']] == ['planner', 'reviewer', 'falsifier', 'vision', 'prose']
        assert 'paste a token' not in json.dumps(out).lower()
        # A CLI planner: the login cache says signed in; a custom model stays custom until probed.
        fixtures = Path(__file__).parent / 'fixtures'
        codex = launcher(tmp_path, 'codex', fixtures / 'fake_codex.py', 'success')
        doc = settings.snapshot()['settings']
        doc['seats']['planner'].update(provider='openai', model='gpt-5.6-sol', effort='high', auth='cli')
        doc['seats']['vision'].update(provider='openai', model='gpt-5.6-sol', credential='vision-key')
        doc['providers']['openai']['cli'] = str(codex)
        settings.replace(doc, None)
        out = c.get('/api/readiness', headers=AUTH).json()
        planner = out['seats']['planner']
        assert (planner['state'], planner['code'], planner['facts']['cli_logged_in'], planner['facts']['executable']) == ('not_tested', 'seat.not_tested', True, codex.name)
        assert planner['facts']['transport'] == 'cli' and planner['facts']['credential_ref'] is None and planner['verification']['status'] == 'not_tested'
        assert out['seats']['vision']['code'] == 'seat.credential_missing' and out['seats']['vision']['facts']['credential_ref'] == 'vision-key'
        assert out['seats']['reviewer']['code'] == 'seat.inherits' and out['live_mission']['code'] == 'live.not_tested'
        probe = c.post('/api/providers/openai/probe', headers=AUTH, json={'spend_tokens': True}).json()
        assert probe['results'][0]['subject'] == {'provider': 'openai', 'transport': 'cli', 'model': 'gpt-5.6-sol', 'effort': 'high',
                                                  'executable_sha256': probe['results'][0]['subject']['executable_sha256'], 'credential_ref': None}
        assert len(probe['results'][0]['subject']['executable_sha256']) == 64 and len(probe['results'][0]['subject_digest']) == 64
        out = c.get('/api/readiness', headers=AUTH).json()
        assert (out['seats']['planner']['state'], out['seats']['planner']['code']) == ('ready', 'seat.verified')
        assert out['seats']['planner']['verification']['subject_digest'] == probe['results'][0]['subject_digest']
        assert out['live_mission']['code'] == 'live.verified'
        # A changed effort is an older subject; the record on disk is read when the memory is cold.
        doc = settings.snapshot()['settings']
        doc['seats']['planner']['effort'] = 'low'
        settings.replace(doc, None)
        assert c.get('/api/readiness', headers=AUTH).json()['seats']['planner']['code'] == 'seat.probe_stale'
    with TestClient(app(tmp_path)) as c:
        doc = settings.snapshot()['settings']
        doc['seats']['planner']['effort'] = 'high'
        settings.replace(doc, None)
        assert c.get('/api/readiness', headers=AUTH).json()['seats']['planner']['code'] == 'seat.verified'
        # A signed-out CLI blocks the seat (a fresh app, so the transport cache is cold).
        doc['providers']['openai']['cli'] = str(launcher(tmp_path, 'codex-out', fixtures / 'fake_codex.py', 'logged-out'))
        settings.replace(doc, None)
    with TestClient(app(tmp_path)) as c:
        planner = c.get('/api/readiness', headers=AUTH).json()['seats']['planner']
        assert (planner['state'], planner['code'], planner['facts']['cli_logged_in']) == ('blocked', 'seat.cli_not_signed_in', False)
