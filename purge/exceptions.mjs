// Lists the CJK text that remains after apply, with a reason, and writes exceptions.json.
import fs from 'node:fs';
import { planProfile } from './plan.mjs';

const REASONS = [
  { pkg: 'dsh-vision-router', file: 'lib/runtime-i18n-boundary.js', why: 'Legacy translator: rewrites Chinese vision-router text that older saved sessions still contain into English. It must match the original Chinese text, so it stays Chinese.' },
  { pkg: 'dsh-vision-router', file: 'lib/runtime-i18n-core.js', why: 'Legacy translator: compares with the Chinese stale-prompt marker stored in older sessions.' },
  { pkg: 'dsh-vision-router', file: 'index.js', why: 'Legacy machine-protocol check on the old Chinese "mounted" message; the branch is unreachable by design (see the comment in lib/runtime-i18n-boundary.js).' },
  { pkg: 'dsh-vision-router', file: 'lib/http-compat.js', why: 'Parses limit and error text that Chinese model providers return in Chinese; English alternatives already sit next to them.' },
  { pkg: 'dsh-vision-router', file: 'lib/twin-image-capability-fallback.js', why: 'Detects "image input not supported" errors that Chinese providers return in Chinese.' },
  { pkg: '@liustack/modsearch', file: 'dist/main.js', why: 'Detects in-progress placeholder text in results of Chinese search engines.' },
];
const out = [];
for (const prof of ['web', 'desktop']) {
  const plan = planProfile(prof);
  for (const f of plan.files) for (const u of f.all) {
    if (u.decision === 'translate' || u.decision === 'ref') { out.push({ profile: prof, pkg: f.pkg, file: f.rel, unit: u.type, ctx: u.ctx, decision: 'UNRESOLVED-' + u.decision, text: u.key.slice(0, 100) }); continue; }
    const r = REASONS.find((x) => x.pkg === f.pkg && (f.rel === x.file));
    out.push({ profile: prof, pkg: f.pkg, file: f.rel, unit: u.type, ctx: u.ctx, decision: u.decision, reason: r ? r.why : 'UNCLASSIFIED', text: u.key.slice(0, 100) });
  }
  for (const x of plan.unsupported) out.push({ profile: prof, pkg: x.pkg, file: x.rel, decision: 'unsupported file type' });
}
fs.writeFileSync('C:/Users/danil/ArcHarnessApp/purge/exceptions.json', JSON.stringify(out, null, 1));
const by = {}; for (const o of out.filter((x) => x.profile === 'web')) { const k = `${o.pkg} ${o.file} ${o.decision} ${o.reason ? '' : ''}`; by[k] = (by[k] || 0) + 1; }
console.log(by);
console.log('unclassified', out.filter((x) => x.profile === 'web' && x.reason === 'UNCLASSIFIED').length);
