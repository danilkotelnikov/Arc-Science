// Strips external links and sources from the old upstream docs of six plugins, in both profiles.
//   node linkstrip/strip.mjs [--dry]
// Scope: docs/**/*.md except policy.md and non-English variants; community QR images are removed.
// Kept: links to files inside the package, and every address inside fenced code or inline code (examples must keep working).
// The originals go into linkstrip/_originals.tar.xz once, before the first write. Running again changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dry = process.argv.includes('--dry');
const profiles = ['web', 'desktop'];
const plugins = ['@anysearch/anysearch-dsh', '@liustack/modlens', '@liustack/modsearch', 'dsh-chat-import', 'dsh-client-auto-continue', 'dsh-vision-router'];
const home = process.env.DSH_HOME || 'C:/Users/danil/.dsh';
const OTHER_LANG = /\.(zh|zh-CN|zh-TW|ja|ko|es|pt|hi|ru|de|fr)\.md$|[-_.]zh[-_.]?[A-Za-z]*\.md$/;
const EMPTY_SECTION = /^(links?|sources?|references?|see also|resources|community|contact|support)$/i;

const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

export function stripMarkdown(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence = null;
  for (const raw of lines) {
    const f = /^\s*(```+|~~~+)/.exec(raw);
    if (f) {
      if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null;
      out.push(raw);
      continue;
    }
    if (fence) { out.push(raw); continue; }
    const spans = [];
    const keep = (m) => { spans.push(m); return `\u0000${spans.length - 1}\u0000`; };
    // inline code and addresses of this computer or of examples stay as they are
    let line = raw.replace(/(`+)[^`]*?\1/g, keep)
      .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9.-]*example(?:\.[a-z]+)?)(?::\d+)?[^\s<>"')\]]*/gi, keep);
    const before = line;
    if (/^\s*\[[^\]]+\]:\s*(https?:\/\/|mailto:)\S+.*$/.test(line)) continue; // link definition
    line = line.replace(/!\[[^\]]*\]\((?:https?:\/\/|mailto:)[^)]*\)/g, '');
    line = line.replace(/\s*\(\[#?\d+\]\((?:https?:\/\/)[^)]*\)\)/g, '');       // "(#40)" issue references
    line = line.replace(/\[#?\d+\]\((?:https?:\/\/)[^)]*\)/g, 'an upstream issue');  // "#40" issue references
    line = line.replace(/\[([^\]]*)\]\((?:https?:\/\/|mailto:)[^)\s]*(?:\s+"[^"]*")?\)/g, (m, t) => t);
    line = line.replace(/<a\s[^>]*href="(?:https?:|mailto:)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    line = line.replace(/<img[^>]*src="https?:[^"]*"[^>]*>/gi, '');
    // addresses in running text: a line that was only a label for the address goes; otherwise the address becomes a plain phrase
    const urlRe = /<(?:https?:\/\/|mailto:)[^>]+>|https?:\/\/[^\s<>"')\]]+/g;
    if (urlRe.test(line)) {
      urlRe.lastIndex = 0;
      const rest = line.replace(urlRe, '').replace(/[*_~()\[\]|>#\-\s]/g, '');
      if (rest === '' || (/[:：]$/.test(rest) && rest.length <= 40)) continue;
      line = line.replace(/\(\s*(?:<(?:https?:\/\/|mailto:)[^>]+>|https?:\/\/[^\s<>"')\]]+)\s*\)/g, '').replace(urlRe, "the provider's website");
    }
    if (line !== before) {
      line = line.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '').replace(/([^\s|])[ \t]{2,}/g, '$1 ').replace(/[ \t]+$/g, '');
      if (/^\s*([-*+]|\d+[.)])\s*$/.test(line) || /^\s*[|\-: ]+$/.test(line) && /\|/.test(raw)) continue; // an emptied list item or table row
      if (line.trim() === '' && raw.trim() !== '') continue;
    }
    line = line.replace(/\u0000(\d+)\u0000/g, (m, i) => spans[+i]);
    out.push(line);
  }
  // headings whose whole section became empty
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const h = /^#{1,6}\s+(.*?)\s*$/.exec(out[i]);
    if (h && EMPTY_SECTION.test(h[1].replace(/[*_`:]/g, ''))) {
      let j = i + 1;
      while (j < out.length && out[j].trim() === '') j++;
      if (j >= out.length || /^#{1,6}\s/.test(out[j])) { i = j - 1; continue; }
    }
    res.push(out[i]);
  }
  let joined = res.join(eol).replace(new RegExp(`(?:${eol}){3,}`, 'g'), eol + eol);
  if (text.endsWith(eol) && !joined.endsWith(eol)) joined += eol;
  return joined;
}

function main() {
const targets = [];
// top-level English documents and the source fields of package.json, for every plugin that has them
const ROOT_DOC = /^(CHANGELOG|SECURITY|CODE_OF_CONDUCT|RELEASE-NOTES|CONTRIBUTING|README\.en)(\.md)$/i;
const SOURCE_FIELDS = ['repository', 'homepage', 'bugs', 'funding'];
const allPlugins = (prof) => {
  const pj = JSON.parse(fs.readFileSync(path.join(home, 'profiles', prof, 'package.json'), 'utf8'));
  return Object.keys(pj.dependencies || {}).filter((n) => !String(pj.dependencies[n]).startsWith('file:'));
};
function stripPackageJson(text) {
  const j = JSON.parse(text);
  let changed = false;
  for (const k of SOURCE_FIELDS) if (k in j) { delete j[k]; changed = true; }
  if (!changed) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^(\t| +)"/m.exec(text)?.[1] ?? '  ';
  return JSON.stringify(j, null, indent).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : '');
}
for (const prof of profiles) for (const p of allPlugins(prof)) {
  const dir = path.join(home, 'profiles', prof, 'node_modules', p);
  if (!fs.existsSync(dir)) continue;
  for (const b of fs.readdirSync(dir)) {
    if (ROOT_DOC.test(b) && fs.statSync(path.join(dir, b)).isFile()) targets.push({ f: path.join(dir, b), kind: 'md' });
  }
  const pjf = path.join(dir, 'package.json');
  if (fs.existsSync(pjf)) targets.push({ f: pjf, kind: 'pkg' });
}
for (const prof of profiles) for (const p of plugins) {
  const dir = path.join(home, 'profiles', prof, 'node_modules', p, 'docs');
  for (const f of walk(dir)) {
    const b = path.basename(f);
    if (/\.md$/i.test(b) && b !== 'policy.md' && !OTHER_LANG.test(b)) targets.push({ f, kind: 'md' });
    else if (/community-qr\.(png|jpe?g)$/i.test(b)) targets.push({ f, kind: 'remove' });
  }
}

const changes = [];
for (const t of targets) {
  if (t.kind === 'remove') { changes.push({ ...t, next: null }); continue; }
  const s = fs.readFileSync(t.f, 'utf8');
  const n = t.kind === 'pkg' ? stripPackageJson(s) : stripMarkdown(s);
  if (n !== s) changes.push({ ...t, next: n });
}

if (!changes.length) { console.log('nothing to change: no outside links left in the English docs'); process.exit(0); }
console.log(`${changes.length} files to change (${changes.filter((c) => c.next === null).length} removals)`);
if (dry) { for (const c of changes.slice(0, 80)) console.log(' ', c.next === null ? 'remove' : 'strip ', path.relative(home, c.f)); process.exit(0); }

// one archive, kept up to date: the earlier originals are unpacked, the new ones are added, and the archive is rewritten in place
const archive = path.join(here, '_originals.tar.xz');
const rel = (f) => path.relative(home, f).replace(/\\/g, '/');
const stage = fs.mkdtempSync(path.join(here, '.stage-'));
try {
  const tar = (args) => { const r = spawnSync('tar', ['--force-local', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('tar failed: ' + r.stderr); return r.stdout; };
  if (fs.existsSync(archive)) tar(['-xJf', archive, '-C', stage]);
  for (const c of changes) {
    const dest = path.join(stage, rel(c.f));
    if (fs.existsSync(dest)) continue; // the oldest original wins
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(c.f, dest);
  }
  const next = archive + '.new';
  tar(['-cJf', next, '-C', stage, '.']);
  fs.renameSync(next, archive);
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
// files may be hard-linked to the package store: write a temp file and rename it over the original
for (const c of changes) {
  if (c.next === null) { fs.rmSync(c.f); continue; }
  const tmp = c.f + '.arc-tmp';
  fs.writeFileSync(tmp, c.next);
  fs.renameSync(tmp, c.f);
}
console.log('done; originals saved in', archive);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
