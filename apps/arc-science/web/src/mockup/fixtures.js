// S0 prototype data. Example material only: a plausible antibody engineering mission
// around PDB 1DQJ (HyHEL-63 Fab with hen lysozyme). Nothing here is a real result.
// Every human-readable string lives in strings.en.js / strings.ru.js under the key
// named here; ids, PDB codes, residue numbers and numbers stay as data.

export const MISSIONS = [
  {id: 'm1', key: 'mk.m1', round: [3, 6], claims: 4, sources: 18, state: 'active'},
  {id: 'm2', key: 'mk.m2', round: [1, 4], claims: 2, sources: 6, state: 'paused'},
  {id: 'm3', key: 'mk.m3', round: [6, 6], claims: 7, sources: 31, state: 'done'},
];

// No operation has been started, so the header never claims a running mission.
export const MISSION = {...MISSIONS[0], startedOperation: null};

export const OVERVIEW = [
  {id: 'believe', key: 'mk.overview.believe', items: ['mk.overview.believe.1', 'mk.overview.believe.2', 'mk.overview.believe.3']},
  {id: 'change', key: 'mk.overview.change', items: ['mk.overview.change.1', 'mk.overview.change.2', 'mk.overview.change.3']},
  {id: 'next', key: 'mk.overview.next', items: ['mk.overview.next.1', 'mk.overview.next.2', 'mk.overview.next.3']},
];

export const LANES = ['focused', 'warm', 'parked'];

export const ROUTES = [
  {id: 'r1', lane: 'focused', key: 'mk.route.r1', density: 4},
  {id: 'r2', lane: 'focused', key: 'mk.route.r2', density: 2},
  {id: 'r3', lane: 'warm', key: 'mk.route.r3', density: 2},
  {id: 'r4', lane: 'warm', key: 'mk.route.r4', density: 1},
  {id: 'r5', lane: 'parked', key: 'mk.route.r5', density: 1},
];

export const LADDER = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

export const CLAIMS = [
  {id: 'c1', key: 'mk.claim.c1', rung: 3, verdict: 'qualified', density: 3},
  {id: 'c2', key: 'mk.claim.c2', rung: 1, verdict: 'revised', density: 1},
  {id: 'c3', key: 'mk.claim.c3', rung: 5, verdict: 'accepted', density: 5},
  {id: 'c4', key: 'mk.claim.c4', rung: 2, verdict: 'deferred', density: 2},
];

export const EVIDENCE = [
  {id: 'e1', key: 'mk.evidence.e1', claim: 'c1', density: 4, recorded: '2026-09-18'},
  {id: 'e2', key: 'mk.evidence.e2', claim: 'c1', density: 3, recorded: '2026-09-19'},
  {id: 'e3', key: 'mk.evidence.e3', claim: 'c3', density: 5, recorded: '2026-09-21'},
  {id: 'e4', key: 'mk.evidence.e4', claim: 'c2', density: 1, recorded: '2026-09-22'},
  {id: 'e5', key: 'mk.evidence.e5', claim: 'c4', density: 2, recorded: '2026-09-24'},
];

export const ACTIVITY = [
  {id: 'a1', key: 'mk.activity.a1', derived: false},
  {id: 'a2', key: 'mk.activity.a2', derived: false},
  {id: 'a3', key: 'mk.activity.a3', derived: true},
  {id: 'a4', key: 'mk.activity.a4', derived: false},
  {id: 'a5', key: 'mk.activity.a5', derived: true},
  {id: 'a6', key: 'mk.activity.a6', derived: false},
];

export const APPROVAL = {
  id: 'ap1',
  key: 'mk.approval.ap1',
  waiting: 2,
  checks: [
    {id: 'k1', key: 'mk.approval.check.k1', state: 'ready', blocking: false},
    {id: 'k2', key: 'mk.approval.check.k2', state: 'failed', blocking: true},
    {id: 'k3', key: 'mk.approval.check.k3', state: 'not_tested', blocking: false},
  ],
};

export const RELEASE = {
  claims: [
    {id: 'c1', key: 'mk.claim.c1', required: 4, reached: 3},
    {id: 'c2', key: 'mk.claim.c2', required: 3, reached: 1},
    {id: 'c3', key: 'mk.claim.c3', required: 4, reached: 5},
    {id: 'c4', key: 'mk.claim.c4', required: 3, reached: 2},
  ],
};

export const PROVIDERS = [
  {id: 'anthropic', label: 'Anthropic', models: ['claude-opus-4-6', 'claude-sonnet-4-6']},
  {id: 'openai', label: 'OpenAI', models: ['gpt-5.6', 'gpt-5.6-mini']},
  {id: 'local', label: 'Ollama', models: ['qwen3-32b', 'llama4-scout']},
];

export const EFFORTS = ['low', 'medium', 'high'];

export const SEATS = [
  {id: 'planner', key: 'mk.seat.planner', provider: 'anthropic', model: 'claude-opus-4-6', effort: 'high', credential: 'ready'},
  {id: 'reviewer', key: 'mk.seat.reviewer', provider: 'openai', model: 'gpt-5.6', effort: 'high', credential: 'ready'},
  {id: 'falsifier', key: 'mk.seat.falsifier', provider: 'anthropic', model: 'claude-sonnet-4-6', effort: 'medium', credential: 'ready'},
  {id: 'vision', key: 'mk.seat.vision', provider: 'openai', model: 'gpt-5.6-mini', effort: 'low', credential: 'missing'},
  {id: 'prose', key: 'mk.seat.prose', provider: 'local', model: 'qwen3-32b', effort: 'medium', credential: 'ready'},
];

export const CONNECTORS = [
  {id: 'pdb', key: 'mk.connector.pdb', licence: 'CC0-1.0', state: 'ready'},
  {id: 'uniprot', key: 'mk.connector.uniprot', licence: 'CC-BY-4.0', state: 'ready'},
  {id: 'pubmed', key: 'mk.connector.pubmed', licence: 'Public domain', state: 'ready'},
  {id: 'alphafold', key: 'mk.connector.alphafold', licence: 'CC-BY-4.0', state: 'not_tested'},
  {id: 'sabdab', key: 'mk.connector.sabdab', licence: 'Academic', state: 'blocked'},
  {id: 'openmm', key: 'mk.connector.openmm', licence: 'MIT', state: 'ready'},
];

export const PROBE = [
  {id: 'p1', key: 'mk.connector.probe.p1', state: 'ready'},
  {id: 'p2', key: 'mk.connector.probe.p2', state: 'ready'},
  {id: 'p3', key: 'mk.connector.probe.p3', state: 'not_tested'},
];

export const PROPOSALS = [
  {id: 'g1', key: 'mk.configure.g1'},
  {id: 'g2', key: 'mk.configure.g2'},
  {id: 'g3', key: 'mk.configure.g3'},
];

export const DIAGNOSTICS = [
  {id: 'd1', key: 'mk.diag.d1', state: 'ready'},
  {id: 'd2', key: 'mk.diag.d2', state: 'ready'},
  {id: 'd3', key: 'mk.diag.d3', state: 'not_tested'},
  {id: 'd4', key: 'mk.diag.d4', state: 'failed'},
  {id: 'd5', key: 'mk.diag.d5', state: 'blocked'},
  {id: 'd6', key: 'mk.diag.d6', state: 'unknown'},
];

export const LATEX_FILES = [
  {id: 'f1', name: 'main.tex', key: 'mk.latex.f1'},
  {id: 'f2', name: 'sections/contact-site.tex', key: 'mk.latex.f2'},
  {id: 'f3', name: 'sections/allosteric-groove.tex', key: 'mk.latex.f3'},
  {id: 'f4', name: 'figures/ladder.tex', key: 'mk.latex.f4'},
  {id: 'f5', name: 'refs.bib', key: 'mk.latex.f5'},
];

// A short, inert sample so the editor pane shows real LaTeX shape, not lorem ipsum.
export const LATEX_SOURCE = [
  '\\section{Contact site}',
  '% charge swap, round 3',
  'The Fab of 1DQJ buries \\SI{780}{\\angstrom\\squared} at the',
  'contact site, so a charged residue swap is measured against',
  'the wild-type interface rather than against a model.',
  '',
  '\\begin{equation}',
  '  \\Delta\\Delta G = \\Delta G_{\\text{mut}} - \\Delta G_{\\text{wt}}',
  '\\end{equation}',
].join('\n');

export const LAYOUT_FONTS = [
  {id: 'hse', label: 'HSE Sans', stack: '"HSE Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'},
  {id: 'mono', label: 'Cascadia Mono', stack: '"Cascadia Mono", ui-monospace, Consolas, monospace'},
  {id: 'system', label: 'Segoe UI', stack: '"Segoe UI", system-ui, sans-serif'},
];
