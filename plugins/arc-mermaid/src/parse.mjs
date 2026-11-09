/**
 * Mermaid parser for the subset arc-mermaid draws: flowchart / graph, stateDiagram(-v2) and sequenceDiagram.
 * Pure functions, no DOM. Every unsupported diagram type returns { type: 'unsupported', kind }.
 * A malformed line throws ParseError with its line number, so the caller can leave the code block untouched.
 */

export class ParseError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
  }
}

const WORD = '[\\w\\u00C0-\\uFFFF]';
const ID_RE = new RegExp(`^${WORD}+(?:-(?=${WORD})${WORD}+)*`);

/** Text of a label: quotes, markdown fences, line breaks, entities and simple tags. */
export function cleanLabel(raw) {
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) s = s.slice(1, -1);
  if (s.startsWith('`') && s.endsWith('`') && s.length >= 2) s = s.slice(1, -1);
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n');
  s = s.replace(/<\/?(?:b|i|u|s|em|strong|small|code|span|p|div)(?:\s[^>]*)?>/gi, '');
  s = s.replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/#(quot|amp|lt|gt|nbsp);/g, (_, n) => ({ quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' }[n]));
  s = s.replace(/&(quot|amp|lt|gt|nbsp);/g, (_, n) => ({ quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' }[n]));
  return s.split('\n').map((l) => l.trim()).join('\n').trim();
}

function stripFrontMatter(lines) {
  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      const title = lines.slice(1, end).map((l) => /^\s*title\s*:\s*(.+)$/.exec(l)).find(Boolean);
      return { rest: lines.slice(end + 1), skipped: end + 1, title: title ? cleanLabel(title[1]) : null };
    }
  }
  return { rest: lines, skipped: 0, title: null };
}

/** Diagram kind and the numbered lines that hold the body. */
export function detect(source) {
  const all = String(source).replace(/\r\n?/g, '\n').split('\n');
  const fm = stripFrontMatter(all);
  let first = null;
  const body = [];
  fm.rest.forEach((text, i) => {
    const n = fm.skipped + i + 1;
    if (/^\s*%%\{.*\}%%\s*$/.test(text)) return;
    const t = text.replace(/%%(?!\{).*$/, '');
    if (first === null) {
      if (t.trim() === '') return;
      first = { text: t.trim(), n };
      return;
    }
    body.push({ text: t, n });
  });
  if (first === null) return { kind: 'empty', first: null, body, title: fm.title };
  const m = /^([A-Za-z][\w-]*)/.exec(first.text);
  return { kind: m ? m[1] : 'unknown', first, body, title: fm.title };
}

export function parse(source) {
  const d = detect(source);
  if (d.kind === 'graph' || d.kind === 'flowchart' || d.kind === 'flowchart-elk') return parseFlow(d);
  if (d.kind === 'stateDiagram' || d.kind === 'stateDiagram-v2') return parseState(d);
  if (d.kind === 'sequenceDiagram') return parseSequence(d);
  return { type: 'unsupported', kind: d.kind };
}

// ---------------------------------------------------------------------------------------------
// Shared helpers

const DIRS = { TB: 'TB', TD: 'TB', BT: 'BT', LR: 'LR', RL: 'RL' };

function splitStatements(body) {
  const out = [];
  for (const { text, n } of body) {
    // A semicolon ends a statement unless it sits inside quotes or brackets.
    let depth = 0, q = null, cur = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === q) q = null; cur += ch; continue; }
      if (ch === '"') { q = ch; cur += ch; continue; }
      if (ch === '[' || ch === '(' || ch === '{') depth++;
      if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { if (cur.trim()) out.push({ text: cur.trim(), n }); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push({ text: cur.trim(), n });
  }
  return out;
}

function newModel(type, dir) {
  return { type, dir, nodes: new Map(), edges: [], groups: [], classDefs: {}, title: null };
}

function addNode(model, ctx, id, patch = {}) {
  let n = model.nodes.get(id);
  if (!n) {
    n = { id, label: id, shape: 'rect', classes: [], style: {}, explicit: false };
    model.nodes.set(id, n);
  }
  if (patch.label !== undefined) { n.label = patch.label; n.explicit = true; }
  if (patch.shape) n.shape = patch.shape;
  if (patch.classes) for (const c of patch.classes) if (!n.classes.includes(c)) n.classes.push(c);
  const g = ctx.groupStack[ctx.groupStack.length - 1];
  if (g && !ctx.owner.has(id) && !model.groups.some((x) => x.id === id)) {
    ctx.owner.set(id, g.id);
    g.members.push(id);
  }
  return n;
}

function parseStyleList(s) {
  const out = {};
  for (const part of s.split(',')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Flowchart

const SHAPE_OPENS = [
  ['(((', [[')))', 'doublecircle']]],
  ['((', [['))', 'circle']]],
  ['([', [['])', 'stadium']]],
  ['[(', [[')]', 'cylinder']]],
  ['[[', [[']]', 'subroutine']]],
  ['{{', [['}}', 'hexagon']]],
  ['[/', [['/]', 'parallelogram'], ['\\]', 'trapezoid']]],
  ['[\\', [['\\]', 'parallelogramAlt'], ['/]', 'trapezoidAlt']]],
  ['[', [[']', 'rect']]],
  ['(', [[')', 'round']]],
  ['{', [['}', 'diamond']]],
  ['>', [[']', 'asym']]],
];

const OPENS = [...SHAPE_OPENS].sort((a, b) => b[0].length - a[0].length);

const AT_SHAPES = {
  rect: 'rect', rounded: 'round', stadium: 'stadium', diamond: 'diamond', decision: 'diamond', circle: 'circle', 'sm-circ': 'circle',
  'dbl-circ': 'doublecircle', hex: 'hexagon', hexagon: 'hexagon', cyl: 'cylinder', cylinder: 'cylinder', 'fr-rect': 'subroutine', subproc: 'subroutine',
  'lean-r': 'parallelogram', 'lean-l': 'parallelogramAlt', trap: 'trapezoid', 'trap-b': 'trapezoid', 'trap-t': 'trapezoidAlt', odd: 'asym',
};

function findClose(s, from, closes) {
  let q = null;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"') { q = ch; continue; }
    for (const [c, shape] of closes) if (s.startsWith(c, i)) return { idx: i, close: c, shape };
  }
  return null;
}

function parseNodeSpec(s, pos, line) {
  const m = ID_RE.exec(s.slice(pos));
  if (!m) throw new ParseError(`expected a node name near "${s.slice(pos, pos + 12)}"`, line);
  const id = m[0];
  let p = pos + id.length;
  const res = { id, p, label: undefined, shape: undefined, classes: [] };
  const rest = s.slice(p);
  if (rest.startsWith('@{')) {
    const end = rest.indexOf('}');
    if (end < 0) throw new ParseError('unclosed @{ }', line);
    const body = rest.slice(2, end);
    for (const kv of body.split(',')) {
      const i = kv.indexOf(':');
      if (i < 0) continue;
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k === 'shape') res.shape = AT_SHAPES[v] || 'rect';
      if (k === 'label') res.label = cleanLabel(v);
    }
    p += end + 1;
  } else {
    for (const [open, closes] of OPENS) {
      if (!rest.startsWith(open)) continue;
      const hit = findClose(s, p + open.length, closes);
      if (!hit) continue;
      res.label = cleanLabel(s.slice(p + open.length, hit.idx));
      res.shape = hit.shape;
      p = hit.idx + hit.close.length;
      break;
    }
  }
  while (s.startsWith(':::', p)) {
    const cm = /^:::([\w-]+)/.exec(s.slice(p));
    if (!cm) break;
    res.classes.push(cm[1]);
    p += cm[0].length;
  }
  res.p = p;
  return res;
}

/** One link at s[pos]: { kind, head, tail, label, minlen, p } or null. */
function parseLink(s, pos) {
  const r = s.slice(pos);
  let m;
  // Link with its text inside: A -- text --> B, A == text ==> B, A -. text .-> B
  m = /^(<)?(--|==|-\.)\s+(.+?)\s+(-{2,}[>xo]?|={2,}>?|\.+-[>xo]?)(?=\s|$|[\w\u00C0-\uFFFF"'`&])/.exec(r);
  if (m && !/^(--|==|-\.)[>xo\-=.]/.test(r.slice(0, 3))) {
    const close = m[4];
    const kind = m[2] === '==' ? 'thick' : m[2] === '-.' ? 'dotted' : 'normal';
    const head = /[>]$/.test(close) ? 'arrow' : /x$/.test(close) ? 'cross' : /o$/.test(close) ? 'circle' : 'none';
    return { kind, head, tail: m[1] ? 'arrow' : 'none', label: cleanLabel(m[3]), minlen: 1, p: pos + m[0].length };
  }
  const simple = [
    [/^(<)?-(\.+)-(>|x|o)?/, 'dotted'],
    [/^(<)?(={2,})(>|x|o)?/, 'thick'],
    [/^(<|x|o)?(-{2,})(>|x|o)?/, 'normal'],
    [/^(~{3,})/, 'invisible'],
  ];
  for (const [re, kind] of simple) {
    m = re.exec(r);
    if (!m) continue;
    if (kind === 'invisible') return { kind, head: 'none', tail: 'none', label: '', minlen: 1, p: pos + m[0].length };
    let tail = m[1] ? 'arrow' : 'none', head = m[3] || 'none';
    if (m[1] === 'x' || m[1] === 'o') { tail = m[1] === 'x' ? 'cross' : 'circle'; }
    // A trailing x or o is an arrow head only when no name follows it.
    if ((head === 'x' || head === 'o') && /^[\w\u00C0-\uFFFF]/.test(r.slice(m[0].length))) head = 'none', m[0] = m[0].slice(0, -1);
    const headKind = head === '>' ? 'arrow' : head === 'x' ? 'cross' : head === 'o' ? 'circle' : 'none';
    let label = '';
    let end = pos + m[0].length;
    const lm = /^\s*\|([^|]*)\|/.exec(s.slice(end));
    if (lm) { label = cleanLabel(lm[1]); end += lm[0].length; }
    const dashes = m[2] ? m[2].length : 2;
    return { kind, head: headKind, tail, label, minlen: kind === 'dotted' ? 1 : Math.max(1, dashes - (headKind === 'none' ? 2 : 1)), p: end };
  }
  return null;
}

function parseFlowStatements(model, ctx, stmts) {
  for (const { text, n } of stmts) {
    let m;
    if ((m = /^subgraph\s+(.*)$/i.exec(text))) {
      const rest = m[1].trim();
      let id, label;
      const b = /^([\w\u00C0-\uFFFF-]+)\s*\[(.*)\]\s*$/.exec(rest);
      if (b) { id = b[1]; label = cleanLabel(b[2]); } else { label = cleanLabel(rest); id = label.replace(/\s+/g, '_'); }
      const parent = ctx.groupStack[ctx.groupStack.length - 1];
      const g = { id, label, parent: parent ? parent.id : null, members: [], dir: null };
      model.groups.push(g);
      ctx.groupStack.push(g);
      continue;
    }
    if (/^end$/i.test(text)) {
      if (!ctx.groupStack.length) throw new ParseError('"end" without subgraph', n);
      ctx.groupStack.pop();
      continue;
    }
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text))) {
      const g = ctx.groupStack[ctx.groupStack.length - 1];
      if (g) g.dir = DIRS[m[1].toUpperCase()];
      continue;
    }
    if ((m = /^classDef\s+([\w\s,-]+?)\s+(\S.*)$/.exec(text))) {
      const st = parseStyleList(m[2].replace(/;$/, ''));
      for (const name of m[1].split(',')) model.classDefs[name.trim()] = { ...(model.classDefs[name.trim()] || {}), ...st };
      continue;
    }
    if ((m = /^class\s+([\w\u00C0-\uFFFF,\s-]+?)\s+([\w-]+)$/.exec(text))) {
      for (const id of m[1].split(',')) addNode(model, ctx, id.trim(), { classes: [m[2]] });
      continue;
    }
    if ((m = /^style\s+([\w\u00C0-\uFFFF-]+)\s+(.+)$/.exec(text))) {
      const node = addNode(model, ctx, m[1]);
      Object.assign(node.style, parseStyleList(m[2]));
      continue;
    }
    if (/^(linkStyle|click|accTitle|accDescr|title)\b/.test(text)) continue;

    // node and link chain
    let pos = 0, prev = null, link = null;
    for (;;) {
      const group = [];
      for (;;) {
        while (text[pos] === ' ') pos++;
        const spec = parseNodeSpec(text, pos, n);
        pos = spec.p;
        addNode(model, ctx, spec.id, { label: spec.label, shape: spec.shape, classes: spec.classes });
        group.push(spec.id);
        while (text[pos] === ' ') pos++;
        if (text[pos] === '&') { pos++; continue; }
        break;
      }
      if (prev) {
        for (const a of prev) for (const b of group) model.edges.push({ from: a, to: b, kind: link.kind, head: link.head, tail: link.tail, label: link.label, minlen: link.minlen, line: n });
      }
      while (text[pos] === ' ') pos++;
      if (pos >= text.length) break;
      link = parseLink(text, pos);
      if (!link) throw new ParseError(`unexpected text "${text.slice(pos, pos + 14)}"`, n);
      pos = link.p;
      prev = group;
    }
  }
  if (ctx.groupStack.length) throw new ParseError('subgraph without "end"', stmts.length ? stmts[stmts.length - 1].n : 1);
}

function resolveGroupEndpoints(model) {
  const byId = new Map(model.groups.map((g) => [g.id, g]));
  const nodesOf = (g, seen = new Set()) => {
    if (seen.has(g.id)) return [];
    seen.add(g.id);
    const direct = g.members.filter((m) => model.nodes.has(m) && !byId.has(m));
    const kids = model.groups.filter((c) => c.parent === g.id).flatMap((c) => nodesOf(c, seen));
    return [...direct, ...kids];
  };
  const isMark = (id) => { const s = model.nodes.get(id) && model.nodes.get(id).shape; return s === 'startmark' || s === 'endmark'; };
  // An edge that names a subgraph or composite state meets it at an inner node: it enters at the first node
  // that nothing inside feeds, and it leaves from the last node that feeds nothing inside. Start and end marks are skipped.
  const entry = (g) => {
    const all = nodesOf(g), set = new Set(all);
    const inside = model.edges.filter((e) => set.has(e.from) && set.has(e.to));
    let pick = all.filter((n) => !inside.some((e) => e.to === n))[0];
    if (pick === undefined) pick = all[0];
    if (pick !== undefined && isMark(pick)) { const nxt = inside.find((e) => e.from === pick); if (nxt) pick = nxt.to; }
    return pick;
  };
  const exit = (g) => {
    const all = nodesOf(g), set = new Set(all);
    const inside = model.edges.filter((e) => set.has(e.from) && set.has(e.to));
    const sinks = all.filter((n) => !inside.some((e) => e.from === n));
    let pick = sinks.length ? sinks[sinks.length - 1] : all[all.length - 1];
    if (pick !== undefined && isMark(pick)) { const prv = inside.find((e) => e.to === pick); if (prv) pick = prv.from; }
    return pick;
  };
  // A node named like a subgraph is the subgraph.
  for (const e of model.edges) {
    const gf = byId.get(e.from), gt = byId.get(e.to);
    if (gf && model.nodes.has(e.from) && !model.nodes.get(e.from).explicit) { const x = exit(gf); if (x !== undefined) e.from = x; }
    if (gt && model.nodes.has(e.to) && !model.nodes.get(e.to).explicit) { const x = entry(gt); if (x !== undefined) e.to = x; }
  }
  for (const g of model.groups) {
    if (model.nodes.has(g.id) && !model.nodes.get(g.id).explicit && !model.edges.some((e) => e.from === g.id || e.to === g.id)) model.nodes.delete(g.id);
    const i = g.members.indexOf(g.id);
    if (i >= 0 && !model.nodes.has(g.id)) g.members.splice(i, 1);
  }
  for (const g of model.groups) g.members = g.members.filter((m) => model.nodes.has(m));
}
function parseFlow(d) {
  const dm = /^(?:graph|flowchart(?:-elk)?)\s*(TB|TD|BT|LR|RL)?\s*;?$/i.exec(d.first.text);
  if (!dm) throw new ParseError(`unknown flowchart header "${d.first.text}"`, d.first.n);
  const model = newModel('flow', DIRS[(dm[1] || 'TB').toUpperCase()]);
  model.title = d.title;
  const ctx = { groupStack: [], owner: new Map() };
  parseFlowStatements(model, ctx, splitStatements(d.body));
  resolveGroupEndpoints(model);
  return model;
}

// ---------------------------------------------------------------------------------------------
// State diagram (drawn by the flowchart engine)

function parseState(d) {
  const model = newModel('flow', 'TB');
  model.title = d.title;
  model.isState = true;
  const ctx = { groupStack: [], owner: new Map() };
  const scope = () => (ctx.groupStack.length ? ctx.groupStack[ctx.groupStack.length - 1].id : '');
  const stateNode = (raw, role, n) => {
    const name = raw.trim();
    if (name === '[*]') {
      const key = role === 'from' ? `__start_${scope()}` : `__end_${scope()}`;
      if (!model.nodes.has(key)) addNode(model, ctx, key, { label: '', shape: role === 'from' ? 'startmark' : 'endmark' });
      return key;
    }
    const m = /^([\w\u00C0-\uFFFF-]+)(?:\s*<<(choice|fork|join)>>)?$/.exec(name);
    if (!m) throw new ParseError(`bad state name "${name}"`, n);
    const node = addNode(model, ctx, m[1], { shape: m[2] === 'choice' ? 'diamond' : m[2] ? 'bar' : 'round' });
    if (m[2] === 'choice') node.label = '';
    return m[1];
  };
  const dm = /^stateDiagram(?:-v2)?\s*$/.exec(d.first.text);
  if (!dm) throw new ParseError('unknown state diagram header', d.first.n);
  for (const { text, n } of splitStatements(d.body)) {
    let m;
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text))) {
      if (ctx.groupStack.length) ctx.groupStack[ctx.groupStack.length - 1].dir = DIRS[m[1].toUpperCase()];
      else model.dir = DIRS[m[1].toUpperCase()];
      continue;
    }
    if ((m = /^state\s+"([^"]*)"\s+as\s+([\w\u00C0-\uFFFF-]+)$/.exec(text))) { addNode(model, ctx, m[2], { label: cleanLabel(m[1]), shape: 'round' }); continue; }
    if ((m = /^state\s+([\w\u00C0-\uFFFF-]+)\s*\{$/.exec(text)) || (m = /^state\s+"([^"]*)"\s+as\s+([\w\u00C0-\uFFFF-]+)\s*\{$/.exec(text))) {
      const id = m[2] || m[1];
      const parent = ctx.groupStack[ctx.groupStack.length - 1];
      const g = { id, label: m[2] ? cleanLabel(m[1]) : id, parent: parent ? parent.id : null, members: [], dir: null };
      model.groups.push(g);
      ctx.groupStack.push(g);
      continue;
    }
    if ((m = /^state\s+([\w\u00C0-\uFFFF-]+)\s+<<(choice|fork|join)>>$/.exec(text))) { addNode(model, ctx, m[1], { label: m[2] === 'choice' ? '' : '', shape: m[2] === 'choice' ? 'diamond' : 'bar' }); continue; }
    if (text === '}') { if (!ctx.groupStack.length) throw new ParseError('"}" without state block', n); ctx.groupStack.pop(); continue; }
    if (/^(note\b|end note|classDef|class\b|style\b|accTitle|accDescr|title)/i.test(text)) continue;
    if ((m = /^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.*))?$/.exec(text))) {
      const a = stateNode(m[1], 'from', n);
      const b = stateNode(m[2], 'to', n);
      model.edges.push({ from: a, to: b, kind: 'normal', head: 'arrow', tail: 'none', label: m[3] ? cleanLabel(m[3]) : '', minlen: 1, line: n });
      continue;
    }
    if ((m = /^([\w\u00C0-\uFFFF-]+)\s*:\s*(.+)$/.exec(text))) {
      const node = addNode(model, ctx, m[1], { shape: 'round' });
      node.label = node.explicit ? `${node.label}\n${cleanLabel(m[2])}` : cleanLabel(m[2]);
      node.explicit = true;
      continue;
    }
    if (/^[\w\u00C0-\uFFFF-]+$/.test(text)) { addNode(model, ctx, text, { shape: 'round' }); continue; }
    throw new ParseError(`cannot read "${text}"`, n);
  }
  if (ctx.groupStack.length) throw new ParseError('state block without "}"', d.body.length ? d.body[d.body.length - 1].n : 1);
  resolveGroupEndpoints(model);
  return model;
}

// ---------------------------------------------------------------------------------------------
// Sequence diagram

const ARROWS = [
  ['-->>', { dash: true, head: 'arrow' }], ['->>', { dash: false, head: 'arrow' }],
  ['--x', { dash: true, head: 'cross' }], ['-x', { dash: false, head: 'cross' }],
  ['--)', { dash: true, head: 'open' }], ['-)', { dash: false, head: 'open' }],
  ['-->', { dash: true, head: 'line' }], ['->', { dash: false, head: 'line' }],
];

function parseSequence(d) {
  const model = { type: 'sequence', participants: [], items: [], title: d.title, autonumber: false };
  const byId = new Map();
  const part = (id, label, kind) => {
    let p = byId.get(id);
    if (!p) { p = { id, label: id, kind: 'participant' }; byId.set(id, p); model.participants.push(p); }
    if (label !== undefined && label !== null) p.label = label;
    if (kind) p.kind = kind;
    return p;
  };
  const stack = [];
  for (const { text, n } of splitStatements(d.body)) {
    let m;
    if ((m = /^(participant|actor)\s+([\w\u00C0-\uFFFF.-]+)(?:\s+as\s+(.+))?$/.exec(text))) { part(m[2], m[3] ? cleanLabel(m[3]) : undefined, m[1]); continue; }
    if (/^autonumber\b/.test(text)) { model.autonumber = true; continue; }
    if ((m = /^title\s*:?\s*(.+)$/.exec(text))) { model.title = cleanLabel(m[1]); continue; }
    if (/^(box\b|end box|links?\b|link\b|properties\b|details\b|create\b|destroy\b|rect\b)/.test(text)) {
      if (/^rect\b/.test(text)) stack.push({ kind: 'rect' });
      continue;
    }
    if ((m = /^(loop|alt|opt|par|critical|break)\b\s*(.*)$/.exec(text))) {
      stack.push({ kind: m[1] });
      model.items.push({ t: 'open', kind: m[1], label: cleanLabel(m[2] || ''), line: n });
      continue;
    }
    if ((m = /^(else|and|option)\b\s*(.*)$/.exec(text))) {
      if (!stack.length) throw new ParseError(`"${m[1]}" outside a block`, n);
      model.items.push({ t: 'divider', label: cleanLabel(m[2] || ''), line: n });
      continue;
    }
    if (text === 'end') {
      const top = stack.pop();
      if (!top) throw new ParseError('"end" without a block', n);
      if (top.kind !== 'rect') model.items.push({ t: 'close', line: n });
      continue;
    }
    if ((m = /^(activate|deactivate)\s+([\w\u00C0-\uFFFF.-]+)$/.exec(text))) {
      part(m[2]);
      model.items.push({ t: m[1], who: m[2], line: n });
      continue;
    }
    if ((m = /^note\s+(over|left of|right of)\s+([\w\u00C0-\uFFFF.-]+)(?:\s*,\s*([\w\u00C0-\uFFFF.-]+))?\s*:\s*(.*)$/i.exec(text))) {
      part(m[2]);
      if (m[3]) part(m[3]);
      model.items.push({ t: 'note', where: m[1].toLowerCase(), a: m[2], b: m[3] || null, label: cleanLabel(m[4]), line: n });
      continue;
    }
    // message: A->>B: text, with optional + or - on the receiver
    const mm = /^([\w\u00C0-\uFFFF.-]+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([\w\u00C0-\uFFFF.-]+)\s*:\s*(.*)$/.exec(text);
    if (mm) {
      const spec = ARROWS.find(([a]) => a === mm[2])[1];
      part(mm[1]);
      part(mm[4]);
      model.items.push({ t: 'msg', from: mm[1], to: mm[4], dash: spec.dash, head: spec.head, label: cleanLabel(mm[5]), line: n });
      if (mm[3] === '+') model.items.push({ t: 'activate', who: mm[4], line: n });
      if (mm[3] === '-') model.items.push({ t: 'deactivate', who: mm[1], line: n });
      continue;
    }
    throw new ParseError(`cannot read "${text}"`, n);
  }
  if (stack.length) throw new ParseError('block without "end"', d.body.length ? d.body[d.body.length - 1].n : 1);
  if (!model.participants.length) throw new ParseError('sequence diagram without participants', d.first.n);
  return model;
}

