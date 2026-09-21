import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {PluginContext} from 'molstar/lib/mol-plugin/context';
import {DefaultPluginSpec} from 'molstar/lib/mol-plugin/spec';
import {PluginCommands} from 'molstar/lib/mol-plugin/commands';
import {MolScriptBuilder as MS} from 'molstar/lib/mol-script/language/builder';
import {Color} from 'molstar/lib/mol-util/color';

// A headless Mol* (MIT) viewer on one canvas, loaded as its own chunk. It draws the
// coordinates the operator uploaded, exactly as they are, and overlays the residue
// contacts the pipeline computed as soon as they exist; what it shows is geometry,
// never validation. Mol*'s own panels are not mounted: the controls below are the
// settings, and the defaults come from the operator's settings file.
export const REPRESENTATIONS = {cartoon: 'cartoon', surface: 'molecular-surface', ball_and_stick: 'ball-and-stick', sticks: 'ball-and-stick', spacefill: 'spacefill', backbone: 'backbone'};
export const COLOURINGS = {chain: 'chain-id', element: 'element-symbol', residue: 'residue-name', secondary_structure: 'secondary-structure', bfactor: 'uncertainty', uniform: 'uniform'};
const BACKGROUNDS = {white: 0xffffff, black: 0x000000, transparent: 0xffffff};
const QUALITIES = ['auto', 'high', 'medium', 'low'];
const OPTION_LABELS = {bfactor: 'B-factor'};
const CONTACT_COLOUR = 0xd9480f;
export const DEFAULTS = {representation: 'cartoon', colouring: 'chain', assembly: 'asymmetric_unit', background: 'white', quality: 'auto', spin: false, contacts: true, waters: false};

export function formatOf(filename) {
  const name = (filename || '').toLowerCase();
  return name.endsWith('.cif') || name.endsWith('.mmcif') ? 'mmcif' : 'pdb';
}

// 'A:100B' -> {chain: 'A', seq: 100, icode: 'B'}; the pipeline's residue identity.
export function parseResidue(id) {
  const match = /^(.+?):(-?\d+)([A-Za-z]?)$/.exec(String(id || ''));
  return match ? {chain: match[1], seq: Number(match[2]), icode: match[3] || ''} : null;
}

export function contactResidues(scene) {
  const ids = new Set();
  for (const contact of scene?.contacts || []) {
    for (const side of ['antibody_residue', 'antigen_residue']) if (contact[side]) ids.add(contact[side]);
  }
  return [...ids].map(parseResidue).filter(Boolean);
}

function residueExpression(residues) {
  const tests = residues.map(r => MS.core.logic.and([
    MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), r.chain]),
    MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), r.seq]),
    MS.core.rel.eq([MS.struct.atomProperty.macromolecular.pdbx_PDB_ins_code(), r.icode]),
  ]));
  return MS.struct.generator.atomGroups({'residue-test': tests.length === 1 ? tests[0] : MS.core.logic.or(tests)});
}

export default function MolecularViewer({source, scene, defaults, stage}) {
  const canvasRef = useRef(null), containerRef = useRef(null), plugin = useRef(null), loaded = useRef(null);
  const structureRef = useRef(null), atomCount = useRef(0), contacts = useRef(null), renderSeq = useRef(0), contactSeq = useRef(0), mutationQueue = useRef(Promise.resolve());
  const [settings, setSettings] = useState({...DEFAULTS, ...(defaults || {})});
  const [status, setStatus] = useState('Starting the viewer…'), [ready, setReady] = useState(false), [error, setError] = useState('');
  const [structureRevision, setStructureRevision] = useState(0);
  const sourceText = source?.text || '', sourceFilename = source?.filename || '';
  useEffect(() => { setSettings(current => ({...current, ...(defaults || {})})); }, [defaults]);

  useEffect(() => {
    let disposed = false;
    const context = new PluginContext(DefaultPluginSpec());
    (async () => {
      try {
        await context.init();
        const ok = await context.initViewerAsync(canvasRef.current, containerRef.current);
        if (!ok) throw new Error('WebGL is not available in this window.');
        if (disposed) { context.dispose(); return; }
        plugin.current = context; setReady(true); setStatus('Viewer ready.');
      } catch (reason) { if (!disposed) setError('The viewer could not start: ' + reason.message); }
    })();
    return () => { disposed = true; plugin.current = null; context.dispose(); };
  }, []);

  const enqueueMutation = useCallback(task => {
    const run = mutationQueue.current.catch(() => {}).then(task);
    mutationQueue.current = run.catch(() => {});
    return run;
  }, []);

  const removeContacts = useCallback(async (context, isCurrent = () => true) => {
    if (!contacts.current || !isCurrent()) return;
    const previous = contacts.current;
    contacts.current = null;
    for (const ref of [previous.representation?.ref, previous.component?.ref].filter(Boolean)) {
      if (!isCurrent()) return;
      await PluginCommands.State.RemoveObject(context, {state: context.state.data, ref, removeParentGhosts: true});
    }
  }, []);

  const render = useCallback(async () => {
    const context = plugin.current;
    if (!context || !sourceText) return;
    const sequence = ++renderSeq.current;
    return enqueueMutation(async () => { try {
      const isCurrent = () => sequence === renderSeq.current && plugin.current === context;
      if (!isCurrent()) return;
      setError('');
      const sameCoordinates = loaded.current === sourceText;
      const snapshot = sameCoordinates ? context.canvas3d?.camera?.getSnapshot?.() : null;
      await removeContacts(context, isCurrent);
      if (!isCurrent()) return;
      await context.clear();
      if (!isCurrent()) return;
      const data = await context.builders.data.rawData({data: sourceText, label: sourceFilename || 'coordinates'});
      if (!isCurrent()) return;
      const trajectory = await context.builders.structure.parseTrajectory(data, formatOf(sourceFilename));
      if (!isCurrent()) return;
      const model = await context.builders.structure.createModel(trajectory, {modelIndex: Number(settings.model_index || 0)});
      if (!isCurrent()) return;
      const assembly = settings.assembly && settings.assembly !== 'asymmetric_unit'
        ? {name: 'assembly', params: {id: String(settings.assembly).replace(/^assembly_/, '')}} : {name: 'model', params: {}};
      const structure = await context.builders.structure.createStructure(model, assembly);
      if (!isCurrent()) return;
      const type = REPRESENTATIONS[settings.representation] || 'cartoon';
      const color = COLOURINGS[settings.colouring] || 'chain-id';
      const quality = settings.quality === 'auto' ? undefined : settings.quality;
      const polymer = await context.builders.structure.tryCreateComponentStatic(structure, 'polymer');
      if (!isCurrent()) return;
      if (polymer) await context.builders.structure.representation.addRepresentation(polymer, {type, color, typeParams: quality ? {quality} : undefined, ...(settings.representation === 'sticks' ? {typeParams: {sizeFactor: 0.25, ...(quality ? {quality} : {})}} : {})});
      if (!isCurrent()) return;
      const ligand = await context.builders.structure.tryCreateComponentStatic(structure, 'ligand');
      if (!isCurrent()) return;
      if (ligand) await context.builders.structure.representation.addRepresentation(ligand, {type: 'ball-and-stick', color: 'element-symbol'});
      if (settings.waters) {
        if (!isCurrent()) return;
        const water = await context.builders.structure.tryCreateComponentStatic(structure, 'water');
        if (!isCurrent()) return;
        if (water) await context.builders.structure.representation.addRepresentation(water, {type: 'ball-and-stick', color: 'element-symbol'});
      }
      if (!isCurrent()) return;
      const atoms = structure.data?.elementCount ?? 0;
      loaded.current = sourceText; atomCount.current = atoms; structureRef.current = structure; setStructureRevision(value => value + 1);
      setStatus('Loaded ' + atoms + ' atoms.');
      if (snapshot) await PluginCommands.Camera.SetSnapshot(context, {snapshot, durationMs: 0});
      else await PluginCommands.Camera.Reset(context, {});
    } catch (reason) {
      if (sequence === renderSeq.current && plugin.current === context) setError('The coordinates could not be shown: ' + (reason?.message || String(reason)));
    } });
  }, [sourceText, enqueueMutation, removeContacts, settings.representation, settings.colouring, settings.assembly, settings.model_index, settings.quality, settings.waters]);

  const applyContacts = useCallback(async () => {
    const context = plugin.current, currentStructure = structureRef.current;
    if (!context || !currentStructure) return;
    const sequence = ++contactSeq.current;
    return enqueueMutation(async () => { try {
      const isCurrent = () => sequence === contactSeq.current && plugin.current === context && structureRef.current === currentStructure;
      if (!isCurrent()) return;
      setError('');
      await removeContacts(context, isCurrent);
      if (!isCurrent()) return;
      const residues = settings.contacts ? contactResidues(scene) : [];
      let representation = null, component = null;
      if (residues.length) {
        component = await context.builders.structure.tryCreateComponentFromExpression(currentStructure, residueExpression(residues), 'contacts', {label: 'Contact residues'});
        if (!isCurrent()) {
          if (component?.ref) await PluginCommands.State.RemoveObject(context, {state: context.state.data, ref: component.ref, removeParentGhosts: true});
          return;
        }
        if (component) representation = await context.builders.structure.representation.addRepresentation(component, {type: 'ball-and-stick', color: 'uniform', colorParams: {value: Color(CONTACT_COLOUR)}});
      }
      if (!isCurrent()) return;
      contacts.current = {component, representation};
      // Provisional contacts come from the pipeline while it still renders; verified ones once it has finished.
      const origin = scene?.state === 'verified' ? 'verified contacts (render finished)' : 'provisional contacts (render still running)';
      const count = residues.length;
      setStatus('Loaded ' + atomCount.current + ' atoms.' + (count ? ' ' + count + (count === 1 ? ' contact residue' : ' contact residues') + ' highlighted from ' + origin + '; coordinates unchanged.' : scene ? ' No ' + origin + '; coordinates unchanged.' : ''));
    } catch (reason) {
      if (sequence === contactSeq.current && plugin.current === context) setError('The contact overlay could not be updated: ' + (reason?.message || String(reason)));
    } });
  }, [scene, enqueueMutation, removeContacts, settings.contacts]);

  useEffect(() => { if (ready) render(); }, [ready, render]);
  useEffect(() => { if (ready) applyContacts(); }, [ready, applyContacts, structureRevision]);
  useEffect(() => {
    const context = plugin.current;
    if (!context?.canvas3d) return;
    context.canvas3d.setProps({renderer: {backgroundColor: Color(BACKGROUNDS[settings.background] ?? 0xffffff)}, transparentBackground: settings.background === 'transparent',
      trackball: {animate: settings.spin ? {name: 'spin', params: {speed: 1}} : {name: 'off', params: {}}}});
  }, [ready, settings.background, settings.spin]);

  const set = (key, value) => setSettings(current => ({...current, [key]: value}));
  // The assembly is committed on Enter or blur: every change of settings.assembly re-parses the structure.
  const [assemblyDraft, setAssemblyDraft] = useState(settings.assembly);
  useEffect(() => { setAssemblyDraft(settings.assembly); }, [settings.assembly]);
  const commitAssembly = () => set('assembly', assemblyDraft.trim() || 'asymmetric_unit');
  async function screenshot() {
    const context = plugin.current;
    if (!context) return;
    try {
      // A blob: URL, which the desktop shell accepts as a download target (a data: URI is not).
      const uri = await context.helpers.viewportScreenshot.getImageDataUri();
      const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], {type: 'image/png'}));
      const link = document.createElement('a'); link.href = url; link.download = (source?.filename || 'structure').replace(/\.[^.]+$/, '') + '-view.png';
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (reason) { setError('Screenshot failed: ' + reason.message); }
  }
  const select = (key, options, label) => <label>{label}<select aria-label={label} value={settings[key]} onChange={e => set(key, e.target.value)}>
    {options.map(v => <option key={v} value={v}>{OPTION_LABELS[v] || v.replace(/_/g, ' ')}</option>)}</select></label>;
  return <div className="viewer" role="group" aria-label="Molecular viewer">
    <div className="viewer-canvas" ref={containerRef}><canvas ref={canvasRef}/></div>
    <div className="viewer-controls">
      {select('representation', Object.keys(REPRESENTATIONS), 'Representation')}
      {select('colouring', Object.keys(COLOURINGS), 'Colouring')}
      {select('background', Object.keys(BACKGROUNDS), 'Background')}
      {select('quality', QUALITIES, 'Quality')}
      <label>Viewer assembly (press Enter to apply)<input aria-label="Viewer assembly (press Enter to apply)" value={assemblyDraft} onChange={e => setAssemblyDraft(e.target.value)} onBlur={commitAssembly} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAssembly(); } }}/></label>
      <label className="check"><input type="checkbox" checked={!!settings.contacts} onChange={e => set('contacts', e.target.checked)}/>Show contacts</label>
      <label className="check"><input type="checkbox" checked={!!settings.waters} onChange={e => set('waters', e.target.checked)}/>Show waters</label>
      <label className="check"><input type="checkbox" checked={!!settings.spin} onChange={e => set('spin', e.target.checked)}/>Spin</label>
      <Button variant="ghost" size="sm" isDisabled={!ready} onPress={() => plugin.current && PluginCommands.Camera.Reset(plugin.current, {})}>Reset view</Button>
      <Button variant="ghost" size="sm" isDisabled={!ready || !loaded.current} onPress={screenshot}>Save view as PNG</Button>
    </div>
    <p className="field-note" role="status">{error || status}{stage ? ' · ' + stage : ''}</p>
  </div>;
}
