import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '@heroui/react/button';
import BioArtWorkspace from './BioArtWorkspace';
import MolecularWorkspace from './MolecularWorkspace';
import ResearchWorkspace from './ResearchWorkspace';
import MemoryWorkspace from './MemoryWorkspace';
import ProseWorkspace from './ProseWorkspace';
import SettingsWorkspace from './SettingsWorkspace';
import DiagnosticsWorkspace from './DiagnosticsWorkspace';
import {NATIVE_SESSION} from './http';
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
        :<div className="session-control token-field"><label htmlFor="operator-token">Operator token</label><input id="operator-token" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" placeholder="Paste to unlock" aria-describedby="operator-token-note"/><span id="operator-token-note" className="visually-hidden">The owner-only token printed by arc-science token --data your-project. It stays in this window.</span></div>}
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
        <div hidden={workspace!=='research'}><ResearchWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='memory'}><MemoryWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='prose'}><ProseWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='settings'}><SettingsWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='diagnostics'}><DiagnosticsWorkspace token={token} setToken={setToken} active={workspace==='diagnostics'}/></div>
      </main>
    </div>
  </div>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<App/>);
