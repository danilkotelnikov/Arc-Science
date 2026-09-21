import React from 'react';
import {afterEach, expect, test, vi} from 'vitest';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import MolecularViewer from './MolecularViewer';

const molstar = vi.hoisted(() => {
  const contexts = [];
  let contactIndex = 0, representationIndex = 0;
  function createContext() {
    const context = {
      init: vi.fn().mockResolvedValue(undefined),
      initViewerAsync: vi.fn().mockResolvedValue(true),
      dispose: vi.fn(),
      clear: vi.fn().mockResolvedValue(undefined),
      state: {data: {kind: 'data-state'}},
      canvas3d: {
        setProps: vi.fn(),
        camera: {getSnapshot: vi.fn(() => ({target: [1, 2, 3], position: [4, 5, 6], radius: 7}))},
      },
      helpers: {viewportScreenshot: {getImageDataUri: vi.fn()}},
      builders: {
        data: {rawData: vi.fn(async input => ({ref: 'data', input}))},
        structure: {
          parseTrajectory: vi.fn(async () => ({ref: 'trajectory'})),
          createModel: vi.fn(async () => ({ref: 'model'})),
          createStructure: vi.fn(async () => ({ref: 'structure', data: {elementCount: 42}})),
          tryCreateComponentStatic: vi.fn(async (_structure, kind) => kind === 'polymer' ? {ref: 'polymer'} : null),
          tryCreateComponentFromExpression: vi.fn(async () => ({ref: 'contacts-' + (++contactIndex)})),
          representation: {addRepresentation: vi.fn(async (component, props) => ({ref: 'representation-' + (++representationIndex), component, props}))},
        },
      },
    };
    contexts.push(context);
    return context;
  }
  return {contexts, createContext, reset: () => { contactIndex = 0; representationIndex = 0; }};
});

vi.mock('molstar/lib/mol-plugin/context', () => ({
  PluginContext: vi.fn(function PluginContext() { return molstar.createContext(); }),
}));
vi.mock('molstar/lib/mol-plugin/spec', () => ({DefaultPluginSpec: vi.fn(() => ({kind: 'default-spec'}))}));
vi.mock('molstar/lib/mol-plugin/commands', () => ({
  PluginCommands: {
    Camera: {
      Reset: vi.fn().mockResolvedValue(undefined),
      SetSnapshot: vi.fn().mockResolvedValue(undefined),
    },
    State: {
      RemoveObject: vi.fn().mockResolvedValue(undefined),
    },
  },
}));
vi.mock('molstar/lib/mol-script/language/builder', () => ({
  MolScriptBuilder: {
    core: {
      logic: {and: vi.fn(parts => ({and: parts})), or: vi.fn(parts => ({or: parts}))},
      rel: {eq: vi.fn(parts => ({eq: parts}))},
    },
    struct: {
      atomProperty: {macromolecular: {
        auth_asym_id: vi.fn(() => 'chain'),
        auth_seq_id: vi.fn(() => 'seq'),
        pdbx_PDB_ins_code: vi.fn(() => 'icode'),
      }},
      generator: {atomGroups: vi.fn(params => ({atomGroups: params}))},
    },
  },
}));
vi.mock('molstar/lib/mol-util/color', () => ({Color: vi.fn(value => value)}));

async function readyContext() {
  await screen.findByText(/Loaded 42 atoms\./);
  return molstar.contexts.at(-1);
}

afterEach(async () => {
  cleanup();
  molstar.contexts.length = 0;
  molstar.reset();
  vi.clearAllMocks();
});

test('updates contact overlays without clearing the loaded structure or resetting the camera', async () => {
  const source = {filename: 'complex.cif', text: 'data_complex'};
  const provisional = {state: 'provisional', contacts: [{antibody_residue: 'A:1', antigen_residue: 'C:1'}]};
  const verified = {state: 'verified', contacts: [{antibody_residue: 'A:1', antigen_residue: 'C:1'}, {antibody_residue: 'B:2', antigen_residue: 'C:2'}]};
  const {rerender} = render(<MolecularViewer source={source} scene={null} defaults={{}} stage="queued"/>);
  const context = await readyContext();
  const {PluginCommands} = await import('molstar/lib/mol-plugin/commands');
  expect(context.clear).toHaveBeenCalledTimes(1);
  expect(PluginCommands.Camera.Reset).toHaveBeenCalledTimes(1);

  rerender(<MolecularViewer source={source} scene={provisional} defaults={{}} stage="contacts ready"/>);
  await screen.findByText(/2 contact residues highlighted from provisional contacts \(render still running\); coordinates unchanged/);
  expect(context.clear).toHaveBeenCalledTimes(1);
  expect(PluginCommands.Camera.Reset).toHaveBeenCalledTimes(1);
  expect(PluginCommands.Camera.SetSnapshot).not.toHaveBeenCalled();
  expect(context.builders.structure.tryCreateComponentFromExpression).toHaveBeenCalledTimes(1);

  rerender(<MolecularViewer source={source} scene={verified} defaults={{}} stage="render complete"/>);
  await screen.findByText(/4 contact residues highlighted from verified contacts \(render finished\); coordinates unchanged/);
  expect(context.clear).toHaveBeenCalledTimes(1);
  expect(context.builders.structure.tryCreateComponentFromExpression).toHaveBeenCalledTimes(2);
  expect(PluginCommands.State.RemoveObject).toHaveBeenCalledWith(context, {state: context.state.data, ref: 'representation-2', removeParentGhosts: true});
  expect(PluginCommands.State.RemoveObject).toHaveBeenCalledWith(context, {state: context.state.data, ref: 'contacts-1', removeParentGhosts: true});

  rerender(<MolecularViewer source={source} scene={verified} defaults={{}} stage="cancelled"/>);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('cancelled'));
  expect(context.clear).toHaveBeenCalledTimes(1);
  expect(context.builders.structure.tryCreateComponentFromExpression).toHaveBeenCalledTimes(2);
});

test('preserves the camera when rebuilding representations for the same coordinates', async () => {
  const source = {filename: 'complex.cif', text: 'data_complex'};
  const {rerender} = render(<MolecularViewer source={source} scene={null} defaults={{representation: 'cartoon'}} stage=""/>);
  const context = await readyContext();
  const {PluginCommands} = await import('molstar/lib/mol-plugin/commands');
  expect(context.clear).toHaveBeenCalledTimes(1);

  rerender(<MolecularViewer source={source} scene={null} defaults={{representation: 'surface'}} stage=""/>);
  await waitFor(() => expect(context.clear).toHaveBeenCalledTimes(2));
  expect(context.canvas3d.camera.getSnapshot).toHaveBeenCalled();
  expect(PluginCommands.Camera.Reset).toHaveBeenCalledTimes(1);
  expect(PluginCommands.Camera.SetSnapshot).toHaveBeenCalledWith(context, {snapshot: {target: [1, 2, 3], position: [4, 5, 6], radius: 7}, durationMs: 0});
});

test('adopting the same coordinate text as a job source does not clear, parse or reset Molstar', async () => {
  const upload = {filename: 'complex.cif', text: 'data_complex', origin: 'upload'};
  const adopted = {filename: 'complex.cif', text: 'data_complex', origin: 'job', job: 'job-1', digest: 'digest'};
  const {rerender} = render(<MolecularViewer source={upload} scene={null} defaults={{}} stage="queued"/>);
  const context = await readyContext();
  const {PluginCommands} = await import('molstar/lib/mol-plugin/commands');
  expect(context.clear).toHaveBeenCalledTimes(1);
  expect(context.builders.data.rawData).toHaveBeenCalledTimes(1);
  expect(context.builders.structure.parseTrajectory).toHaveBeenCalledTimes(1);
  expect(PluginCommands.Camera.Reset).toHaveBeenCalledTimes(1);

  rerender(<MolecularViewer source={adopted} scene={null} defaults={{}} stage="render complete"/>);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('render complete'));
  expect(context.clear).toHaveBeenCalledTimes(1);
  expect(context.builders.data.rawData).toHaveBeenCalledTimes(1);
  expect(context.builders.structure.parseTrajectory).toHaveBeenCalledTimes(1);
  expect(PluginCommands.Camera.Reset).toHaveBeenCalledTimes(1);
  expect(PluginCommands.Camera.SetSnapshot).not.toHaveBeenCalled();
});

test('stale contact overlay work cannot add an obsolete representation', async () => {
  const source = {filename: 'complex.cif', text: 'data_complex'};
  const provisional = {state: 'provisional', contacts: [{antibody_residue: 'A:1', antigen_residue: 'C:1'}]};
  const verified = {state: 'verified', contacts: [{antibody_residue: 'B:2', antigen_residue: 'C:2'}]};
  const {rerender} = render(<MolecularViewer source={source} scene={null} defaults={{}} stage="queued"/>);
  const context = await readyContext();
  let releaseFirst;
  let first = true;
  context.builders.structure.tryCreateComponentFromExpression.mockImplementation(async () => {
    if (first) {
      first = false;
      return new Promise(resolve => { releaseFirst = () => resolve({ref: 'contacts-stale'}); });
    }
    return {ref: 'contacts-current'};
  });

  rerender(<MolecularViewer source={source} scene={provisional} defaults={{}} stage="contacts ready"/>);
  await waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
  rerender(<MolecularViewer source={source} scene={verified} defaults={{}} stage="render complete"/>);
  await act(async () => releaseFirst());
  await screen.findByText(/2 contact residues highlighted from verified contacts \(render finished\); coordinates unchanged/);

  const contactRepresentations = context.builders.structure.representation.addRepresentation.mock.calls.filter(([component]) => String(component?.ref || '').startsWith('contacts'));
  const {PluginCommands} = await import('molstar/lib/mol-plugin/commands');
  expect(contactRepresentations).toHaveLength(1);
  expect(contactRepresentations[0][0].ref).toBe('contacts-current');
  expect(PluginCommands.State.RemoveObject).toHaveBeenCalledWith(context, {state: context.state.data, ref: 'contacts-stale', removeParentGhosts: true});
  expect(screen.getByRole('status')).not.toHaveTextContent('provisional contacts');
});

test('the viewer assembly is applied on Enter or blur, not on every keystroke', async () => {
  const userEvent = (await import('@testing-library/user-event')).default;
  const user = userEvent.setup();
  render(<MolecularViewer source={{filename: 'complex.cif', text: 'data_complex'}} scene={null} defaults={{}} stage=""/>);
  const context = await readyContext();
  expect(context.builders.structure.createStructure).toHaveBeenCalledTimes(1);
  const input = screen.getByLabelText('Viewer assembly (press Enter to apply)');
  await user.clear(input);
  await user.type(input, '12');
  expect(context.builders.structure.createStructure).toHaveBeenCalledTimes(1);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(context.builders.structure.createStructure).toHaveBeenCalledTimes(2));
  expect(context.builders.structure.createStructure).toHaveBeenLastCalledWith({ref: 'model'}, {name: 'assembly', params: {id: '12'}});
  // An emptied field falls back to the asymmetric unit when it loses focus.
  await user.clear(input);
  await user.tab();
  await waitFor(() => expect(context.builders.structure.createStructure).toHaveBeenCalledTimes(3));
  expect(context.builders.structure.createStructure).toHaveBeenLastCalledWith({ref: 'model'}, {name: 'model', params: {}});
  expect(input).toHaveValue('asymmetric_unit');
});
