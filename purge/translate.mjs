// Collects every unique text that needs translation (both profiles) and fills cache.json through Gemini on Vertex.
import fs from 'node:fs';
import { planProfile } from './plan.mjs';
import { ensureTranslated, loadCache, saveCache, loadUsage, saveUsage, translateRaw, validate, CJK_RE } from './gemini.mjs';
import { asciiPunct } from './punct.mjs';

const log = (m) => console.log(new Date().toISOString().slice(11, 19) + ' ' + m);
const units = new Map(); const punct = new Map();
for (const prof of ['web', 'desktop']) {
  const plan = planProfile(prof);
  for (const f of plan.files) for (const u of f.all) {
    if (u.decision !== 'translate') continue;
    if (u.punctOnly) { punct.set(u.key, asciiPunct(u.key)); continue; }
    if (!units.has(u.key)) units.set(u.key, u.kind);
  }
  log(`${prof}: planned, ${units.size} unique texts so far`);
}
const cache = loadCache();
for (const [k, v] of punct) cache[k] = v;
saveCache(cache);

const { failed } = await ensureTranslated(units, { log });
log(`failed after normal path: ${failed.length}`);

// Fallbacks
const usage = loadUsage(); const cache2 = loadCache(); const stillFailed = [];
for (const it of failed) {
  let ok = false;
  try {
    if (it.kind === 'comment') {
      const joined = it.text.replace(/\n/g, ' ');
      const { arr } = await translateRaw([{ kind: 'comment', text: joined }], usage);
      const err = validate('x', joined, arr[0]); // no line check
      if (!err) { cache2[it.text] = arr[0].replace(/\n/g, ' '); ok = true; }
    } else if (['md', 'text', 'line'].includes(it.kind)) {
      const lines = it.text.split('\n'); const out = [];
      for (const l of lines) {
        if (!CJK_RE.test(l)) { out.push(l); continue; }
        if (cache2[l]) { out.push(cache2[l]); continue; }
        const { arr } = await translateRaw([{ kind: 'line', text: l }], usage);
        const err = validate('line', l, arr[0]);
        if (err) { out.push(null); break; }
        cache2[l] = arr[0]; out.push(arr[0]);
      }
      if (!out.includes(null)) { cache2[it.text] = out.join('\n'); ok = true; }
    }
  } catch (e) { log('fallback error ' + String(e.message).slice(0, 120)); }
  if (!ok) stillFailed.push(it);
}
saveCache(cache2); saveUsage(usage);
fs.writeFileSync('C:/Users/danil/ArcHarnessApp/purge/_failed.json', JSON.stringify(stillFailed, null, 1));
log(`done. cache ${Object.keys(cache2).length}, unresolved ${stillFailed.length}; tokens in ${usage.promptTokens} out ${usage.outputTokens} calls ${usage.calls}`);
