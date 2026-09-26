import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Description} from '@heroui/react/description';
import {Input} from '@heroui/react/input';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {Select} from '@heroui/react/select';
import {Switch} from '@heroui/react/switch';
import {TextField} from '@heroui/react/textfield';
import {PluginContext} from 'molstar/lib/mol-plugin/context';
import {DefaultPluginSpec} from 'molstar/lib/mol-plugin/spec';
import {PluginCommands} from 'molstar/lib/mol-plugin/commands';
import {MolScriptBuilder as MS} from 'molstar/lib/mol-script/language/builder';
import {Color} from 'molstar/lib/mol-util/color';
import {useI18n} from './i18n/index.jsx';
import {GravityIcon} from './theme/gravity-icons.jsx';
import {Block, Kicker} from './ui.jsx';

// A headless Mol* (MIT) viewer on one canvas, loaded as its own chunk. It draws the
// coordinates the operator uploaded, exactly as they are, and overlays the residue
// contacts the pipeline computed as soon as they exist; what it shows is geometry,
// never validation. Mol*'s own panels are not mounted: the controls below are the
// settings, and the defaults come from the operator's settings file.
export const REPRESENTATIONS = {cartoon: 'cartoon', surface: 'molecular-surface', ball_and_stick: 'ball-and-stick', sticks: 'ball-and-stick', spacefill: 'spacefill', backbone: 'backbone'};
export const COLOURINGS = {chain: 'chain-id', element: 'element-symbol', residue: 'residue-name', secondary_structure: 'secondary-structure', bfactor: 'uncertainty', uniform: 'uniform'};
const BACKGROUNDS = {white: 0xffffff, black: 0x000000, transparent: 0xffffff};
const QUALITIES = ['auto', 'high', 'medium', 'low'];
const NO_WEBGL = 'molecules.viewer.no_webgl';
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
  const {t} = useI18n();
  const canvasRef = useRef(null), containerRef = useRef(null), plugin = useRef(null), loaded = useRef(null);
  const structureRef = useRef(null), atomCount = useRef(0), contacts = useRef(null), renderSeq = useRef(0), contactSeq = useRef(0), mutationQueue = useRef(Promise.resolve());
  const [settings, setSettings] = useState({...DEFAULTS, ...(defaults || {})});
  // The status is a list of [key, vars] parts and the error a [key, detail] pair, so a
  // change of language rewords what is already on screen.
  const [status, setStatus] = useState([['molecules.viewer.starting']]), [ready, setReady] = useState(false), [error, setError] = useState(null);
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
        if (!ok) throw new Error(NO_WEBGL);
        if (disposed) { context.dispose(); return; }
        plugin.current = context; setReady(true); setStatus([['molecules.viewer.ready']]);
      } catch (reason) { if (!disposed) setError(['molecules.viewer.start_failed', reason.message]); }
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
      setError(null);
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
      setStatus([['molecules.viewer.loaded', {count: atoms}]]);
      if (snapshot) await PluginCommands.Camera.SetSnapshot(context, {snapshot, durationMs: 0});
      else await PluginCommands.Camera.Reset(context, {});
    } catch (reason) {
      if (sequence === renderSeq.current && plugin.current === context) setError(['molecules.viewer.show_failed', reason?.message || String(reason)]);
    } });
  }, [sourceText, enqueueMutation, removeContacts, settings.representation, settings.colouring, settings.assembly, settings.model_index, settings.quality, settings.waters]);

  const applyContacts = useCallback(async () => {
    const context = plugin.current, currentStructure = structureRef.current;
    if (!context || !currentStructure) return;
    const sequence = ++contactSeq.current;
    return enqueueMutation(async () => { try {
      const isCurrent = () => sequence === contactSeq.current && plugin.current === context && structureRef.current === currentStructure;
      if (!isCurrent()) return;
      setError(null);
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
      const origin = scene?.state === 'verified' ? 'verified' : 'provisional';
      const count = residues.length;
      setStatus([['molecules.viewer.loaded', {count: atomCount.current}],
        ...(count ? [['molecules.viewer.contacts.' + origin, {count}]] : scene ? [['molecules.viewer.contacts.none_' + origin]] : [])]);
    } catch (reason) {
      if (sequence === contactSeq.current && plugin.current === context) setError(['molecules.viewer.overlay_failed', reason?.message || String(reason)]);
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
    } catch (reason) { setError(['molecules.viewer.screenshot_failed', reason.message]); }
  }
  const choose = (key, options) => (
    <Select value={settings[key]} onChange={value => { if (value != null) set(key, String(value)); }}>
      <Label>{t('molecules.viewer.' + key)}</Label>
      <Select.Trigger><Select.Value/><Select.Indicator/></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(v => <ListBox.Item key={v} id={v} textValue={t('molecules.option.' + v)}>{t('molecules.option.' + v)}<ListBox.ItemIndicator/></ListBox.Item>)}
        </ListBox>
      </Select.Popover>
    </Select>
  );
  const toggle = key => (
    <Switch key={key} isSelected={!!settings[key]} onChange={value => set(key, value)}>
      <Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control>{t('molecules.viewer.' + key)}</Switch.Content>
    </Switch>
  );
  const line = error ? t(error[0], {detail: error[1] === NO_WEBGL ? t(NO_WEBGL) : error[1]}) : status.map(([key, vars]) => t(key, vars)).join(' ');
  return <Block className="ar-stack" role="group" aria-label={t('molecules.viewer.label')}>
    <div className="ar-mol-head">
      <div className="ar-stack ar-stack--tight"><Kicker>{t('molecules.viewer.kicker')}</Kicker><h2>{sourceFilename}</h2></div>
      <div className="ar-row">
        <Button variant="secondary" size="sm" isDisabled={!ready} onPress={() => plugin.current && PluginCommands.Camera.Reset(plugin.current, {})}>
          <GravityIcon name="arrow-rotate-left"/>{t('molecules.viewer.reset')}
        </Button>
        <Button variant="secondary" size="sm" isDisabled={!ready || !loaded.current} onPress={screenshot}>
          <GravityIcon name="download"/>{t('molecules.viewer.save')}
        </Button>
      </div>
    </div>
    <div className="ar-mol-canvas" ref={containerRef}><canvas ref={canvasRef}/></div>
    <p className="ar-note" role="status">{line}{stage ? <> <span className="ar-mol-stage">{stage}</span></> : null}</p>
    <div className="ar-mol-fields">
      {choose('representation', Object.keys(REPRESENTATIONS))}
      {choose('colouring', Object.keys(COLOURINGS))}
      {choose('background', Object.keys(BACKGROUNDS))}
      {choose('quality', QUALITIES)}
      <TextField value={assemblyDraft} onChange={setAssemblyDraft} onBlur={commitAssembly} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAssembly(); } }}>
        <Label>{t('molecules.viewer.assembly')}</Label>
        <Input/>
        <Description>{t('molecules.viewer.assembly_note')}</Description>
      </TextField>
    </div>
    <div className="ar-row">{['contacts', 'waters', 'spin'].map(toggle)}</div>
  </Block>;
}
