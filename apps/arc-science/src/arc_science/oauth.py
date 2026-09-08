"""PKCE callback binding for a trusted BFF. Use an OAuth library for discovery/exchange/vaulting.

This helper does not create a provider account, issue credentials or host a callback server.
Issuer/endpoints must first be verified from protected-resource and authorization metadata.
"""
from __future__ import annotations
import base64
import hashlib
import secrets
import threading
from urllib.parse import urlencode,urlsplit
from .transport import validate_endpoint

class OAuthError(ValueError):
    pass

class OAuthTransactions:
    def __init__(self,*,allowed_issuers:set[str],ttl:int=300):
        self.issuers={validate_endpoint(x) for x in allowed_issuers}
        if ttl<=0:raise ValueError('Positive transaction TTL required')
        self.ttl=ttl;self.pending={};self.lock=threading.Lock()

    def begin(self,*,principal:str,project_id:str,resource:str,issuer:str,
              authorization_endpoint:str,token_endpoint:str,client_id:str,
              redirect_uri:str,scopes:tuple[str,...],now:int) -> tuple[str,str]:
        if issuer not in self.issuers:raise OAuthError('Issuer is not approved')
        for endpoint in (resource,authorization_endpoint,token_endpoint,redirect_uri):validate_endpoint(endpoint)
        origin=lambda u:(urlsplit(u).scheme,urlsplit(u).netloc)
        if any(origin(x)!=origin(issuer) for x in (authorization_endpoint,token_endpoint)):
            raise OAuthError('Endpoints outside approved issuer origin require explicit broker support')
        if not principal or not project_id or not client_id:raise OAuthError('Missing authenticated binding')
        if any(not scope or any(x.isspace() for x in scope) for scope in scopes):raise OAuthError('Invalid scopes')
        verifier=secrets.token_urlsafe(48);state=secrets.token_urlsafe(32)
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=').decode()
        with self.lock:
            self.pending={k:v for k,v in self.pending.items() if v['expires_at']>now}
            if len(self.pending)>=1024:raise OAuthError('Too many pending authorizations')
            self.pending[state]={'principal':principal,'project_id':project_id,'issuer':issuer,
                'expires_at':now+self.ttl,'code_verifier':verifier,'resource':resource,
                'client_id':client_id,'redirect_uri':redirect_uri,'token_endpoint':token_endpoint}
        url=authorization_endpoint+'?'+urlencode({'response_type':'code','client_id':client_id,
            'redirect_uri':redirect_uri,'scope':' '.join(scopes),'state':state,
            'code_challenge':challenge,'code_challenge_method':'S256','resource':resource})
        return url,state

    def consume(self,state:str,*,principal:str,project_id:str,issuer:str,now:int) -> dict:
        with self.lock:
            transaction=self.pending.get(state)
            if not transaction:raise OAuthError('Unknown or already consumed state')
            if transaction['expires_at']<=now:
                del self.pending[state];raise OAuthError('Authorization expired')
            if (transaction['principal'],transaction['project_id'],transaction['issuer'])!=(principal,project_id,issuer):
                raise OAuthError('Authorization callback binding mismatch')
            del self.pending[state]
        return {k:transaction[k] for k in ('code_verifier','resource','client_id','redirect_uri','token_endpoint')}
