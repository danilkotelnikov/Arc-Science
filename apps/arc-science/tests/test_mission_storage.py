import asyncio
import json
from io import BytesIO
from zipfile import ZipFile
import pytest


def results():
    from arc_science.exploration.models import MissionRequest
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    request=MissionRequest(goal='Explore the response')
    return request,asyncio.run(explore(request,DemoAgent()))


def test_state_and_events_commit_atomically_and_reject_stale_writers(tmp_path):
    from arc_science.exploration.repository import MissionRepository, RevisionConflict
    from arc_science.exploration.engine import initialize
    request,result=results(); repo=MissionRepository(tmp_path/'missions.db')
    row=repo.create(request,initialize(request),key='one')
    fresh=repo.save(row['id'],result,expected_revision=row['revision'])
    assert fresh['revision']==1
    assert repo.verify(row['id'])
    with pytest.raises(RevisionConflict): repo.save(row['id'],result,expected_revision=0)


def test_idempotent_creation_and_conflicting_key(tmp_path):
    from arc_science.exploration.repository import MissionRepository, RevisionConflict
    from arc_science.exploration.engine import initialize
    from arc_science.exploration.models import MissionRequest
    repo=MissionRepository(tmp_path/'state.db');request,_=results()
    assert repo.create(request,initialize(request),key='same')['id']==repo.create(request,initialize(request),key='same')['id']
    other=MissionRequest(goal='Different question')
    with pytest.raises(RevisionConflict): repo.create(other,initialize(other),key='same')


def test_cancellation_fences_late_results(tmp_path):
    from arc_science.exploration.repository import MissionRepository, RevisionConflict
    from arc_science.exploration.engine import initialize
    request,result=results();repo=MissionRepository(tmp_path/'state.db')
    row=repo.create(request,initialize(request),key='run')
    repo.cancel(row['id'])
    with pytest.raises(RevisionConflict):repo.save(row['id'],result,expected_revision=0)
    assert repo.get(row['id'])['state']['status']=='cancelled'


def test_startup_pauses_incomplete_missions(tmp_path):
    from arc_science.exploration.repository import MissionRepository
    from arc_science.exploration.engine import initialize
    request,_=results();path=tmp_path/'state.db';repo=MissionRepository(path)
    row=repo.create(request,initialize(request).model_copy(update={'status':'running'}),key='run')
    assert MissionRepository(path).pause_interrupted()==[row['id']]
    assert repo.get(row['id'])['state']['status']=='paused'


def test_replay_reexecutes_computation_instead_of_trusting_receipts():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    request,state=results();blob=export_capsule(request,state)
    report=verify_capsule(blob)
    assert report['integrity'] and report['reproduced']==3
    assert report['scientific_digest']==state.scientific_digest
    assert report['live_models_reexecuted'] is False
    assert export_capsule(request,state)==blob


def test_capsule_detects_byte_tampering():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    request,state=results();blob=export_capsule(request,state)
    out=BytesIO()
    with ZipFile(BytesIO(blob)) as source,ZipFile(out,'w') as dest:
        for item in source.infolist():
            data=source.read(item.filename)
            if item.filename=='state.json':data=data.replace(b'quadratic',b'quxdratic',1)
            dest.writestr(item.filename,data)
    with pytest.raises(ValueError):verify_capsule(out.getvalue())


def test_rehashed_fabricated_numerical_receipt_still_fails_recomputation():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    request,state=results()
    raw=state.model_dump();raw['observations'][0]['data']['validation_mse']=12345.0
    from arc_science.exploration.models import MissionState
    forged=MissionState.model_validate(raw)
    report=verify_capsule(export_capsule(request,forged))
    assert report['integrity']
    assert report['reproduction_passed'] is False


def test_capsule_rejects_unmanifested_or_unsafe_members():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    request,state=results();out=BytesIO(export_capsule(request,state))
    with ZipFile(out,'a') as z:z.writestr('../escaped','bad')
    with pytest.raises(ValueError):verify_capsule(out.getvalue())


def test_rehashed_capsule_cannot_substitute_the_requested_dataset():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.models import MissionState
    from arc_science.contracts import digest
    request,state=results();raw=state.model_dump(mode='json')
    raw['points'][0]['y']+=1
    raw['dataset_digest']=digest(raw['points'])
    altered=MissionState.model_validate(raw)
    with pytest.raises(ValueError):verify_capsule(export_capsule(request,altered))


def test_replay_rejects_observation_action_identity_mismatch():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    from arc_science.exploration.models import MissionState
    request,state=results();raw=state.model_dump()
    raw['observations'][0]['branch_id']='some-other-branch'
    report=verify_capsule(export_capsule(request,MissionState.model_validate(raw)))
    assert report['reproduction_passed'] is False
def test_repository_operations_close_database_handles_on_success_and_error(tmp_path, monkeypatch):
    import sqlite3
    from arc_science.exploration import repository

    opened = []
    connect = sqlite3.connect

    def track_connection(*args, **kwargs):
        connection = connect(*args, **kwargs)
        opened.append(connection)
        return connection

    monkeypatch.setattr(repository.sqlite3, 'connect', track_connection)
    repo = repository.MissionRepository(tmp_path / 'handles.db')
    assert repo.list() == []
    with pytest.raises(KeyError):
        repo.get('missing')
    for connection in opened:
        with pytest.raises(sqlite3.ProgrammingError, match='closed'):
            connection.execute('SELECT 1')


@pytest.mark.parametrize('status,cancellable',[('ready',True),('running',True),('paused',True),
    ('completed',False),('budget_exhausted',False),('error',False),('needs_input',False)])
def test_cancellation_matrix_protects_every_finished_outcome(tmp_path,status,cancellable):
    from arc_science.exploration.repository import MissionRepository, MissionFinished
    from arc_science.exploration.engine import initialize
    from arc_science.exploration.models import MissionState
    request,_=results();repo=MissionRepository(tmp_path/'state.db')
    row=repo.create(request,initialize(request),key='matrix')
    state=MissionState.model_validate({**row['state'],'status':status,'stop_reason':'recorded outcome'})
    repo.save(row['id'],state,expected_revision=row['revision'])
    if cancellable:
        assert repo.cancel(row['id'])['state']['status']=='cancelled'
    else:
        with pytest.raises(MissionFinished):repo.cancel(row['id'])
        assert (repo.get(row['id'])['state']['status'],repo.get(row['id'])['state']['stop_reason'])==(status,'recorded outcome')
