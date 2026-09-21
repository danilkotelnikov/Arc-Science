import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '@heroui/react/button';
import BioArtWorkspace from './BioArtWorkspace';
import MolecularWorkspace from './MolecularWorkspace';
import ResearchWorkspace from './ResearchWorkspace';
import MemoryWorkspace from './MemoryWorkspace';
import ProseWorkspace from './ProseWorkspace';
import SettingsWorkspace from './SettingsWorkspace';
import DiagnosticsWorkspace from './DiagnosticsWorkspace';
import {NATIVE_SESSION, apiFetch} from './http';
import {Icon} from './icons';
import './styles.css';

// The native desktop shell reports finished downloads as `arc-download` window
// events (its WebView shows no download UI); browsers show their own instead.
export function DownloadNotice() {
  const [notice,setNotice]=useState(null);
  useEffect(()=>{
    let timer;
    const finished=event=>{
      const {file,folder,success}=event.detail||{};
      clearTimeout(timer);
      setNotice(success?{tone:'status',text:`Saved ${file||'the download'}${folder?' in '+folder:''}`}:{tone:'alert',text:`Download failed${file?': '+file:''}. Nothing was saved.`});
      timer=setTimeout(()=>setNotice(null),12000);
    };
    window.addEventListener('arc-download',finished);
    return ()=>{window.removeEventListener('arc-download',finished);clearTimeout(timer);};
  },[]);
  return notice?<p role={notice.tone} className={'download-notice '+notice.tone}>{notice.text}</p>:null;
}

// Primary workspaces in the order a session runs, then the tools. One glyph each.
const MAIN=[['research','Research','search'],['memory','Memory','database'],['molecules','Molecules','atom'],['bioart','BioArt','image']];
const TOOLS=[['prose','Prose','pilcrow'],['settings','Settings','sliders-horizontal'],['diagnostics','Diagnostics','activity']];

export function App() {
  const fromLocation=()=>window.location.pathname==='/diagnostics'?'diagnostics':window.history.state?.arcWorkspace||'research';
  const [workspace,setWorkspace]=useState(fromLocation);
  const [token,setToken]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/session/status',{signal:controller.signal}).then(response=>{
      if(response.ok&&!controller.signal.aborted)setToken(current=>current||NATIVE_SESSION);
    }).catch(()=>{/* The ordinary browser and an offline service keep manual unlock. */});
    return()=>controller.abort();
  },[]);
  useEffect(()=>{
    const restored=()=>setWorkspace(fromLocation());
    window.addEventListener('popstate',restored);
    return()=>window.removeEventListener('popstate',restored);
  },[]);
  // Readiness is read once per session: on its own for a desktop session, on a
  // workspace's request for a manual token. Concurrent requests share one fetch per
  // options; a token change discards the previous answer and any request still in
  // flight. {fresh:true} makes the service re-read CLI logins and the credential store
  // instead of its 30 s cache: it never joins a cached read in flight (that one is
  // dropped), while a cached read arriving during a fresh one joins it.
  const [readiness,setReadiness]=useState(null),[readinessError,setReadinessError]=useState(null);
  const pending=useRef(null);
  const refreshReadiness=useCallback(({fresh=false}={})=>{
    if(!token)return Promise.resolve(null);
    const path='/api/readiness'+(fresh?'?fresh=1':'');
    if(pending.current?.token===token&&(pending.current.path===path||!fresh))return pending.current.promise;
    pending.current?.controller.abort();
    const controller=new AbortController();
    const promise=apiFetch(path,{token,signal:controller.signal}).then(response=>response.json()).then(data=>{
      if(controller.signal.aborted)return null;
      setReadiness(data);setReadinessError(null);return data;
    }).catch(error=>{
      if(controller.signal.aborted)return null;
      setReadiness(null);setReadinessError(error?.message||String(error));return null;
    }).finally(()=>{if(pending.current?.controller===controller)pending.current=null;});
    pending.current={token,path,controller,promise};
    return promise;
  },[token]);
  useEffect(()=>{
    if(pending.current&&pending.current.token!==token){pending.current.controller.abort();pending.current=null;}
    setReadiness(null);setReadinessError(null);
    if(token===NATIVE_SESSION)refreshReadiness();
  },[token,refreshReadiness]);
  useEffect(()=>()=>pending.current?.controller.abort(),[]);
  const navigate=next=>{
    const path=next==='diagnostics'?'/diagnostics':'/';
    if(next!==workspace||window.location.pathname!==path)window.history.pushState({arcWorkspace:next},'',path);
    setWorkspace(next);
  };
  const item=([key,label,icon])=><Button key={key} variant="ghost" aria-pressed={workspace===key} onPress={()=>navigate(key)}><Icon name={icon} size={18}/>{label}</Button>;
  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><img className="brand-mark" src="/snoggo-mark.svg" alt="" width="26" height="26"/>Arc Science</div>
      <DownloadNotice/>
      {token===NATIVE_SESSION
        ?<div className="session-control native-session" role="status">Desktop session ready <Button variant="ghost" size="sm" onPress={()=>setToken('')}>Use operator token</Button></div>
        :<div className="session-control token-field"><label htmlFor="operator-token">Operator token</label><input id="operator-token" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" placeholder="Operator token" aria-describedby="operator-token-note"/><span id="operator-token-note" className="visually-hidden">The owner-only token printed by arc-science token --data your-project. It stays in this window.</span></div>}
    </header>
    <div className="app-body">
      <nav className="workspace-nav" aria-label="Workspaces">
        <p className="eyebrow" aria-hidden="true">Main</p>
        {MAIN.map(item)}
        <div className="nav-utility" role="group" aria-label="Tools"><p className="eyebrow" aria-hidden="true">Tools</p>{TOOLS.map(item)}</div>
      </nav>
      <main className="workspace-content">
        {/* Keep every workspace mounted: credentials, drafts and selections stay in memory. */}
        <div hidden={workspace!=='molecules'}><MolecularWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='bioart'}><BioArtWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='research'}><ResearchWorkspace token={token} setToken={setToken} readiness={readiness} readinessError={readinessError} refreshReadiness={refreshReadiness} onNavigate={navigate}/></div>
        <div hidden={workspace!=='memory'}><MemoryWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='prose'}><ProseWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='settings'}><SettingsWorkspace token={token} setToken={setToken} active={workspace==='settings'} readiness={readiness} readinessError={readinessError} refreshReadiness={refreshReadiness} onNavigate={navigate}/></div>
        <div hidden={workspace!=='diagnostics'}><DiagnosticsWorkspace token={token} setToken={setToken} active={workspace==='diagnostics'} readiness={readiness} readinessError={readinessError} refreshReadiness={refreshReadiness} onNavigate={navigate}/></div>
      </main>
    </div>
  </div>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<App/>);
