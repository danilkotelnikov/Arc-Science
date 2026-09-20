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
  const [settings, setSettings] = useState({...DEFAULTS, ...(defaults || {})});
  const [status, setStatus] = useState('Starting the viewer…'), [ready, setReady] = useState(false), [error, setError] = useState('');
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

  const render = useCallback(async () => {
    const context = plugin.current;
    if (!context || !source?.text) return;
    try {
      setError('');
      await context.clear();
      const data = await context.builders.data.rawData({data: source.text, label: source.filename || 'coordinates'});
      const trajectory = await context.builders.structure.parseTrajectory(data, formatOf(source.filename));
      const model = await context.builders.structure.createModel(trajectory, {modelIndex: Number(settings.model_index || 0)});
      const assembly = settings.assembly && settings.assembly !== 'asymmetric_unit'
        ? {name: 'assembly', params: {id: String(settings.assembly).replace(/^assembly_/, '')}} : {name: 'model', params: {}};
      const structure = await context.builders.structure.createStructure(model, assembly);
      const type = REPRESENTATIONS[settings.representation] || 'cartoon';
      const color = COLOURINGS[settings.colouring] || 'chain-id';
      const quality = settings.quality === 'auto' ? undefined : settings.quality;
      const polymer = await context.builders.structure.tryCreateComponentStatic(structure, 'polymer');
      if (polymer) await context.builders.structure.representation.addRepresentation(polymer, {type, color, typeParams: quality ? {quality} : undefined, ...(settings.representation === 'sticks' ? {typeParams: {sizeFactor: 0.25, ...(quality ? {quality} : {})}} : {})});
      const ligand = await context.builders.structure.tryCreateComponentStatic(structure, 'ligand');
      if (ligand) await context.builders.structure.representation.addRepresentation(ligand, {type: 'ball-and-stick', color: 'element-symbol'});
      if (settings.waters) {
        const water = await context.builders.structure.tryCreateComponentStatic(structure, 'water');
        if (water) await context.builders.structure.representation.addRepresentation(water, {type: 'ball-and-stick', color: 'element-symbol'});
      }
      const residues = settings.contacts ? contactResidues(scene) : [];
      if (residues.length) {
        const contacts = await context.builders.structure.tryCreateComponentFromExpression(structure, residueExpression(residues), 'contacts', {label: 'Contact residues'});
        if (contacts) await context.builders.structure.representation.addRepresentation(contacts, {type: 'ball-and-stick', color: 'uniform', colorParams: {value: Color(CONTACT_COLOUR)}});
      }
      const atoms = structure.data?.elementCount ?? 0;
      loaded.current = source.text;
      const origin = scene?.state === 'verified' ? 'the verified scene' : 'the provisional scene';
      setStatus('Loaded ' + atoms + ' atoms' + (residues.length ? '; ' + residues.length + ' contact residues from ' + origin + ' highlighted' : scene ? '; no contacts in ' + origin : '') + '.');
      PluginCommands.Camera.Reset(context, {});
    } catch (reason) { setError('The coordinates could not be shown: ' + (reason?.message || String(reason))); }
  }, [source, scene, settings.representation, settings.colouring, settings.assembly, settings.model_index, settings.quality, settings.contacts, settings.waters]);

  useEffect(() => { if (ready) render(); }, [ready, render]);
  useEffect(() => {
    const context = plugin.current;
    if (!context?.canvas3d) return;
    context.canvas3d.setProps({renderer: {backgroundColor: Color(BACKGROUNDS[settings.background] ?? 0xffffff)}, transparentBackground: settings.background === 'transparent',
      trackball: {animate: settings.spin ? {name: 'spin', params: {speed: 1}} : {name: 'off', params: {}}}});
  }, [ready, settings.background, settings.spin]);

  const set = (key, value) => setSettings(current => ({...current, [key]: value}));
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
    {options.map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}</select></label>;
  return <div className="viewer" aria-label="Molecular viewer">
    <div className="viewer-canvas" ref={containerRef}><canvas ref={canvasRef}/></div>
    <div className="viewer-controls">
      {select('representation', Object.keys(REPRESENTATIONS), 'Representation')}
      {select('colouring', Object.keys(COLOURINGS), 'Colouring')}
      {select('background', Object.keys(BACKGROUNDS), 'Background')}
      {select('quality', QUALITIES, 'Quality')}
      <label>Assembly<input aria-label="Assembly" value={settings.assembly} onChange={e => set('assembly', e.target.value || 'asymmetric_unit')}/></label>
      <label className="check"><input type="checkbox" checked={!!settings.contacts} onChange={e => set('contacts', e.target.checked)}/>contacts</label>
      <label className="check"><input type="checkbox" checked={!!settings.waters} onChange={e => set('waters', e.target.checked)}/>waters</label>
      <label className="check"><input type="checkbox" checked={!!settings.spin} onChange={e => set('spin', e.target.checked)}/>spin</label>
      <Button variant="ghost" size="sm" isDisabled={!ready} onPress={() => plugin.current && PluginCommands.Camera.Reset(plugin.current, {})}>Reset view</Button>
      <Button variant="ghost" size="sm" isDisabled={!ready || !loaded.current} onPress={screenshot}>Save view</Button>
    </div>
    <p className="field-note" role="status">{error || status}{stage ? ' · ' + stage : ''}</p>
  </div>;
}
