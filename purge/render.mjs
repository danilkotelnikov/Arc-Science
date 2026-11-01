import { renderRange } from './units.mjs';

// getTr(u) -> translation string or undefined (leave as is). Returns the new file text.
export function renderFile(file, getTr) {
  for (const u of file.all) {
    u.tr = undefined;
    if (u.decision === 'ref') { u.quote = u.ref[0]; u.tr = u.ref.slice(1, -1); }
    else if (u.decision === 'translate') { const t = getTr(u); if (t !== undefined) u.tr = t; }
  }
  const edits = [...file.units];
  for (const r of file.removals || []) edits.push({ ...r, tr: '' });
  return renderRange(file.text, 0, file.text.length, edits);
}
