'use strict';
const $=id=>document.getElementById(id);let selected=null,timer=null,artifactUrls=[],artifactGeneration=0,artifactKey=null;
function text(tag,value,klass=''){const el=document.createElement(tag);el.textContent=value;el.className=klass;return el;}
async function api(path,method='GET',body){const r=await fetch('/api'+path,{method,headers:{Authorization:'Bearer '+$('token').value,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok){let e;try{e=await r.json();}catch{e={detail:r.statusText};}throw Error(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail));}return r;}
function message(e){$('message').textContent=e instanceof Error?e.message:e;}
async function renderArtifacts(mid,artifacts){
const key=JSON.stringify([mid,artifacts.map(artifact=>artifact.digest)]);
if(key===artifactKey)return;
artifactKey=key;const generation=++artifactGeneration,urls=[];
artifactUrls.forEach(URL.revokeObjectURL);artifactUrls=[];$('artifacts').replaceChildren();
const results=await Promise.allSettled(artifacts.map(async artifact=>{
const response=await api(`/missions/${mid}/artifacts/${artifact.digest}`);
const url=URL.createObjectURL(await response.blob());urls.push(url);
const card=document.createElement('figure');card.className='artifact';
const img=document.createElement('img');img.src=url;img.alt=`Exploratory fit plot from ${artifact.source_observation_id}`;
card.append(img,text('figcaption',`${artifact.source_observation_id} · ${artifact.digest.slice(0,12)}…`,'muted'));return card;
}));
if(generation!==artifactGeneration||selected!==mid){urls.forEach(URL.revokeObjectURL);return;}
const failed=results.find(result=>result.status==='rejected');
if(failed){artifactKey=null;urls.forEach(URL.revokeObjectURL);throw failed.reason;}
artifactUrls=urls;$('artifacts').replaceChildren(...results.map(result=>result.value));
}
function render(row){const s=row.state;selected=row.id;$('workspace').hidden=false;$('status').textContent=s.status;$('counters').textContent=`Round ${s.round} · ${s.actions_used} actions · ${s.model_calls_used} model-role calls · data: ${s.data_origin} · publication: not authorized`;
$('branches').replaceChildren(...s.branches.map(b=>{const el=text('article','', 'branch'+(b.id===s.focus?' focus':''));el.append(text('h3',b.title),text('p',b.hypothesis),text('p','Falsifier: '+b.falsifier),text('p',`Opened round ${b.created_round} · parents: ${b.parents.join(', ')||'root'}`,'muted'));return el;}));
$('visual-reviews').replaceChildren(...s.visual_reports.map(r=>{const el=text('div','','record');el.append(text('strong',`${r.model} · round ${r.round} · ${r.verdict}`),...r.findings.map(f=>text('p',`${f.category}: ${f.detail}`)));return el;}));
renderArtifacts(row.id,s.artifacts).catch(message);
$('reviews').replaceChildren(...s.assessments.slice(-12).map(a=>{const el=text('div','','record');el.append(text('strong',`${a.role} · ${a.branch_id} · ${a.position}`),text('p',a.finding),text('p','Evidence: '+a.evidence_ids.join(', '),'muted'));return el;}));
$('observations').replaceChildren(...s.observations.map(o=>{const el=text('details','','record');el.append(text('summary',`${o.id} · ${o.tool} · ${o.status}`),text('pre',JSON.stringify(o.data,null,2)));return el;}));
$('events').replaceChildren(...s.events.slice(-15).reverse().map(e=>text('p',`[${e.round}] ${e.kind}: ${e.detail}`,'muted')));
$('resume').disabled=!['ready','paused'].includes(s.status);$('cancel').disabled=s.status==='cancelled';
if(!['ready','running'].includes(s.status)){clearInterval(timer);timer=null;message(s.stop_reason);}}
async function load(mid){render(await(await api('/missions/'+mid)).json());}
function poll(mid){clearInterval(timer);timer=setInterval(()=>load(mid).catch(message),700);}
$('run').onclick=async()=>{try{$('run').disabled=true;const row=await(await api('/missions','POST',{goal:$('goal').value,mode:$('mode').value,max_rounds:Number($('rounds').value),allow_egress:$('egress').checked,vision_review:$('vision').checked})).json();render(row);await api('/missions/'+row.id+'/start','POST');await load(row.id);poll(row.id);}catch(e){message(e);}finally{$('run').disabled=false;}};
$('list').onclick=async()=>{try{const rows=await(await api('/missions')).json();$('missions').replaceChildren(...rows.map(r=>{const b=text('button',`${r.status} · ${r.goal}`);b.onclick=()=>{load(r.id).then(()=>poll(r.id)).catch(message);};return b;}));}catch(e){message(e);}};
$('verify').onclick=async()=>{try{$('verification').textContent=JSON.stringify(await(await api('/missions/'+selected+'/verify')).json(),null,2);}catch(e){message(e);}};
$('export').onclick=async()=>{try{const r=await api('/missions/'+selected+'/capsule');const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download='arc-'+selected+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch(e){message(e);}};
$('cancel').onclick=async()=>{try{await api('/missions/'+selected+'/cancel','POST');await load(selected);}catch(e){message(e);}};
$('resume').onclick=async()=>{try{await api('/missions/'+selected+'/start','POST');poll(selected);}catch(e){message(e);}};
