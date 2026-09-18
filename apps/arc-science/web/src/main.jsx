import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '@heroui/react/button';
import BioArtWorkspace from './BioArtWorkspace';
import MolecularWorkspace from './MolecularWorkspace';
import ResearchWorkspace from './ResearchWorkspace';
import MemoryWorkspace from './MemoryWorkspace';
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
    <header className="app-header"><div className="brand">Arc Science<span className="development">0.6.0 · Development</span></div><span className="header-note">Evidence-bound research workbench</span><DownloadNotice/><a href="/diagnostics">Diagnostics ↗</a></header>
    <div className="app-body"><nav className="workspace-nav" aria-label="Workspaces"><p className="eyebrow">WORKSPACE</p><Button variant="ghost" aria-pressed={workspace==='molecules'} onPress={()=>setWorkspace('molecules')}><Icon name="atom"/>Molecules</Button><Button variant="ghost" aria-pressed={workspace==='bioart'} onPress={()=>setWorkspace('bioart')}><Icon name="scan-search"/>BioArt</Button><Button variant="ghost" aria-pressed={workspace==='research'} onPress={()=>setWorkspace('research')}><Icon name="search"/>Research</Button><Button variant="ghost" aria-pressed={workspace==='memory'} onPress={()=>setWorkspace('memory')}><Icon name="database"/>Memory</Button><p className="nav-footnote">Explore.<br/>Inspect.<br/>Reproduce.</p></nav>
      <main className="workspace-content">
        {/* Keep both workspaces mounted: credentials, goal and selection stay in memory. */}
        <div hidden={workspace!=='molecules'}><MolecularWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='bioart'}><BioArtWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='research'}><ResearchWorkspace token={token} setToken={setToken}/></div>
        <div hidden={workspace!=='memory'}><MemoryWorkspace token={token} setToken={setToken}/></div>
      </main>
    </div>
  </div>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<App/>);
