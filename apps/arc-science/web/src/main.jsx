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
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><img className="brand-mark" src="/snoggo-mark.svg" alt="" width="26" height="26"/>Arc Science</div><DownloadNotice/>{token===NATIVE_SESSION?<div className="native-session" role="status">Desktop session ready <Button variant="ghost" onPress={()=>setToken('')}>Use operator token</Button></div>:<><label className="token-field"><span>Operator token</span><input id="operator-token" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" aria-describedby="operator-token-note"/></label><span id="operator-token-note" className="header-note">Run <code>arc-science token --data ./data</code> for your project; paste token here.</span></>}</header>
    <div className="app-body"><nav className="workspace-nav" aria-label="Workspaces"><p className="eyebrow">MAIN</p><Button variant="ghost" aria-pressed={workspace==='research'} onPress={()=>navigate('research')}><Icon name="search"/>Research</Button><Button variant="ghost" aria-pressed={workspace==='memory'} onPress={()=>navigate('memory')}><Icon name="database"/>Memory</Button><Button variant="ghost" aria-pressed={workspace==='molecules'} onPress={()=>navigate('molecules')}><Icon name="atom"/>Molecules</Button><Button variant="ghost" aria-pressed={workspace==='bioart'} onPress={()=>navigate('bioart')}><Icon name="scan-search"/>BioArt</Button><div className="nav-utility"><p className="eyebrow">TOOLS</p><Button variant="ghost" aria-pressed={workspace==='prose'} onPress={()=>navigate('prose')}><Icon name="pen-line"/>Prose</Button><Button variant="ghost" aria-pressed={workspace==='settings'} onPress={()=>navigate('settings')}><Icon name="sliders"/>Settings</Button><Button variant="ghost" aria-pressed={workspace==='diagnostics'} onPress={()=>navigate('diagnostics')}><Icon name="scan-search"/>Diagnostics</Button></div></nav>
      <main className="workspace-content">
        {/* Keep both workspaces mounted: credentials, goal and selection stay in memory. */}
        <div hidden={workspace!=='molecules'}><MolecularWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='bioart'}><BioArtWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='research'}><ResearchWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='memory'}><MemoryWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='prose'}><ProseWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='settings'}><SettingsWorkspace token={token}/></div>
        <div hidden={workspace!=='diagnostics'}><DiagnosticsWorkspace token={token} active={workspace==='diagnostics'}/></div>
      </main>
    </div>
  </div>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<App/>);
