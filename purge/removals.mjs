// Decides which files are non-English variants (docs, locales, assets) or Chinese-only artifacts to move into _removed.tar.xz.
import fs from 'node:fs';
import path from 'node:path';

export const PROFILES = ['web', 'desktop'];
export const PROFILES_ROOT = 'C:/Users/danil/.dsh/profiles';
export const SKIP_PKGS = new Set(['dsh-hoh', 'dsh-theme-pair']);

export function pluginList(profile) {
  const pj = JSON.parse(fs.readFileSync(`${PROFILES_ROOT}/${profile}/package.json`, 'utf8'));
  return Object.keys(pj.dependencies).filter((n) => !SKIP_PKGS.has(n));
}

export function walkPkg(root) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(p); } else out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  })(root);
  return out;
}

// Files owned by the other worker or protected by rule: never touched.
export function isProtected(rel) {
  const base = rel.split('/').pop();
  if (rel === 'README.md' || rel === 'docs/policy.md' || rel === 'package.json' || rel === 'icon.svg' || rel === 'locale/en.json') return true;
  if (/^(LICENSE|NOTICE)/i.test(base) || /LICENSE\.txt$/i.test(base)) return true;
  return false;
}

const NAME_PATTERNS = [
  /(^|\/)README[._-](zh|ZH)[A-Za-z_-]*\.md$/,
  /(^|\/)README_ZH\.md$/,
  /(^|\/)README[._-](es|hi|pt|ru|ja|ko|de|fr)\.md$/,
  /\.zh(-CN|-TW|-HK)?\.md$/,
  /(^|\/)[A-Za-z0-9_-]+_ZH\.md$/,
  /(^|\/)locale\/(?!en\.json$)[A-Za-z-]+\.json$/,
  /[-_.]zh([-_][A-Za-z]+)*\.(svg|png|webp|jpg)$/,
];
// Explicit Chinese-only variants that have an English counterpart (checked below).
const EXTRA = [
  { rel: 'docs/auto-continue-workflow.html', needs: 'docs/auto-continue-workflow.en.html' },
  { rel: 'docs/auto-continue-workflow.svg', needs: 'docs/auto-continue-workflow.en.svg' },
  { rel: 'docs/auto-continue-workflow.archify.json', needs: 'docs/auto-continue-workflow.en.archify.json' },
];

export function removalCandidates(rels, hasCjk = () => false) {
  const set = new Set(rels);
  const out = [];
  for (const rel of rels) {
    if (isProtected(rel)) continue;
    if (NAME_PATTERNS.some((re) => re.test(rel))) { out.push(rel); continue; }
    if (/\.map$/.test(rel) && hasCjk(rel)) { out.push(rel); continue; }
    const ex = EXTRA.find((x) => x.rel === rel && set.has(x.needs));
    if (ex) out.push(rel);
  }
  return out;
}

// Reports code files in the package that mention the basename of a candidate (possible static import or asset reference).
export function referencesTo(root, rels, cand) {
  const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|json|yml|yaml|html|css)$/;
  const base = cand.split('/').pop();
  const hits = [];
  for (const rel of rels) {
    if (rel === cand || !CODE.test(rel) || /\.map$/.test(rel)) continue;
    let s; try { s = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (s.includes(base)) hits.push(rel);
  }
  return hits;
}
