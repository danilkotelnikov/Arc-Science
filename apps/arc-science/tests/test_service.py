import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

TOKEN='t'*40

def app(tmp_path):
    from arc_science.service import create_app
    return create_app(data_dir=tmp_path, token=TOKEN)

def auth():return {'Authorization':'Bearer '+TOKEN}

def test_health_public_but_mission_data_requires_token(tmp_path):
    with TestClient(app(tmp_path)) as c:
        health=c.get('/health')
        assert health.status_code==200
        assert health.headers['X-Arc-Science-Service']=='arc-science-v1'
        assert health.json()['status']=='ready'
        assert c.get('/api/missions').status_code==401
        assert c.get('/api/missions',headers=auth()).json()==[]


def test_public_http_lifecycle_exports_and_reproduces(tmp_path):
    with TestClient(app(tmp_path)) as c:
        created=c.post('/api/missions',headers={**auth(),'Idempotency-Key':'http-test'},json={'goal':'Explain the nonlinear response'})
        assert created.status_code==201, created.text
        mid=created.json()['id']
        assert c.post(f'/api/missions/{mid}/start',headers=auth()).status_code==202
        for _ in range(150):
            row=c.get(f'/api/missions/{mid}',headers=auth()).json()
            if row['state']['status'] not in ('ready','running'):break
            time.sleep(.01)
        assert row['state']['status']=='completed'
        assert len(row['state']['branches'])>=3
        assert row['state']['publication_eligible'] is False
        assert c.get(f'/api/missions/{mid}/verify',headers=auth()).json()['reproduction_passed']
        exported=c.get(f'/api/missions/{mid}/capsule',headers=auth())
        assert exported.status_code==200 and exported.content[:2]==b'PK'
        from arc_science.exploration.capsule import verify_capsule
        assert verify_capsule(exported.content)['reproduced']==3


def test_cancellation_is_persisted_and_cannot_restart(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Explore fixture'}).json()['id']
        assert c.post(f'/api/missions/{mid}/cancel',headers=auth()).json()['state']['status']=='cancelled'
        assert c.post(f'/api/missions/{mid}/start',headers=auth()).status_code==409


def test_input_validation_and_missing_live_credentials(tmp_path,monkeypatch):
    monkeypatch.delenv('ARC_MODEL',raising=False)
    with TestClient(app(tmp_path)) as c:
        assert c.post('/api/missions',headers=auth(),json={'goal':'A', 'max_rounds':999}).status_code==422
        result=c.post('/api/missions',headers=auth(),json={'goal':'Study a protein','mode':'live','allow_egress':True})
        assert result.status_code==409


def test_idempotency_key_returns_same_mission(tmp_path):
    with TestClient(app(tmp_path)) as c:
        h={**auth(),'Idempotency-Key':'repeat'}
        first=c.post('/api/missions',headers=h,json={'goal':'Explore fixture'}).json()
        second=c.post('/api/missions',headers=h,json={'goal':'Explore fixture'}).json()
        assert first['id']==second['id']
        assert c.post('/api/missions',headers=h,json={'goal':'Different fixture'}).status_code==409


def test_missing_records_and_diagnostic_console(tmp_path):
    with TestClient(app(tmp_path)) as c:
        assert c.get('/api/missions/unknown',headers=auth()).status_code==404
        page=c.get('/diagnostics')
        assert page.status_code==200
        assert 'Arc Science' in page.text
        assert TOKEN not in page.text


def test_small_tokens_are_rejected(tmp_path):
    from arc_science.service import create_app
    with pytest.raises(ValueError):create_app(data_dir=tmp_path,token='weak')


def test_database_can_be_reopened_after_http_completion(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Explore fixture'}).json()['id']
    with TestClient(app(tmp_path)) as c:
        assert c.get(f'/api/missions/{mid}',headers=auth()).status_code==200


def test_blank_compose_reviewer_values_inherit_planner(monkeypatch):
    from arc_science.service import configured_endpoints
    monkeypatch.setenv('ARC_PROVIDER','anthropic')
    monkeypatch.setenv('ARC_MODEL','exact-model-id')
    monkeypatch.setenv('ARC_PROVIDER_URL','')
    monkeypatch.setenv('ARC_REVIEWER_PROVIDER','')
    monkeypatch.setenv('ARC_REVIEWER_URL','')
    monkeypatch.setenv('ARC_REVIEWER_MODEL','')
    first,second=configured_endpoints()
    assert second.model==first.model=='exact-model-id'
    assert second.provider=='anthropic'
    assert first.endpoint==second.endpoint=='https://api.anthropic.com/v1/messages'
