"""Isolated concurrent review with controller-side commitments and an evidence-bound gate."""
from __future__ import annotations
import asyncio
import secrets
from .contracts import digest
from .governor import assess

async def review_candidate(candidate,seats,client,store,mechanical,ledger,*,principal:str,now:int,
                           run_id:str,expected_seq:int,timeout:float=90,concurrency:int=4):
    if timeout<=0 or concurrency<1:raise ValueError('Invalid review resource limits')
    if len({s.seat_id for s in seats})!=len(seats):raise ValueError('Duplicate seat IDs')
    lock=asyncio.Lock();semaphore=asyncio.Semaphore(concurrency);seq=expected_seq
    async def record(kind,payload,key):
        nonlocal seq
        async with lock:
            ledger.append(candidate.project_id,kind,payload,key=key,expected_seq=seq);seq+=1
    async def task(seat):
        try:
            async with semaphore:
                review=await asyncio.wait_for(client.review(candidate,seat,store,principal=principal,now=now),timeout)
        except Exception:
            await record('review.error',{'seat_id':seat.seat_id,'candidate_digest':candidate.digest,
                                         'reason':'review_unavailable'},run_id+':error:'+seat.seat_id)
            return None
        # The reviewer never receives another review. Commit before aggregate/reveal.
        nonce=secrets.token_hex(32)
        commitment=digest([candidate.digest,seat.seat_id,review.model_dump(mode='json'),nonce])
        await record('review.commit',{'seat_id':seat.seat_id,'candidate_digest':candidate.digest,
                                      'commitment':commitment},run_id+':commit:'+seat.seat_id)
        return review,nonce,commitment
    results=await asyncio.gather(*(task(seat) for seat in seats))
    reviews=[]
    for item in results:
        if item is None:continue
        review,nonce,commitment=item
        if digest([candidate.digest,review.seat_id,review.model_dump(mode='json'),nonce])!=commitment:
            raise ValueError('Commitment mismatch')
        reviews.append(review)
        await record('review.reveal',{'review':review.model_dump(mode='json'),'nonce':nonce},
                      run_id+':reveal:'+review.seat_id)
    decision=assess(candidate,seats,reviews,mechanical,now=now)
    await record('candidate.assessed',{'candidate_digest':candidate.digest,'policy_digest':candidate.policy_digest,
                 'decision':decision.model_dump(mode='json')},run_id+':decision')
    return decision
