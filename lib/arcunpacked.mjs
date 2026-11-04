// Make the Arc copy of a folder: every folder and file name goes through lib/arcnames.mjs, and text files
// that hold old names are rewritten. Used for the folder beside the archive (app.asar.unpacked, where other
// files are hard links: no extra disk space) and for the data folder (~/.dsh -> ~/.arc, where they are real copies).
//   rewrite(srcPath): may this text file be rewritten (user data such as sessions keeps its words)
//   link: hard-link the files that need no rewrite instead of copying them
import fs from 'node:fs';
import path from 'node:path';
import { arcText } from './arcnames.mjs';

const TEXT = /\.(m?js|cjs|json|jsonl|md|txt|cmd|ps1|py|sh|ya?ml|ts|css|html|svg|toml)$/i;
const MAX_TEXT = 8 * 1024 * 1024;

export function makeArcCopy(src, dst, { rewrite = () => true, link = true } = {}) {
  const rel = path.relative(path.resolve(src), path.resolve(dst));
  if (rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel)) throw new Error('a copy cannot go inside its source: ' + dst);
  if (fs.existsSync(dst)) throw new Error('target exists: ' + dst);
  const stat = { linked: 0, copied: 0, rewritten: 0, renamed: 0, skippedLinks: [] };
  (function walk(s, d) {
    fs.mkdirSync(d, { mode: fs.statSync(s).mode | 0o700 }); // a private folder stays private; the owner still writes into it
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      const sp = path.join(s, e.name);
      if (e.isSymbolicLink()) { stat.skippedLinks.push(sp); continue; } // never follow a link out of the folder
      const nn = arcText(e.name)[0];
      if (nn !== e.name) stat.renamed++;
      const dp = path.join(d, nn);
      if (fs.existsSync(dp)) throw new Error('target collision: ' + dp);
      if (e.isDirectory()) { walk(sp, dp); continue; }
      if (TEXT.test(e.name) && fs.statSync(sp).size <= MAX_TEXT && rewrite(sp)) {
        const [t, n] = arcText(fs.readFileSync(sp, 'utf8'));
        if (n) { fs.writeFileSync(dp, t, { mode: fs.statSync(sp).mode }); stat.rewritten++; continue; }
      }
      if (link) { fs.linkSync(sp, dp); stat.linked++; } else { fs.copyFileSync(sp, dp); stat.copied++; }
    }
  })(src, dst);
  return stat;
}

// What the data-folder copy may rewrite: settings, profiles, local plugins and skills; never conversations,
// logs, caches, stores, the HoH ledger (its hash chain would break) or undo copies; inside node_modules only
// the packages that carry an old name (dsh, deepseek, ds-harness) or are Arc's own.
const DATA_ONLY = /^(?:sessions|logs|cache|storages|telemetry|undo|undo-snapshots|hoh|synapse|remote)$/;
export const homeRewrite = (home) => (p) => {
  const rel = path.relative(home, p).split(path.sep);
  if (DATA_ONLY.test(rel[0]) || rel[0].startsWith('_archive')) return false;
  if (/credential|secret|token|(^|\.)env$/i.test(rel[rel.length - 1])) return false; // keys stay byte for byte
  const nm = rel.lastIndexOf('node_modules');
  if (nm < 0) return true;
  const pkg = rel[nm + 1]?.startsWith('@') ? rel[nm + 1] + '/' + rel[nm + 2] : rel[nm + 1];
  return /dsh|deepseek|ds-harness|^arc-|\/arc-/.test(pkg || '');
};
