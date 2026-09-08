"""Exercise a real installed service over localhost; do not use TestClient or model APIs."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import httpx

output=Path(sys.argv[1] if len(sys.argv)>1 else 'native-smoke.json').resolve()
output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='arc-service-') as temp:
    root=Path(temp)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    log=(output.parent/'native-service.log').open('w')
    process=subprocess.Popen([sys.executable,'-m','arc_science.cli','serve','--port',str(port),'--data',str(root)],stdout=log,stderr=log)
    try:
        client=httpx.Client(base_url=base,trust_env=False,timeout=10)
        for _ in range(100):
            try:
                if client.get('/health').status_code==200:break
            except httpx.HTTPError:pass
            time.sleep(.05)
        else:raise AssertionError('Service did not become healthy')
        assert client.get('/api/missions').status_code==401
        token=(root/'access.token').read_text().strip();headers={'Authorization':'Bearer '+token}
        result=client.post('/api/missions',headers=headers,json={'goal':'Compare independent branches for the synthetic nonlinear response.'})
        assert result.status_code==201,result.text
        mid=result.json()['id'];assert client.post(f'/api/missions/{mid}/start',headers=headers).status_code==202
        for _ in range(150):
            state=client.get(f'/api/missions/{mid}',headers=headers).json()['state']
            if state['status'] not in ('ready','running'):break
            time.sleep(.03)
        assert state['status']=='completed',state['status']
        proof=client.get(f'/api/missions/{mid}/verify',headers=headers).json()
        assert proof['reproduction_passed'] and proof['reproduced']==3
        exported=client.get(f'/api/missions/{mid}/capsule',headers=headers)
        assert exported.status_code==200
        (output.parent/'http-tested-capsule.zip').write_bytes(exported.content)
        graph_response=client.get(f'/api/missions/{mid}/evidence',headers=headers)
        assert graph_response.status_code==200,graph_response.text
        assert client.get(f'/api/missions/{mid}/evidence').status_code==401
        graph=graph_response.json()
        assert graph['nodes'] and graph['edges']
        assert state['artifacts'], 'Numerical fixture must produce bound figures'
        artifact_reports=[]
        for artifact in state['artifacts']:
            image_digest=artifact['digest']
            route=f'/api/missions/{mid}/artifacts/{image_digest}'
            assert client.get(route).status_code==401
            response=client.get(route,headers=headers)
            assert response.status_code==200,response.text
            assert response.headers['content-type'].startswith('image/png')
            import hashlib
            assert hashlib.sha256(response.content).hexdigest()==image_digest
            artifact_reports.append({'digest':image_digest,'bytes':len(response.content)})
        required=client.post('/api/missions',headers=headers,json={
            'goal':'Review the numerical fixture figures','vision_review':True})
        assert required.status_code==201,required.text
        required_id=required.json()['id']
        assert client.post(f'/api/missions/{required_id}/start',headers=headers).status_code==202
        for _ in range(150):
            required_state=client.get(f'/api/missions/{required_id}',headers=headers).json()['state']
            if required_state['status'] not in ('ready','running'):break
            time.sleep(.03)
        assert required_state['status']=='needs_input',required_state['status']
        assert not required_state['publication_eligible']
        report={'passed':True,'transport':'real localhost HTTP','wheel_source':__import__('arc_science').__file__,
                'authentication_enforced':True,'status':state['status'],'branches':len(state['branches']),
                'observations':len(state['observations']),'recomputation':proof,
                'evidence_graph_nodes':len(graph['nodes']),'artifacts':artifact_reports,
                'required_vision_without_provider':required_state['status'],
                'browser':{'tested':False,'reason':'Browser checks run separately from this HTTP-only script.'}}
        output.write_text(json.dumps(report,indent=2))
        print(json.dumps({key:report[key] for key in ('passed','wheel_source','authentication_enforced','status','evidence_graph_nodes','artifacts','required_vision_without_provider')},indent=2))
    finally:
        process.terminate()
        try:process.wait(timeout=8)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
        log.close()
