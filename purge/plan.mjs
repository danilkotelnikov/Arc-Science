// Builds the work plan for one profile: files to remove, files to copy over, manual edits, and translation units with decisions.
import fs from 'node:fs';
import path from 'node:path';
import { PROFILES_ROOT, pluginList, walkPkg, removalCandidates, referencesTo, isProtected } from './removals.mjs';
import { CJK_RE } from './gemini.mjs';
import { extractAny, extOf } from './units.mjs';

const PURGE = 'C:/Users/danil/ArcHarnessApp/purge';
const TEXT_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'md', 'txt', 'sh', 'yml', 'yaml', 'ps1', 'py', 'css', 'svg', 'html', 'htm', 'xml', 'json', 'map']);
const BIN_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'webp', 'mp3', 'wav', 'zip', 'gz', 'xz', 'tar', 'wasm', 'node', 'pdf', 'mp4', 'icns', 'bmp']);
const FUNCTIONAL_CTX = new Set(['call', 'compare', 'case', 'index', 'pairkey', 'regexsrc']);

function loadJson(name, dflt) { try { return JSON.parse(fs.readFileSync(`${PURGE}/${name}`, 'utf8')); } catch { return dflt; } }
export const decisionsFile = () => loadJson('decisions.json', { leave: [], translate: [], copyFrom: [], keepFiles: [], jsonEdits: [] });
export const manualEdits = () => loadJson('manual-edits.json', []);

const fileMatch = (rule, pkg, rel) => (!rule.pkg || rule.pkg === pkg) && (!rule.file || rel === rule.file || rel.endsWith('/' + rule.file));
function ruleMatch(rule, pkg, rel, u) {
  if (!fileMatch(rule, pkg, rel)) return false;
  if (rule.ctx && rule.ctx !== u.ctx) return false;
  if (rule.type && rule.type !== u.type) return false;
  if (rule.includes && !u.key.includes(rule.includes)) return false;
  if (rule.startsWith && !u.key.startsWith(rule.startsWith)) return false;
  return true;
}

export function applyManualToText(pkg, rel, text, edits = manualEdits(), phase = 'pre') {
  let t = text; const applied = [];
  for (const e of edits) {
    if (!fileMatch(e, pkg, rel) || (e.phase || 'pre') !== phase) continue;
    if (e.dropSections) {
      // Bilingual file: drop every block that starts at a line containing `start` up to (not including) the next line containing `end`, and the language switcher lines.
      const { start, end, switcher } = e.dropSections;
      const sw = switcher ? new RegExp(switcher) : null;
      const lines = t.split('\n'); const kept = []; let dropping = false; let dropped = 0;
      for (const l of lines) {
        if (!dropping && l.includes(start)) dropping = true;
        else if (dropping && l.includes(end)) dropping = false;
        if (dropping || (sw && sw.test(l))) { dropped++; continue; }
        kept.push(l);
      }
      if (dropped) { t = kept.join('\n'); applied.push({ e, status: 'applied', dropped }); } else applied.push({ e, status: 'already' });
      continue;
    }
    const count = t.split(e.find).length - 1;
    if (count === 0) { applied.push({ e, status: t.includes(e.replace) ? 'already' : 'missing' }); continue; }
    if (count > 1 && !e.all) { applied.push({ e, status: 'ambiguous:' + count }); continue; }
    t = t.split(e.find).join(e.replace); applied.push({ e, status: 'applied' });
  }
  return { text: t, applied };
}

// Sidebar dictionaries: Chinese values are replaced by the English values of the same key from the `en` object in the same file.
function sidebarDictRefs(text) {
  const zi = text.indexOf('\n\tconst zh = {'); const ei = text.indexOf('\n\tconst en = {');
  if (zi < 0 || ei < 0) return null;
  const entryRe = /\n\t\t([A-Za-z_$][\w$]*): ("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;
  const endOf = (i) => { let d = 0; for (let p = text.indexOf('{', i); p < text.length; p++) { const c = text[p]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return p; } } return text.length; };
  const zEnd = endOf(zi), eEnd = endOf(ei);
  const en = new Map(); let m;
  entryRe.lastIndex = ei; while ((m = entryRe.exec(text)) && m.index < eEnd) en.set(m[1], m[2]);
  return { zRange: [zi, zEnd], en };
}
const placeholders = (s) => (s.match(/\{[A-Za-z0-9_.]+\}/g) || []).sort().join(',');

export function planProfile(profile, { onlyPkg } = {}) {
  const dec = decisionsFile(); const manual = manualEdits();
  const files = []; const removeList = []; const copyList = []; const unsupported = []; const manualStatus = []; const protectedWithCjk = [];
  for (const pkg of pluginList(profile)) {
    if (onlyPkg && pkg !== onlyPkg) continue;
    const root = `${PROFILES_ROOT}/${profile}/node_modules/${pkg}`;
    const rels = walkPkg(root);
    const hasCjk = (rel) => { try { return CJK_RE.test(fs.readFileSync(`${root}/${rel}`, 'utf8')); } catch { return false; } };
    let cands = removalCandidates(rels, hasCjk);
    const removed = new Set();
    for (const c of cands) {
      const keepRule = dec.keepFiles.find((k) => fileMatch(k, pkg, c));
      const copy = dec.copyFrom.find((k) => fileMatch(k, pkg, c));
      if (copy) { copyList.push({ profile, pkg, root, rel: c, from: copy.from }); continue; }
      if (keepRule) continue;
      removed.add(c); removeList.push({ profile, pkg, root, rel: c });
    }
    for (const rel of rels) {
      if (removed.has(rel)) continue;
      const ext = extOf(rel);
      if (BIN_EXT.has(ext)) continue;
      const abs = `${root}/${rel}`;
      let buf; try { buf = fs.readFileSync(abs); } catch { continue; }
      if (buf.includes(0)) continue;
      let text = buf.toString('utf8');
      const man = applyManualToText(pkg, rel, text, manual);
      manual.length && man.applied.forEach((a) => manualStatus.push({ profile, pkg, rel, ...a }));
      text = man.text;
      const changedByManual = text !== buf.toString('utf8');
      if (!CJK_RE.test(text) && !changedByManual) continue;
      if (isProtected(rel)) { if (CJK_RE.test(text)) protectedWithCjk.push({ profile, pkg, rel }); continue; }
      if (!TEXT_EXT.has(ext) && CJK_RE.test(text)) { unsupported.push({ profile, pkg, rel }); continue; }
      if (ext === 'json' || ext === 'map') { if (CJK_RE.test(text)) unsupported.push({ profile, pkg, rel }); if (!changedByManual) continue; }
      const ex = CJK_RE.test(text) && !['json', 'map'].includes(ext) ? extractAny(rel, text) : { units: [] };
      const all = ex.all || ex.units;
      // dictionary refs
      if (pkg === 'dsh-better-sidebar' && /lib\/client-(editor|mermaid)\.js$/.test(rel)) {
        const d = sidebarDictRefs(text);
        if (d) for (const u of all) if (u.type === 'str' && u.start > d.zRange[0] && u.end < d.zRange[1]) {
          const km = /([A-Za-z_$][\w$]*):\s*$/.exec(text.slice(Math.max(0, u.start - 60), u.start));
          const ref = km && d.en.get(km[1]);
          if (ref && placeholders(ref) === placeholders(text.slice(u.start, u.end)) && !CJK_RE.test(ref)) u.ref = ref;
        }
      }
      for (const u of all) {
        if (u.ref) { u.decision = 'ref'; continue; }
        if (dec.leave.some((r) => ruleMatch(r, pkg, rel, u))) { u.decision = 'leave'; continue; }
        if (dec.translate.some((r) => ruleMatch(r, pkg, rel, u))) { u.decision = 'translate'; continue; }
        if (u.type === 'regex' || FUNCTIONAL_CTX.has(u.ctx)) { u.decision = 'review'; continue; }
        u.decision = 'translate';
      }
      for (const u of all) if (u.decision === 'translate' && u.type !== 'tpl' && !/[㐀-鿿]/.test(u.key)) u.punctOnly = true;
      files.push({ profile, pkg, root, rel, abs, text, units: ex.units, all, removals: ex.removals || [], changedByManual });
    }
  }
  return { files, removeList, copyList, unsupported, manualStatus, protectedWithCjk };
}
