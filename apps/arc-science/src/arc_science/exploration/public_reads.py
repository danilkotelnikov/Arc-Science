"""Explicitly enabled, fixed-origin public research metadata reads.

No arbitrary URL fetching; no credentials; redirects refused. Retrieval snapshots
are observations, not evidence that a scientific assertion is correct.
"""
import hashlib
import json
from .catalog import PUBLIC_CATALOG, TrustedPublicTools, validate_arguments


def public_tools(client, openalex=None):
    """`openalex` wraps the retraction lookup in its own grant check: a function taking the
    async lookup (called with the DOI list) and returning the guarded call. Without it no DOI
    leaves the machine and every returned work stays unchecked."""
    async def get(url,params=None):
        async with client.stream('GET',url,params=params,timeout=20,follow_redirects=False,
                                 headers={'Accept':'application/json','User-Agent':'ArcScience/0.2'}) as response:
            if response.status_code!=200:raise ValueError('Public service unavailable')
            raw=bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw)>512*1024:raise ValueError('Public response exceeds size limit')
        data=json.loads(raw)
        if not isinstance(data,dict):raise ValueError('Invalid public response')
        return data,hashlib.sha256(raw).hexdigest()

    async def literature(arguments):
        validate_arguments('literature_search', arguments, PUBLIC_CATALOG)
        endpoint='https://www.ebi.ac.uk/europepmc/webservices/rest/search'
        params={'query':arguments['query'],'format':'json','resultType':'core','pageSize':5}
        data,sha=await get(endpoint,params)
        records=data.get('resultList',{}).get('result',[])
        if not isinstance(records,list):raise ValueError('Invalid literature result')
        return {'endpoint':endpoint,'query':arguments['query'],'response_sha256':sha,
                'hit_count':data.get('hitCount'),'records':records[:5],
                'scope':'retrieval_only_not_claim_verification','source':'Europe PMC',
                'retraction_check':await retractions(records[:5])}

    async def lookup(dois):
        return await get('https://api.openalex.org/works',{'filter':'doi:'+'|'.join(dois),'select':'doi,is_retracted','per-page':25})

    async def retractions(records):
        """OpenAlex is_retracted for the DOIs of the returned works, sent only through the
        OpenAlex guard. A refused or failed lookup never fails the search: it is recorded as
        not done, and a work without a usable DOI stays unchecked."""
        endpoint='https://api.openalex.org/works'
        dois,unchecked=[],[]
        for record in records:
            doi=record.get('doi') if isinstance(record,dict) else None
            if isinstance(doi,str) and doi.strip() and not set(doi)&set('|,'):dois.append(doi.strip().lower())
            else:unchecked.append(str(record.get('id') if isinstance(record,dict) else '')[:80])
        dois=sorted(set(dois))
        check={'source':'OpenAlex','endpoint':endpoint,'status':'ok','checked':[],'retracted':[],'unchecked':unchecked}
        if not dois:return check
        if openalex is None:return {**check,'status':'not_granted','unchecked':unchecked+dois}
        try:
            data,sha=await openalex(lookup)(dois)
            found={}
            for work in data.get('results') or ():
                doi=str(work.get('doi') or '').lower().removeprefix('https://doi.org/')
                if isinstance(work.get('is_retracted'),bool):found[doi]=work['is_retracted']
        except Exception as why:
            return {**check,'status':'error','reason':str(why)[:200],'unchecked':unchecked+dois}
        return {**check,'response_sha256':sha,'checked':[d for d in dois if d in found],
                'retracted':[d for d in dois if found.get(d) is True],'unchecked':unchecked+[d for d in dois if d not in found]}

    async def pdb(arguments):
        validate_arguments('pdb_metadata', arguments, PUBLIC_CATALOG)
        accession=arguments['pdb_id'].upper()
        endpoint='https://data.rcsb.org/rest/v1/core/entry/'+accession
        data,sha=await get(endpoint)
        if data.get('rcsb_id')!=accession:raise ValueError('Accession mismatch')
        return {'endpoint':endpoint,'accession':accession,'response_sha256':sha,'snapshot':data,
                'scope':'entry_metadata_only_not_coordinates_or_binding_validation'}

    return TrustedPublicTools({
        'literature_search':(PUBLIC_CATALOG['literature_search'],literature),
        'pdb_metadata':(PUBLIC_CATALOG['pdb_metadata'],pdb),
    })
