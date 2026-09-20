import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '@heroui/react/button';
import BioArtWorkspace from './BioArtWorkspace';
import MolecularWorkspace from './MolecularWorkspace';
import ResearchWorkspace from './ResearchWorkspace';
import MemoryWorkspace from './MemoryWorkspace';
import ProseWorkspace from './ProseWorkspace';
import SettingsWorkspace from './SettingsWorkspace';
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
  const [workspace,setWorkspace]=useState('molecules');
  const [token,setToken]=useState('');
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><img className="brand-mark" src="/snoggo-mark.svg" alt="" width="26" height="26"/>Arc Science</div><DownloadNotice/><label className="token-field"><span>Operator token</span><input id="operator-token" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" aria-describedby="operator-token-note"/></label><span id="operator-token-note" className="header-note">In memory only · <code>arc-science token --data ./data</code></span><a href="/diagnostics">Diagnostics ↗</a></header>
    <div className="app-body"><nav className="workspace-nav" aria-label="Workspaces"><p className="eyebrow">WORKSPACE</p><Button variant="ghost" aria-pressed={workspace==='molecules'} onPress={()=>setWorkspace('molecules')}><Icon name="atom"/>Molecules</Button><Button variant="ghost" aria-pressed={workspace==='bioart'} onPress={()=>setWorkspace('bioart')}><Icon name="scan-search"/>BioArt</Button><Button variant="ghost" aria-pressed={workspace==='research'} onPress={()=>setWorkspace('research')}><Icon name="search"/>Research</Button><Button variant="ghost" aria-pressed={workspace==='memory'} onPress={()=>setWorkspace('memory')}><Icon name="database"/>Memory</Button><Button variant="ghost" aria-pressed={workspace==='prose'} onPress={()=>setWorkspace('prose')}><Icon name="pen-line"/>Prose</Button><Button variant="ghost" aria-pressed={workspace==='settings'} onPress={()=>setWorkspace('settings')}><Icon name="sliders"/>Settings</Button></nav>
      <main className="workspace-content">
        {/* Keep both workspaces mounted: credentials, goal and selection stay in memory. */}
        <div hidden={workspace!=='molecules'}><MolecularWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='bioart'}><BioArtWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='research'}><ResearchWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='memory'}><MemoryWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='prose'}><ProseWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='settings'}><SettingsWorkspace token={token}/></div>
      </main>
    </div>
  </div>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<App/>);
