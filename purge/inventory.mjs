// Writes inventory.json: CJK counts per package and file kind, plus non-English variant files. Run before apply (before) and after (after).
import fs from 'node:fs';
import path from 'node:path';
import { PROFILES, PROFILES_ROOT, pluginList, walkPkg, removalCandidates, isProtected } from './removals.mjs';
import { CJK_G } from './gemini.mjs';

const BIN = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'webp', 'mp3', 'wav', 'zip', 'gz', 'xz', 'tar', 'wasm', 'node', 'pdf', 'mp4', 'icns', 'bmp']);
const kindOf = (rel) => {
  const e = (/\.([A-Za-z0-9]+)$/.exec(rel) || [, ''])[1].toLowerCase();
  if (e === 'md' || e === 'txt') return 'docs';
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(e)) return 'code';
  if (['sh', 'ps1', 'py'].includes(e)) return 'scripts';
  if (['yml', 'yaml', 'json'].includes(e)) return 'config';
  if (['svg', 'html', 'css'].includes(e)) return 'markup';
  if (e === 'map') return 'sourcemap';
  return e || 'other';
};
const label = process.argv[2] || 'before';
const out = { label, date: new Date().toISOString(), profiles: {}, totals: {} };
let tf = 0, tcf = 0, tcc = 0;
for (const prof of PROFILES) {
  out.profiles[prof] = {};
  for (const pkg of pluginList(prof)) {
    const root = `${PROFILES_ROOT}/${prof}/node_modules/${pkg}`;
    const rels = walkPkg(root);
    const rec = { files: rels.length, cjkFiles: 0, cjkChars: 0, byKind: {}, ownedByOtherWorker: { files: 0, cjkChars: 0 }, nonEnglishVariantFiles: [], cjkFileList: [] };
    const cjkMap = new Map();
    for (const rel of rels) {
      const ext = (/\.([A-Za-z0-9]+)$/.exec(rel) || [, ''])[1].toLowerCase();
      if (BIN.has(ext)) continue;
      const buf = fs.readFileSync(path.join(root, rel));
      if (buf.includes(0)) continue;
      const m = buf.toString('utf8').match(CJK_G);
      if (!m) continue;
      cjkMap.set(rel, m.length);
      if (rel === 'README.md' || rel === 'docs/policy.md' || rel === 'locale/en.json') { rec.ownedByOtherWorker.files++; rec.ownedByOtherWorker.cjkChars += m.length; continue; }
      rec.cjkFiles++; rec.cjkChars += m.length;
      const k = kindOf(rel); rec.byKind[k] = rec.byKind[k] || { files: 0, cjkChars: 0 };
      rec.byKind[k].files++; rec.byKind[k].cjkChars += m.length;
      rec.cjkFileList.push([rel, m.length]);
    }
    rec.nonEnglishVariantFiles = removalCandidates(rels, (r) => cjkMap.has(r));
    out.profiles[prof][pkg] = rec;
    tf += rec.files; tcf += rec.cjkFiles; tcc += rec.cjkChars;
  }
}
out.totals = { files: tf, cjkFiles: tcf, cjkChars: tcc, note: 'README.md, docs/policy.md and locale/en.json are owned by another worker and counted separately per package' };
fs.writeFileSync(`C:/Users/danil/ArcHarnessApp/purge/inventory${label === 'before' ? '' : '-' + label}.json`, JSON.stringify(out, null, 1));
console.log(label, out.totals);
