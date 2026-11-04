// Helpers for the throwaway data homes of the live tests (test/no-deepseek-net.mjs, test/ui-crawl.mjs).
//   quietConfig(text)   the copy of a profile's cordis.patch.yml that a test may start: no MCP client starts, no saved theme
//   linkTree(src, dst)  the plugin packages of the home: real folders, hard-linked files (see below)
//   treeHash(dir), treeDiff(before, after)   prove that a run changed no file of the real profile
//   removeHome(dir)     removes a throwaway home without ever following a link
//   node lib/testhome.mjs --selftest
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The data home the kit reads: ARC_HOME, then the first of ~/.arc (made by the first install of the build) and the original ~/.dsh
// that holds profiles. A ~/.arc without profiles (for example only the arc-hoh ledger in hoh/) does not hide the profiles in ~/.dsh,
// the same rule as migrateHome in tools/install.mjs. When neither holds profiles: the first that exists, else ~/.arc.
export function dataHome(env = process.env, home = os.homedir()) {
  const set = env.ARC_HOME?.trim();
  if (set) return set;
  const homes = [path.join(home, '.arc'), path.join(home, '.dsh')];
  return homes.find((d) => fs.existsSync(path.join(d, 'profiles'))) || homes.find((d) => fs.existsSync(d)) || homes[0];
}

const eolOf = (l) => (l.endsWith('\r\n') ? '\r\n' : l.endsWith('\n') ? '\n' : '');
const blank = (l) => /^\s*$/.test(l);

// Works on lines and keeps every line ending. A plugin row is a list item whose first key is "id".
// Its lines run from the "- id:" line to the last non-blank line before the next line that sits at the indent of the dash or less.
//   - rows with an id that starts with mcp-: "disabled: true" (an existing disabled line is set to true, otherwise one is added after the id line)
//   - rows with the id ui-theme: removed, so that each test phase decides the theme itself
export function quietConfig(text) {
  const lines = text.split(/(?<=\n)/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^( *)- +id: *['"]?([^\s'"#]+)['"]?/);
    const id = m && m[2];
    if (!m || (id !== 'ui-theme' && !id.startsWith('mcp-'))) { out.push(line); continue; }
    const dash = m[1].length;
    const keyIndent = line.indexOf('id:'); // column of the row's keys
    let end = i + 1;
    while (end < lines.length && (blank(lines[end]) || lines[end].search(/\S/) > dash)) end++;
    while (end > i + 1 && blank(lines[end - 1])) end--; // blank lines between rows stay
    if (id === 'ui-theme') { i = end - 1; continue; }
    const mine = (j) => new RegExp(`^ {${keyIndent}}disabled:`).test(lines[j]);
    const set = (eol) => ' '.repeat(keyIndent) + 'disabled: true' + eol;
    const has = lines.slice(i + 1, end).some((_, k) => mine(i + 1 + k));
    out.push(eolOf(line) ? line : line + '\n');
    if (!has) out.push(set(eolOf(line) || '\n'));
    for (let j = i + 1; j < end; j++) out.push(mine(j) ? set(eolOf(lines[j])) : lines[j]);
    i = end - 1;
  }
  return out.join('');
}

// The plugin packages of a throwaway home (profiles/<name>/node_modules) are a real folder tree whose files are hard links to the files
// of the real profile. A junction to the real folder is not used: the plugin loader resolves @deepseek-ai/* from the real path of
// the importer, so ten plugins did not activate. A hard link is the same file: a write through it reaches the real file (treeHash
// finds that), while a delete or an atomic rewrite (write a temp file, rename it) leaves the real file alone.
// A link that cannot be made (other volume, link limit) falls back to a copy. A symlink or junction inside the source is not followed;
// it is counted in `skipped`. Returns { dirs, linked, copied, skipped }.
export function linkTree(src, dst) {
  const n = { dirs: 0, linked: 0, copied: 0, skipped: 0 };
  const go = (s, d) => {
    fs.mkdirSync(d, { recursive: true });
    n.dirs++;
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      const a = path.join(s, e.name), b = path.join(d, e.name);
      if (e.isSymbolicLink()) n.skipped++;
      else if (e.isDirectory()) go(a, b);
      else { try { fs.linkSync(a, b); n.linked++; } catch { fs.copyFileSync(a, b); n.copied++; } }
    }
  };
  go(src, dst);
  return n;
}

// sha256 of every file under dir: Map(relative path -> hash). treeDiff names the files that differ between two such maps.
export function treeHash(dir) {
  const m = new Map();
  const go = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p); else if (e.isFile()) m.set(path.relative(dir, p).replace(/\\/g, '/'), crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    }
  };
  go(dir);
  return m;
}
export function treeDiff(before, after) {
  const out = [];
  for (const [f, h] of before) { if (!after.has(f)) out.push('removed ' + f); else if (after.get(f) !== h) out.push('changed ' + f); }
  for (const f of after.keys()) if (!before.has(f)) out.push('added ' + f);
  return out;
}

// Removes a throwaway home entry by entry. A symlink or junction is unlinked itself and never entered, so nothing outside the home can
// be reached; a hard-linked file loses only its link in the home. Only a folder named arc-home-* inside the temp folder qualifies.
// Returns true when the home is gone.
export async function removeHome(home) {
  const abs = path.resolve(home || '');
  if (!/^arc-home-/.test(path.basename(abs)) || path.dirname(abs).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase()) throw new Error('not a throwaway home: ' + home);
  const rm = (p) => {
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } return; }
    if (st.isDirectory()) { for (const e of fs.readdirSync(p)) rm(path.join(p, e)); fs.rmdirSync(p); return; }
    try { fs.unlinkSync(p); } catch { fs.chmodSync(p, 0o666); fs.unlinkSync(p); }
  };
  for (let i = 0; i < 5; i++) {
    try { rm(abs); } catch { /* in use: try again */ }
    if (!fs.existsSync(abs)) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

// ---------- self test ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--selftest')) {
  const assert = (await import('node:assert/strict')).default;
  const sample = [
    '- id: a', '  name: x', '  disabled: false',
    '- insert:', '    - id: mcp-one', '      name: m', '      config:', '        serverName: one',
    '    - id: mcp-two', '      name: m', '      disabled: false  # old', '      config:', '        url: http://127.0.0.1:1/x',
    '    - id: mcp-three', '      name: m',
    '- id: ui-theme', '  name: t', '  config:', '    preference: dark', '',
    '- id: b', '  name: y', '- id: ui-theme', '  config:', '    preference: light', '',
  ];
  const want = [
    '- id: a', '  name: x', '  disabled: false',
    '- insert:', '    - id: mcp-one', '      disabled: true', '      name: m', '      config:', '        serverName: one',
    '    - id: mcp-two', '      name: m', '      disabled: true', '      config:', '        url: http://127.0.0.1:1/x',
    '    - id: mcp-three', '      disabled: true', '      name: m',
    '',
    '- id: b', '  name: y', '',
  ];
  assert.deepEqual(quietConfig(sample.join('\n')).split('\n'), want, 'sample');
  assert.equal(quietConfig(want.join('\n')), want.join('\n'), 'a second pass changes nothing');
  assert.equal(quietConfig(sample.join('\r\n')), want.join('\r\n'), 'CRLF');
  assert.equal(quietConfig('- id: mcp-x\n  name: m'), '- id: mcp-x\n  disabled: true\n  name: m', 'row at the end without a final newline');
  assert.equal(quietConfig('- id: mcp-x'), '- id: mcp-x\n  disabled: true\n', 'bare row');
  assert.equal(quietConfig('- id: mcp-x\n  disabled: false'), '- id: mcp-x\n  disabled: true', 'existing line without a final newline');
  assert.equal(quietConfig('- id: other\n  name: m\n'), '- id: other\n  name: m\n', 'no mcp row, no change');

  // dataHome on a scratch home folder (never the real one)
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-datahome-'));
  try {
    const arc = path.join(fakeHome, '.arc'), dsh = path.join(fakeHome, '.dsh'), none = {};
    assert.equal(dataHome({ ARC_HOME: ' /some/where ' }, fakeHome), '/some/where', 'ARC_HOME wins, trimmed');
    assert.equal(dataHome({ ARC_HOME: '  ' }, fakeHome), arc, 'a blank ARC_HOME counts as unset; nothing there: ~/.arc');
    fs.mkdirSync(dsh);
    assert.equal(dataHome(none, fakeHome), dsh, 'only ~/.dsh exists: ~/.dsh');
    fs.mkdirSync(path.join(arc, 'hoh'), { recursive: true });
    fs.writeFileSync(path.join(arc, 'hoh', 'ledger.jsonl'), '');
    assert.equal(dataHome(none, fakeHome), arc, 'neither has profiles: ~/.arc, as before');
    fs.mkdirSync(path.join(dsh, 'profiles', 'web'), { recursive: true });
    assert.equal(dataHome(none, fakeHome), dsh, 'a ledger-only ~/.arc does not hide the profiles in ~/.dsh');
    assert.equal(dataHome({ ARC_HOME: arc }, fakeHome), arc, 'ARC_HOME still wins over the profiles in ~/.dsh');
    fs.mkdirSync(path.join(arc, 'profiles', 'web'), { recursive: true });
    assert.equal(dataHome(none, fakeHome), arc, 'both have profiles: ~/.arc');
    fs.rmSync(dsh, { recursive: true });
    assert.equal(dataHome(none, fakeHome), arc, 'only ~/.arc has profiles: ~/.arc');
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }

  // the real profile files, read only
  const profiles = path.join(dataHome(), 'profiles');
  let parse = null;
  try { const y = createRequire(path.join(profiles, 'web', 'package.json'))('yaml'); parse = (t) => y.parse(t); } catch { console.log('note: no yaml package found, the structure is compared by lines only'); }
  const mcpRows = (t) => (t.match(/^ *- +id: *['"]?mcp-/gm) || []).length;
  for (const p of ['web', 'desktop']) {
    const file = path.join(profiles, p, 'cordis.patch.yml');
    if (!fs.existsSync(file)) { console.log(`skip ${p}: no file`); continue; }
    const before = fs.readFileSync(file, 'utf8');
    const after = quietConfig(before);
    const a = before.split('\n'), b = after.split('\n');
    const rows = mcpRows(before);
    const themeLines = a.filter((l) => /^ *- +id: *ui-theme/.test(l)).length;
    assert.ok(rows >= 2, `${p}: mcp rows found`);
    assert.equal(mcpRows(after), rows, `${p}: same number of mcp rows`);
    // every line of the result is a line of the original, in order, except the "disabled: true" lines that were added or changed
    let j = 0, changed = 0;
    for (const l of b) {
      const k = a.indexOf(l, j);
      if (k >= 0) { j = k + 1; continue; }
      assert.match(l, /^ +disabled: true$/, `${p}: unexpected new line "${l}"`); changed++;
    }
    assert.ok(changed >= 1 && changed <= rows, `${p}: at most one changed line per mcp row`);
    assert.ok(!/^ *- +id: *ui-theme/m.test(after), `${p}: no ui-theme row left`);
    if (parse) {
      const flat = (t) => parse(t).flatMap((r) => (r && r.insert ? r.insert : [r]));
      const norm = (r) => (String(r.id).startsWith('mcp-') ? { ...r, disabled: true } : r);
      const x = flat(before).filter((r) => r.id !== 'ui-theme').map(norm), y = flat(after);
      assert.ok(y.filter((r) => String(r.id).startsWith('mcp-')).every((r) => r.disabled === true), `${p}: every mcp row is disabled`);
      assert.deepEqual(y, x, `${p}: the parsed rows equal the original rows (mcp rows disabled, ui-theme gone)`);
    }
    console.log(`ok ${p}: ${rows} mcp rows disabled (${changed} lines added), ${themeLines} ui-theme row(s) removed, ${a.length} -> ${b.length} lines${parse ? ', parsed structure equal' : ''}`);
  }
  // linkTree, treeHash, treeDiff and removeHome on a scratch tree (the "real" folder stays outside the throwaway home)
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-real-')), tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-home-'));
  try {
    fs.mkdirSync(path.join(real, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(real, 'a', 'b', 'f.txt'), 'one');
    fs.writeFileSync(path.join(real, 'g.txt'), 'two');
    const nm = path.join(tmpHome, 'profiles', 'web', 'node_modules');
    assert.deepEqual(linkTree(real, nm), { dirs: 3, linked: 2, copied: 0, skipped: 0 }, 'linkTree counts');
    assert.equal(fs.statSync(path.join(nm, 'g.txt')).ino, fs.statSync(path.join(real, 'g.txt')).ino, 'the file is a hard link');
    const h0 = treeHash(real);
    assert.deepEqual(treeDiff(h0, treeHash(nm)), [], 'same content');
    fs.appendFileSync(path.join(nm, 'g.txt'), '!'); // a write through the link reaches the real file
    assert.deepEqual(treeDiff(h0, treeHash(real)), ['changed g.txt'], 'treeDiff sees a write through a link');
    fs.symlinkSync(real, path.join(nm, 'a', 'jn'), 'junction'); // a junction in the home must be unlinked, not entered
    await assert.rejects(removeHome(real), /not a throwaway home/, 'removeHome refuses other folders');
    assert.equal(await removeHome(tmpHome), true, 'the home is removed');
    assert.deepEqual([...treeHash(real).keys()].sort(), ['a/b/f.txt', 'g.txt'], 'the real files are still there');
  } finally {
    fs.rmSync(real, { recursive: true, force: true });
    if (fs.existsSync(tmpHome)) await removeHome(tmpHome);
  }
  console.log('testhome selftest: PASS');
}
