"""Per-mission crew (contracts C2, C3; research B3): a mission may name its own model and
effort per role. Each entry is checked at creation against the Settings seat's provider and
transport with the catalogue's accepted efforts; the overrides are applied before the route
is bound, so the approved route digest covers the crew and a later Settings change is still
refused; the route preview accepts the crew and says which roles it overrides."""
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from arc_science import service
from arc_science.contracts import canonical, digest
from arc_science.error_codes import ERROR_CODES
from arc_science.exploration.models import MissionRequest
from arc_science.exploration.providers import ModelEndpoint
from test_claude_code_service import configured  # noqa: F401  (a fixture)

TOKEN = 'c' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}

CLI = ModelEndpoint(provider='anthropic', transport='cli', endpoint='claude', model='claude-opus-5', credential_ref='planner', effort='high')
API = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='gpt-5.6', credential_ref='reviewer')
GEMINI = ModelEndpoint(provider='gemini', endpoint='https://generativelanguage.googleapis.com/v1beta', model='gemini-3-pro',
                       credential_ref='falsifier')
VISION = ModelEndpoint(provider='anthropic', endpoint='https://api.anthropic.com/v1/messages', model='claude-opus-5', credential_ref='vision')


def app(tmp_path):
    return service.create_app(data_dir=tmp_path / 'data', token=TOKEN)


@pytest.fixture
def seats(monkeypatch):
    """A fixed live route the service reads as its Settings: a Claude Code planner, an OpenAI
    API reviewer and a Gemini API falsifier; vision only when asked for."""
    current = {'planner': CLI, 'reviewer': API, 'falsifier': GEMINI}
    monkeypatch.setattr(service, 'live_seats_ready', lambda: (current['planner'], current['reviewer']))
    monkeypatch.setattr(service, 'live_route', lambda vision_review=False: {
        'seats': {**current, **({'vision': VISION} if vision_review else {})}, 'mcp_servers': [], 'acp_agents': []})
    return current


def refused(response, status, code, facts):
    assert response.status_code == status, response.text
    assert response.json()['detail'] == {'code': code, 'detail': ERROR_CODES[code], 'facts': facts}


# --- the contract field ---

def test_crew_is_a_bounded_later_field_that_keeps_old_digests():
    assert 'crew' in MissionRequest.LATER_FIELDS
    plain = MissionRequest(goal='Old request')
    assert 'crew' not in plain.model_dump(mode='json')
    assert digest(plain) == digest(MissionRequest(goal='Old request', crew=None))
    crewed = MissionRequest(goal='Old request', crew={'planner': {'model': 'claude-sonnet-5', 'effort': 'low'}})
    assert digest(crewed) != digest(plain)
    assert MissionRequest.model_validate_json(canonical(crewed)) == crewed
    for bad in ({'navigator': {'model': 'm'}}, {'planner': {'model': '--dangerously-skip-permissions'}},
                {'planner': {'model': 'm', 'effort': 'ultra'}}, {'planner': {'model': 'm', 'extra': 1}}):
        with pytest.raises(ValidationError):
            MissionRequest(goal='Bad crew', crew=bad)


# --- creation ---

def test_an_unknown_role_is_refused_with_its_code(tmp_path, seats):
    with TestClient(app(tmp_path)) as c:
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Crew', 'crew': {'navigator': {'model': 'gpt-5.6'}}}),
                422, 'crew.unknown_role', {'role': 'navigator'})
        assert c.get('/api/missions', headers=AUTH).json() == []


def test_an_effort_the_seat_cannot_express_is_refused_with_the_allowed_levels(tmp_path, seats):
    with TestClient(app(tmp_path)) as c:
        # Gemini's API expresses minimal..high; the catalogue does not narrow a custom model.
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Crew', 'crew': {'falsifier': {'model': 'gemini-3-pro', 'effort': 'max'}}}),
                422, 'crew.effort_not_supported', {'role': 'falsifier', 'effort': 'max', 'allowed': ['minimal', 'low', 'medium', 'high']})
        # The catalogue narrows a listed model: Claude Haiku 4.5 takes no effort, so only the default is accepted.
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Crew', 'crew': {'planner': {'model': 'claude-haiku-4-5-20251001', 'effort': 'high'}}}),
                422, 'crew.effort_not_supported', {'role': 'planner', 'effort': 'high', 'allowed': ['medium']})
        # A level outside the vocabulary is the same refusal, not a schema error.
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Crew', 'crew': {'reviewer': {'model': 'gpt-5.6', 'effort': 'ultra'}}}),
                422, 'crew.effort_not_supported', {'role': 'reviewer', 'effort': 'ultra', 'allowed': list(service.accepted_efforts('openai', 'api', 'gpt-5.6'))})
        assert c.get('/api/missions', headers=AUTH).json() == []


def test_a_role_without_a_seat_is_refused(tmp_path, seats, monkeypatch):
    with TestClient(app(tmp_path)) as c:
        # No vision seat unless the mission asks for vision review.
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Crew', 'crew': {'vision': {'model': 'claude-sonnet-5'}}}),
                422, 'crew.no_seat', {'role': 'vision'})
        # No Settings seats at all.
        monkeypatch.setattr(service, 'live_route', lambda vision_review=False: (_ for _ in ()).throw(ValueError('no seats')))
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Crew', 'crew': {'planner': {'model': 'claude-sonnet-5'}}}),
                422, 'crew.no_seat', {'role': 'planner'})


def test_a_valid_crew_is_recorded_in_the_request_and_its_digest(tmp_path, seats):
    crew = {'planner': {'model': 'claude-sonnet-5', 'effort': 'low'}, 'falsifier': {'model': 'gemini-3-flash', 'effort': None}}
    with TestClient(app(tmp_path)) as c:
        made = c.post('/api/missions', headers=AUTH, json={'goal': 'Crewed demo', 'crew': crew})
        assert made.status_code == 201, made.text
        row = made.json()
        assert row['request']['crew'] == crew
        assert row['request_digest'] == digest(MissionRequest.model_validate(row['request']))
        # A demo mission runs the fixture agents: the crew is validated and recorded, not applied.
        assert row['crew_applies'] is False
        plain = c.post('/api/missions', headers=AUTH, json={'goal': 'Crewed demo'}).json()
        assert 'crew' not in plain['request'] and 'crew_applies' not in plain


# --- the route ---

def test_the_crew_overrides_model_and_effort_only_and_the_route_digest_covers_it(seats):
    route = service.live_route()
    crewed = service.with_crew(route, MissionRequest(goal='Route', crew={'planner': {'model': 'claude-sonnet-5', 'effort': 'max'},
                                                                         'reviewer': {'model': 'gpt-5.6-mini'}}).crew)
    planner, reviewer = crewed['seats']['planner'], crewed['seats']['reviewer']
    assert (planner.provider, planner.transport, planner.endpoint, planner.credential_ref) == ('anthropic', 'cli', 'claude', 'planner')
    assert (planner.model, planner.effort) == ('claude-sonnet-5', 'max')
    # effort None: no level is sent and the transport's own default applies.
    assert (reviewer.model, reviewer.effort, reviewer.credential_ref) == ('gpt-5.6-mini', None, 'reviewer')
    assert crewed['seats']['falsifier'] == GEMINI and route['seats']['planner'] == CLI
    assert service.seat_plan(crewed)[0] != service.seat_plan(route)[0]
    assert service.with_crew(route, None) is route


def test_a_model_without_effort_control_sends_no_level(seats):
    """Claude Haiku 4.5 takes no effort: the default is accepted but stored as None, so neither
    the CLI nor the API sends a level the model does not support."""
    for effort in ('medium', None):
        crewed = service.with_crew(service.live_route(), MissionRequest(
            goal='Route', crew={'planner': {'model': 'claude-haiku-4-5-20251001', 'effort': effort}}).crew)
        assert crewed['seats']['planner'].effort is None


def test_the_preview_accepts_the_crew_and_marks_overridden_roles_untested(tmp_path, seats):
    with TestClient(app(tmp_path)) as c:
        plain = c.get('/api/missions/preview', headers=AUTH).json()
        body = {'crew': {'planner': {'model': 'claude-sonnet-5', 'effort': 'low'}}}
        preview = c.post('/api/missions/preview', headers=AUTH, json=body).json()
        assert preview['route_digest'] != plain['route_digest']
        assert c.post('/api/missions/preview', headers=AUTH, json={}).json()['route_digest'] == plain['route_digest']
        by_role = {s['role']: s for s in preview['seats']}
        assert (by_role['planner']['model'], by_role['planner']['effort'], by_role['planner']['source']) == ('claude-sonnet-5', 'low', 'mission')
        assert by_role['planner']['tested'] is False
        assert by_role['reviewer']['source'] == 'settings' and 'tested' not in by_role['reviewer']
        refused(c.post('/api/missions/preview', headers=AUTH, json={'crew': {'falsifier': {'model': 'gemini-3-pro', 'effort': 'xhigh'}}}),
                422, 'crew.effort_not_supported', {'role': 'falsifier', 'effort': 'xhigh', 'allowed': ['minimal', 'low', 'medium', 'high']})
        vision = c.post('/api/missions/preview', headers=AUTH, json={'vision_review': True, 'crew': {'vision': {'model': 'claude-sonnet-5'}}}).json()
        assert {s['role']: s['model'] for s in vision['seats']}['vision'] == 'claude-sonnet-5'


def settled(c, mid):
    for _ in range(3000):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(.01)
    raise AssertionError('mission did not settle')


def test_a_live_start_binds_the_crewed_route_and_a_settings_change_before_it_is_refused(tmp_path, seats, monkeypatch):
    monkeypatch.setattr(service, '_secret', lambda ref: 'secret')
    crew = {'planner': {'model': 'claude-sonnet-5', 'effort': 'low'}}
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Crewed live', 'mode': 'live', 'allow_egress': True, 'crew': crew}).json()['id']
        settings_preview = c.get('/api/missions/preview', headers=AUTH).json()
        # The route without the crew is not the route this mission binds.
        wrong = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': settings_preview['route_digest'],
                                                                         'grants': settings_preview['required_grants']})
        assert wrong.status_code == 409 and wrong.json()['detail']['code'] == 'mission.route_changed'
        preview = c.post('/api/missions/preview', headers=AUTH, json={'crew': crew}).json()
        # A Settings change between preview and start: the crewed digest no longer matches.
        seats['reviewer'] = API.model_copy(update={'model': 'gpt-5.6-mini'})
        changed = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': preview['route_digest'],
                                                                           'grants': preview['required_grants']})
        assert changed.status_code == 409 and changed.json()['detail']['code'] == 'mission.route_changed'
        assert changed.json()['detail']['facts']['route_digest'] != preview['route_digest']
        seats['reviewer'] = API
        started = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': preview['route_digest'],
                                                                           'grants': preview['required_grants']})
        assert started.status_code == 202, started.text
        # The fixture seats cannot run; the binding is what this test is about.
        state = settled(c, mid)['state']
        bound = [e for e in state['events'] if e['kind'] == 'seats_bound'][0]['detail']
        assert bound.startswith('sha256:' + preview['route_digest'] + ' ') and 'anthropic:cli:claude-sonnet-5:low:planner' in bound


def test_a_settings_change_after_binding_is_refused_on_resume(tmp_path, seats, monkeypatch):
    from arc_science.exploration.models import MissionState
    monkeypatch.setattr(service, '_secret', lambda ref: 'secret')
    crew = {'planner': {'model': 'claude-sonnet-5', 'effort': 'low'}}
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Crewed resume', 'mode': 'live', 'allow_egress': True, 'crew': crew}).json()['id']
        preview = c.post('/api/missions/preview', headers=AUTH, json={'crew': crew}).json()
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': preview['route_digest'],
                                                                        'grants': preview['required_grants']}).status_code == 202
        row = settled(c, mid)
        c.app.state.repository.save(mid, MissionState.model_validate({**row['state'], 'status': 'paused'}), expected_revision=row['revision'])
        # The same crew, but the operator points the planner seat at another executable in Settings.
        seats['planner'] = CLI.model_copy(update={'endpoint': 'claude-other'})
        moved = c.post(f'/api/missions/{mid}/start', headers=AUTH)
        assert moved.status_code == 409 and moved.json()['detail']['code'] == 'mission.seats_changed'
        seats['planner'] = CLI
        # Restored, the crewed route matches the binding again and the resume is scheduled.
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        settled(c, mid)


def test_a_live_mission_runs_its_crew(configured, tmp_path):
    """The Claude Code fixture seats: Settings name claude-opus-5 for the planner; the crew
    moves the planner to claude-fable-5-1 and the model records say so."""
    crew = {'planner': {'model': 'claude-fable-5-1', 'effort': 'low'}}
    with TestClient(app(tmp_path)) as c:
        made = c.post('/api/missions', headers=AUTH, json={'goal': 'Crewed CLI run', 'mode': 'live', 'allow_egress': True,
                                                           'max_rounds': 1, 'crew': crew})
        assert made.status_code == 201, made.text
        assert made.json()['crew_applies'] is True
        mid = made.json()['id']
        preview = c.post('/api/missions/preview', headers=AUTH, json={'crew': crew}).json()
        started = c.post(f'/api/missions/{mid}/start', headers=AUTH,
                         json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']})
        assert started.status_code == 202, started.text
        state = settled(c, mid)['state']
        assert state['stop_code'] == 'round_limit', state['stop_reason']
        models = {r['role']: r['model'] for r in state['model_records']}
        assert models == {'planner': 'claude-fable-5-1', 'analyst': 'claude-sonnet-5', 'falsifier': 'claude-sonnet-5'}
        planner = next(r for r in state['model_records'] if r['role'] == 'planner')
        assert planner['transport']['requested_model'] == 'claude-fable-5-1' and planner['transport'].get('requested_effort') == 'low'
