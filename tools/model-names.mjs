// Readable names for the models of one provider in the desktop profile.
//   node tools/model-names.mjs --provider OAK --dry
//   node tools/model-names.mjs --provider OAK            write the names; the original file goes to a dated backup
//   node tools/model-names.mjs --provider OAK --restore  put the newest backup back
// The catalogue of the provider site supplies the names it publishes; a model it does not list is spelled from its id.
// A name two models would share gains the variant of its id, so two rows never read alike. The app reads this file at
// start, so it shows the new names after a restart.
//
// A restore needs no network and no catalogue: it runs before anything is fetched, so a broken endpoint cannot stop a
// recovery. The script keeps the process alive to its natural end, because exiting after a fetch on Windows aborts.
import fs from 'node:fs';
import path from 'node:path';
import { prettyName } from '../lib/model-autofetch.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const value = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const providerName = value('provider', 'OAK');
const home = process.env.USERPROFILE || process.env.HOME;
const profilePath = path.resolve(value('profile', path.join(home, '.arc', 'profiles', 'desktop', 'cordis.patch.yml')));
const backupDir = path.dirname(profilePath);
const backupPrefix = `_archive-${path.basename(profilePath, '.yml')}-names-`;

/** The local date, so a backup made before midnight keeps the name a person saw. */
function localStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** The newest backup of this profile, or `undefined`. */
function newestBackup() {
  const named = fs.readdirSync(backupDir).filter((name) => name.startsWith(backupPrefix) && name.endsWith('.yml')).sort();
  return named.length === 0 ? undefined : path.join(backupDir, named[named.length - 1]);
}

/** How the makers in front of an id spell their own name. */
const BRAND = { deepseek: 'DeepSeek', nvidia: 'NVIDIA', minimax: 'MiniMax', longcat: 'LongCat', ernie: 'ERNIE' };

/**
 * A model id without its free marker and without the variant number some gateways append, so every copy of one model
 * lands in the same family: "glm-x:free" and "glm-x-2:free" are one family with two rows.
 */
function familyOf(id) {
  return id.replace(/:\s*free$/i, '').replace(/-\d+$/, '');
}

/** The variant number at the end of an id, or `undefined`. */
function variantOf(id) {
  return (id.replace(/:\s*free$/i, '').match(/-(\d+)$/) || [])[1];
}

async function readCatalogue() {
  const local = value('catalogue', '');
  if (local.length > 0) return JSON.parse(fs.readFileSync(local, 'utf8'));
  const url = value('catalogue-url', 'https://oneaiapikey.com/models.json');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`catalogue ${url} answered ${response.status}`);
  return response.json();
}

async function main() {
  const source = fs.readFileSync(profilePath, 'utf8');

  if (flag('restore')) {
    const named = value('backup', '');
    const from = named.length > 0 ? path.resolve(named) : newestBackup();
    if (from === undefined || !fs.existsSync(from)) throw new Error(`no backup of ${profilePath} at ${backupDir}`);
    fs.copyFileSync(from, profilePath);
    console.log(`restored ${profilePath} from ${from}`);
    return;
  }

  const lines = source.split('\n');
  const providerAt = lines.findIndex((line) => line.trim() === `displayName: ${providerName}`);
  if (providerAt < 0) throw new Error(`no provider "${providerName}" in ${profilePath}`);
  const modelsAt = lines.findIndex((line, i) => i > providerAt && line.trim() === 'models:' && /^\s+/.test(line));
  if (modelsAt < 0) throw new Error(`no models list under "${providerName}"`);
  const modelsIndent = lines[modelsAt].length - lines[modelsAt].trimStart().length;

  // the model rows of this provider end where the indentation returns to the models keyword or above
  const ids = [];
  const nameLineAt = new Map();
  for (let i = modelsAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.length - line.trimStart().length <= modelsIndent) break;
    const idMatch = line.match(/^(\s*)-\s+id:\s*(.+?)\s*$/);
    if (idMatch === null) continue;
    ids.push(idMatch[2]);
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s+id:/.test(lines[j])) break;
      if (/^\s+name:\s*(.*)$/.test(lines[j])) {
        nameLineAt.set(idMatch[2], j);
        break;
      }
    }
  }
  if (ids.length === 0) throw new Error(`no model rows under "${providerName}"`);

  const document = await readCatalogue();
  const names = new Map();
  for (const row of Array.isArray(document?.models) ? document.models : []) {
    if (typeof row?.id === 'string' && typeof row?.name === 'string') names.set(row.id, row.name);
  }

  const familySize = new Map();
  for (const id of ids) familySize.set(familyOf(id), (familySize.get(familyOf(id)) || 0) + 1);

  // the label of one model: the published name of its family, then the variant when it is one of several copies
  const baseLabel = new Map(ids.map((id) => {
    const family = familyOf(id);
    const published = names.get(id) ?? names.get(`${family}:free`) ?? names.get(family);
    const written = typeof published === 'string' && published.length > 0 ? published : prettyName(family);
    const variant = variantOf(id);
    // a variant shows when its family has more than one row, or when the catalogue names this exact id not at all
    const shows = variant !== undefined && ((familySize.get(family) || 0) > 1 || !names.has(id));
    return [id, shows ? `${written} (${variant})` : written];
  }));

  const labelCount = new Map();
  for (const label of baseLabel.values()) labelCount.set(label, (labelCount.get(label) || 0) + 1);
  const labelOf = (id) => {
    const label = baseLabel.get(id);
    if ((labelCount.get(label) || 0) <= 1) return label;
    // two upstreams can publish one model under one name; the first segment of the id tells them apart
    const prefix = familyOf(id).split(/[-_/\s:]+/)[0];
    return `${label} (${BRAND[prefix.toLowerCase()] ?? prettyName(prefix)})`;
  };

  const written = new Map();
  for (const id of ids) {
    const at = nameLineAt.get(id);
    if (at === undefined) continue;
    const label = labelOf(id);
    const indent = lines[at].match(/^\s*/)[0];
    if (lines[at].trim() !== `name: ${label}`) written.set(at, `${indent}name: ${label}`);
  }

  const changed = [...written.entries()];
  if (changed.length === 0) {
    console.log(`nothing to change: ${ids.length} models of ${providerName} already carry their names`);
    return;
  }
  for (const [at, text] of changed) console.log(`${lines[at].trim().padEnd(40)}  ->  ${text.trim()}`);
  if (flag('dry')) {
    console.log(`dry run: ${changed.length} names of ${ids.length} models would change in ${profilePath}`);
    return;
  }

  const next = [...lines];
  for (const [at, text] of changed) next[at] = text;
  const after = next.join('\n');
  if (after.split('\n').length !== lines.length) throw new Error('line count changed; refusing to write');
  if ((after.match(/^\s*-\s+id:/gm) || []).length !== (source.match(/^\s*-\s+id:/gm) || []).length) throw new Error('model count changed; refusing to write');

  // a backup is the first state of the file, so an existing one is never overwritten without --force
  const backupPath = path.join(backupDir, backupPrefix + localStamp(new Date()) + '.yml');
  if (!fs.existsSync(backupPath) || flag('force')) fs.copyFileSync(profilePath, backupPath);
  fs.writeFileSync(profilePath, after);
  console.log(`wrote ${changed.length} names of ${ids.length} models in ${profilePath}`);
  console.log(`backup: ${backupPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});