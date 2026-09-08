"""Explicitly enabled, fixed-origin public research metadata reads.

No arbitrary URL fetching; no credentials; redirects refused. Retrieval snapshots
are observations, not evidence that a scientific assertion is correct.
"""
import hashlib
import json
from .catalog import PUBLIC_CATALOG, TrustedPublicTools, validate_arguments


def public_tools(client):
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
                'scope':'retrieval_only_not_claim_verification','source':'Europe PMC'}

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
