import json
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
        assert c.post(f'/api/missions/{mid}/verify',headers=auth()).json()['reproduction_passed']
        exported=c.get(f'/api/missions/{mid}/capsule',headers=auth())
        assert exported.status_code==200 and exported.content[:2]==b'PK'
        from arc_science.exploration.capsule import verify_capsule
        assert verify_capsule(exported.content)['reproduced']==3


def test_cancellation_is_persisted_and_cannot_restart(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Explore fixture'}).json()['id']
        assert c.post(f'/api/missions/{mid}/cancel',headers=auth()).json()['state']['status']=='cancelled'
        assert c.post(f'/api/missions/{mid}/start',headers=auth()).status_code==409


def test_finished_missions_keep_their_outcome_when_cancel_is_pressed(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Explore fixture','max_rounds':1}).json()['id']
        assert c.post(f'/api/missions/{mid}/start',headers=auth()).status_code==202
        for _ in range(200):
            row=c.get(f'/api/missions/{mid}',headers=auth()).json()
            if row['state']['status'] in ('completed','budget_exhausted','error','needs_input'):break
            time.sleep(0.05)
        final=row['state']['status'];reason=row['state']['stop_reason']
        assert final in ('completed','budget_exhausted')
        denied=c.post(f'/api/missions/{mid}/cancel',headers=auth())
        assert denied.status_code==409 and 'finished' in denied.json()['detail'].lower()
        after=c.get(f'/api/missions/{mid}',headers=auth()).json()['state']
        assert (after['status'],after['stop_reason'])==(final,reason)


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


def test_missing_records_and_diagnostics_uses_workbench_shell(tmp_path):
    with TestClient(app(tmp_path)) as c:
        assert c.get('/api/missions/unknown',headers=auth()).status_code==404
        page=c.get('/diagnostics')
        assert page.status_code==200
        assert 'Arc Science' in page.text
        assert 'id="root"' in page.text
        assert '0.6.0 development' not in page.text
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


def _finished(c,mid):
    for _ in range(200):
        row=c.get(f'/api/missions/{mid}',headers=auth()).json()
        if row['state']['status'] not in ('ready','running'):return row
        time.sleep(.01)
    raise AssertionError('mission did not finish')


def test_release_ledger_gates_the_capsule_and_survives_restart(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Release ledger'}).json()['id']
        c.post(f'/api/missions/{mid}/start',headers=auth())
        row=_finished(c,mid)
        # Before verification the decision is blocked by unknown replay checks and the export is refused.
        release=row['release']
        states={check['name']:check['state'] for check in release['checks']}
        assert release['status']=='blocked' and states['replay_integrity']=='unknown' and states['operational_status']=='satisfied'
        assert states['reconciliation']=='satisfied' and states['visual_review']=='not_applicable'
        blocked=c.get(f'/api/missions/{mid}/capsule',headers=auth())
        assert blocked.status_code==409 and 'replay_integrity:unknown' in blocked.json()['detail']
        # Verification persists a receipt and the decision; the export is then allowed.
        verified=c.post(f'/api/missions/{mid}/verify',headers=auth()).json()
        assert verified['release']['status']=='eligible_for_human_review'
        assert verified['release']['verification']['reproduction_passed'] is True
        assert c.get(f'/api/missions/{mid}/release',headers=auth()).json()['eligible_for_human_review'] is True
        capsule=c.get(f'/api/missions/{mid}/capsule',headers=auth())
        assert capsule.status_code==200
        # The exported state is the verified state: the ledger is evidence about it, not part of it.
        import io,zipfile
        with zipfile.ZipFile(io.BytesIO(capsule.content)) as z:
            assert json.loads(z.read('state.json'))['release'] is None
        assert all(check['state']!='unknown' for check in verified['release']['checks'])
        assert 'validated' not in json.dumps(verified['release']).lower()
    # A restart keeps the ledger: the decision is derived from the persisted receipt.
    with TestClient(app(tmp_path)) as c:
        release=c.get(f'/api/missions/{mid}/release',headers=auth()).json()
        assert release['status']=='eligible_for_human_review'
        assert release['verification']['verifier_version']=='arc-mission-verifier-1'


def test_a_mission_that_changes_after_verification_is_stale_until_verified_again(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Stale ledger','max_rounds':1}).json()['id']
        c.post(f'/api/missions/{mid}/start',headers=auth())
        row=_finished(c,mid)
        assert row['state']['status']=='budget_exhausted'
        assert c.post(f'/api/missions/{mid}/verify',headers=auth()).json()['release']['status']=='eligible_for_human_review'
        # Interrupt-and-resume changes the subject: the persisted receipt no longer applies.
        from arc_science.exploration.models import MissionState
        repo=c.app.state.repository
        current=repo.get(mid)
        paused=MissionState.model_validate({**current['state'],'status':'paused'})
        repo.save(mid,paused,expected_revision=current['revision'])
        release=c.get(f'/api/missions/{mid}/release',headers=auth()).json()
        states={check['name']:check['state'] for check in release['checks']}
        assert states['replay_integrity']=='stale' and states['operational_status']=='unknown'
        assert c.get(f'/api/missions/{mid}/capsule',headers=auth()).status_code==409


def test_verification_derives_the_claim_scope_for_a_mission_that_stopped_before_scopes_existed(tmp_path):
    from arc_science.exploration.models import MissionState
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Older mission'}).json()['id']
        c.post(f'/api/missions/{mid}/start',headers=auth());row=_finished(c,mid)
        repo=c.app.state.repository;row=repo.get(mid)
        repo.save(mid,MissionState.model_validate({**row['state'],'claim_scope':None}),expected_revision=row['revision'])
        states={ch['name']:ch['state'] for ch in c.get(f'/api/missions/{mid}/release',headers=auth()).json()['checks']}
        assert states['claim_scope']=='unknown'
        verified=c.post(f'/api/missions/{mid}/verify',headers=auth()).json()
        assert verified['release']['status']=='eligible_for_human_review'
        assert c.get(f'/api/missions/{mid}',headers=auth()).json()['state']['claim_scope']['derivation_version']=='arc-claim-scope-3'
        # A scope derived under an earlier rule is stale until verification derives it again.
        row=repo.get(mid)
        older={**row['state']['claim_scope'],'derivation_version':'arc-claim-scope-2'}
        repo.save(mid,MissionState.model_validate({**row['state'],'claim_scope':older}),expected_revision=row['revision'])
        states={ch['name']:ch['state'] for ch in c.get(f'/api/missions/{mid}/release',headers=auth()).json()['checks']}
        assert states['claim_scope']=='stale'
        verified=c.post(f'/api/missions/{mid}/verify',headers=auth()).json()
        assert verified['release']['status']=='eligible_for_human_review'
        after=c.get(f'/api/missions/{mid}',headers=auth()).json()['state']['claim_scope']
        assert after['derivation_version']=='arc-claim-scope-3' and after['counts']==older['counts']


def test_verification_refuses_to_run_beside_an_active_worker(tmp_path):
    from arc_science.exploration.models import MissionState
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Busy mission'}).json()['id']
        repo=c.app.state.repository;row=repo.get(mid)
        repo.save(mid,MissionState.model_validate({**row['state'],'status':'running'}),expected_revision=row['revision'])
        refused=c.post(f'/api/missions/{mid}/verify',headers=auth())
        assert refused.status_code==409 and 'still running' in refused.json()['detail']
        assert c.get(f'/api/missions/{mid}/release',headers=auth()).json()['status']=='blocked'


def test_health_reports_the_host_session_from_the_environment(tmp_path, monkeypatch):
    # The desktop marks its own child with ARC_HOST_SESSION=owned; anything else is standalone
    # (a reused service cannot be handed a variable, so 'reused' is never reported here).
    from arc_science import __version__
    monkeypatch.delenv('ARC_HOST_SESSION', raising=False)
    with TestClient(app(tmp_path)) as c:
        health=c.get('/health')
        assert health.headers['X-Arc-Science-Service']=='arc-science-v1'
        body=health.json()
        assert (body['status'],body['version'],body['deployment'])==('ready',__version__,'single-trust-domain')
        assert body['host_session']=={'mode':'standalone','source':'ARC_HOST_SESSION'}
        monkeypatch.setenv('ARC_HOST_SESSION','owned')
        assert c.get('/health').json()['host_session']['mode']=='owned'
        monkeypatch.setenv('ARC_HOST_SESSION','reused')
        assert c.get('/health').json()['host_session']['mode']=='standalone'


def test_capsule_route_exports_format_3_with_the_decision_timeline_and_grants(tmp_path):
    import io,zipfile
    from arc_science.exploration.capsule import verify_capsule
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'Slice 5 export'}).json()['id']
        c.post(f'/api/missions/{mid}/start',headers=auth());_finished(c,mid)
        assert c.post(f'/api/missions/{mid}/verify',headers=auth()).json()['reproduction_passed']
        exported=c.get(f'/api/missions/{mid}/capsule',headers=auth())
        assert exported.status_code==200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as z:
            assert sorted(z.namelist())==['claims.json','evidence_graph.json','grants.json','manifest.json','release.json',
                                          'request.json','runtime.json','state.json','timeline.json']
            assert json.loads(z.read('runtime.json'))['format']=='arc-research-capsule/3'
            release=json.loads(z.read('release.json'))
            assert release['status']=='eligible_for_human_review' and release['verification']['reproduction_passed'] is True
            rows=json.loads(z.read('timeline.json'))
            assert rows and all('started_at' in row for row in rows)
            assert set(json.loads(z.read('grants.json')))=={'grants','receipts','receipts_truncated'}
            assert json.loads(z.read('state.json'))['release'] is None
        report=verify_capsule(exported.content)
        assert report['format']=='arc-research-capsule/3' and report['reproduced']==3
        assert report['integrity'] is True and report['manifest_failures']==[]
        assert report['informational']==['claims.json','grants.json','timeline.json']


def test_png_download_is_gated_by_the_ledger_while_the_inline_preview_is_not(tmp_path):
    import os
    from arc_science.svg_raster import cairo_available
    if not os.environ.get('ARC_SVG2PNG') and not cairo_available():
        pytest.skip('No SVG rasterizer: set ARC_SVG2PNG or install cairosvg so the demo mission has artifacts')
    with TestClient(app(tmp_path)) as c:
        mid=c.post('/api/missions',headers=auth(),json={'goal':'PNG gating'}).json()['id']
        c.post(f'/api/missions/{mid}/start',headers=auth());row=_finished(c,mid)
        assert row['state']['status']=='completed' and row['state']['artifacts']
        digest=row['state']['artifacts'][0]['digest']
        inline=c.get(f'/api/missions/{mid}/artifacts/{digest}',headers=auth())
        assert inline.status_code==200 and inline.headers['Content-Disposition']=='inline'
        refused=c.get(f'/api/missions/{mid}/artifacts/{digest}/download',headers=auth())
        assert refused.status_code==409
        assert 'Release blocked' in refused.json()['detail'] and 'replay_integrity:unknown' in refused.json()['detail']
        assert c.get(f'/api/missions/{mid}/artifacts/{"0"*64}/download',headers=auth()).status_code==404
        assert c.post(f'/api/missions/{mid}/verify',headers=auth()).json()['release']['eligible_for_human_review'] is True
        allowed=c.get(f'/api/missions/{mid}/artifacts/{digest}/download',headers=auth())
        assert allowed.status_code==200
        assert allowed.headers['Content-Disposition']==f'attachment; filename="arc-{mid}-{digest[:12]}.png"'
        assert allowed.content==inline.content and allowed.headers['ETag']==inline.headers['ETag']=='"'+digest+'"'
        assert allowed.headers['Content-Type']==inline.headers['Content-Type']
