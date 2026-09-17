import hashlib
import sqlite3
from concurrent.futures import ThreadPoolExecutor
import pytest
from conftest import module

NOW = 1809550000

def context():
    c = module('contracts')
    image = c.ArtifactRef(name='panel.png', digest='a'*64, size=64, media_type='image/png', role='render')
    candidate = c.Candidate(project_id='project-a', producer_id='builder', policy_digest='b'*64,
                            artifacts=(image,), evidence_digests=('c'*64,))
    seats = tuple(c.Seat(seat_id=f'r{i}', provider=p, model=f'm{i}', group=p,
                        credential_ref=f'vault:{p}', qualification_digest='d'*64,
                        qualification_expires_at=NOW+100, vision=True)
                  for i,p in enumerate(('openai','anthropic')))
    checks = tuple(c.Check(criterion=x, status='pass', evidence_digests=(candidate.digest,))
                   for x in ('numerical','geometry','provenance'))
    reviews = tuple(c.Review(candidate_digest=candidate.digest, policy_digest=candidate.policy_digest,
                        seat_id=s.seat_id, observed_model=s.model,
                        reviewed_digests=(image.digest,), findings=(),
                        checks=tuple(c.Check(criterion=x,status='pass',evidence_digests=(image.digest,))
                                     for x in ('visual_clarity','caption_alignment')))
                    for s in seats)
    return c,candidate,seats,checks,reviews

def test_valid_candidate_is_only_eligible_for_human_review():
    _,candidate,seats,checks,reviews=context()
    result=module('governor').assess(candidate,seats,reviews,checks,now=NOW)
    assert result.eligible and result.status=='eligible_for_human_review'

@pytest.mark.parametrize('defect', ['missing','stale','policy','model','expired','same_group',
    'self_review','empty_evidence','wrong_evidence','missing_view','unknown','blocking',
    'duplicate_reviewer','missing_mechanical','unknown_mechanical','duplicate_check'])
def test_governor_fails_closed(defect):
    c,candidate,seats,checks,reviews=context()
    reviews=list(reviews);seats=list(seats);checks=list(checks)
    if defect=='missing': reviews=reviews[:1]
    if defect=='stale': reviews[0]=reviews[0].model_copy(update={'candidate_digest':'f'*64})
    if defect=='policy': reviews[0]=reviews[0].model_copy(update={'policy_digest':'f'*64})
    if defect=='model': reviews[0]=reviews[0].model_copy(update={'observed_model':'other'})
    if defect=='expired': seats[0]=seats[0].model_copy(update={'qualification_expires_at':NOW-1})
    if defect=='same_group': seats[1]=seats[1].model_copy(update={'group':seats[0].group})
    if defect=='self_review': candidate=candidate.model_copy(update={'producer_id':seats[0].seat_id})
    if defect in ('empty_evidence','wrong_evidence','unknown','duplicate_check'):
        ck=list(reviews[0].checks)
        if defect=='duplicate_check': ck=[ck[0],ck[0]]
        else:
            update={'evidence_digests':()} if defect=='empty_evidence' else {'evidence_digests':('f'*64,)}
            if defect=='unknown': update={'status':'unknown'}
            ck[0]=ck[0].model_copy(update=update)
        reviews[0]=reviews[0].model_copy(update={'checks':tuple(ck)})
    if defect=='missing_view': reviews[0]=reviews[0].model_copy(update={'reviewed_digests':()})
    if defect=='blocking': reviews[0]=reviews[0].model_copy(update={'findings':(c.Finding(
        severity='blocking', target='panel', category='source_mismatch', detail='Wrong chain.'),)})
    if defect=='duplicate_reviewer': reviews[1]=reviews[0]
    if defect=='missing_mechanical': checks=checks[:2]
    if defect=='unknown_mechanical': checks[0]=checks[0].model_copy(update={'status':'unknown'})
    result=module('governor').assess(candidate,seats,reviews,checks,now=NOW)
    assert not result.eligible and result.reasons

def test_scientific_change_invalidates_candidate():
    _,candidate,_,_,_=context()
    altered=candidate.model_copy(update={'evidence_digests':('f'*64,)})
    assert altered.digest!=candidate.digest

def test_contract_rejects_unstructured_narration():
    c=module('contracts')
    with pytest.raises(ValueError):
        c.Check(criterion='geometry',status='pass',evidence_digests=(),thought_process='Firstly...')

def test_candidate_rejects_duplicate_names():
    c,candidate,*_=context()
    with pytest.raises(ValueError):
        c.Candidate(project_id='a',producer_id='b',policy_digest='a'*64,
                    artifacts=(candidate.artifacts[0],candidate.artifacts[0]))

def test_store_rechecks_hash_and_refuses_symlinks(tmp_path):
    s=module('store');store=s.ArtifactStore(tmp_path/'cas')
    a=store.put(b'abc',name='source.dat',media_type='application/octet-stream',role='source')
    assert store.read(a)==b'abc'
    target=store.path(a.digest);target.write_bytes(b'bad')
    with pytest.raises(s.IntegrityError):store.read(a)
    target.unlink();outside=tmp_path/'outside';outside.write_bytes(b'abc')
    try:
        target.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip('symlink creation requires privilege (Developer Mode / admin on Windows)')
    with pytest.raises(s.IntegrityError):store.read(a)

def test_store_is_content_addressed_and_bounded(tmp_path):
    s=module('store');store=s.ArtifactStore(tmp_path/'cas',max_bytes=3)
    a=store.put(b'abc',name='s',media_type='text/plain',role='source')
    assert a.digest==hashlib.sha256(b'abc').hexdigest()
    assert store.put(b'abc',name='s',media_type='text/plain',role='source')==a
    with pytest.raises(ValueError):store.put(b'abcd',name='s',media_type='text/plain',role='source')
    with pytest.raises(ValueError):store.put(b'a',name='../escape',media_type='text/plain',role='source')

def test_event_cas_idempotency_and_tampering(tmp_path):
    s=module('store');ledger=s.EventLedger(tmp_path/'events.sqlite')
    one=ledger.append('p','candidate.sealed',{'digest':'a'*64},key='k',expected_seq=0)
    assert one==ledger.append('p','candidate.sealed',{'digest':'a'*64},key='k',expected_seq=0)
    with pytest.raises(s.ConflictError):ledger.append('p','candidate.sealed',{'digest':'b'*64},key='k',expected_seq=0)
    with pytest.raises(s.ConflictError):ledger.append('p','checked',{},key='k2',expected_seq=0)
    assert ledger.verify('p')
    with sqlite3.connect(ledger.path) as db:db.execute("UPDATE events SET payload='{}'")
    assert not ledger.verify('p')

def test_event_concurrent_append_serializes(tmp_path):
    s=module('store');ledger=s.EventLedger(tmp_path/'events.sqlite')
    def write(i):
        try:return ledger.append('p','candidate.sealed',{'n':i},key=str(i),expected_seq=0)
        except s.ConflictError:return None
    with ThreadPoolExecutor(max_workers=2) as pool:out=list(pool.map(write,[0,1]))
    assert sum(x is not None for x in out)==1 and ledger.verify('p')

def test_unbound_runtime_checks_cannot_certify_a_candidate():
    c,candidate,seats,checks,reviews=context()
    # A real rendered image is not a receipt that a checker examined this candidate.
    checks=[c.Check(criterion=check.criterion,status='pass',
                    evidence_digests=(candidate.artifacts[0].digest,)) for check in checks]
    decision=module('governor').assess(candidate,seats,reviews,checks,now=NOW)
    assert not decision.eligible
