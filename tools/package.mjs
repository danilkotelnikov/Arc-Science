// Build the Arc Harness installer from a working Arc Harness install (owner decision 2026-11-07: Arc Harness leaves DeepSeek Harness).
//   node tools/package.mjs [--from <install folder>] [--rcedit <rcedit-x64.exe>] [--iscc <ISCC.exe>]
// 1. Stage: copy the install to build/stage/Arc Harness, name the program Arc Harness.exe, drop the old uninstaller
//    and the update feed, and point arc.cmd at the new program name.
// 2. Brand: rcedit sets the icon and the file details of Arc Harness.exe (skipped without --rcedit).
// 3. Pack: Inno Setup builds build/Arc-Harness-Setup-<version>.exe from installer/arc-harness.iss (skipped without --iscc).
// The source install and the data home (~/.arc) are only read.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXE = 'Arc Harness.exe';
const OLD = /deepseek/i;

/** Copy an install into stage and give it Arc names. Returns the list of what changed. */
export function stage(from, to) {
  const old = fs.readdirSync(from).find((n) => /\.exe$/i.test(n) && !/^uninstall/i.test(n) && n !== 'elevate.exe');
  if (!old) throw new Error('no program file in ' + from);
  if (!fs.existsSync(path.join(from, 'resources', 'app.asar'))) throw new Error('no resources/app.asar in ' + from);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => !/^uninstall .*\.exe$/i.test(path.basename(src)) && path.basename(src) !== 'app-update.yml' });
  const done = [];
  if (old !== EXE) { fs.renameSync(path.join(to, old), path.join(to, EXE)); done.push(`program: ${old} -> ${EXE}`); }
  const cmd = path.join(to, 'resources', 'runtime', 'cli', 'bin', 'arc.cmd');
  if (fs.existsSync(cmd)) {
    const s = fs.readFileSync(cmd, 'utf8');
    if (s.includes(old)) { fs.writeFileSync(cmd, s.split(old).join(EXE)); done.push('arc.cmd starts ' + EXE); }
  }
  const left = [];
  (function walk(d, depth) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (OLD.test(e.name)) left.push(path.relative(to, path.join(d, e.name)));
      if (e.isDirectory() && depth < 3) walk(path.join(d, e.name), depth + 1);
    }
  })(to, 0);
  if (left.length) throw new Error('old names left in the stage: ' + left.join(', '));
  return done;
}

function run(exe, args) {
  const r = spawnSync(exe, args, { encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${path.basename(exe)} failed with exit code ${r.status}`);
}

function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const from = arg('--from') || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const to = path.join(root, 'build', 'stage', 'Arc Harness');
  const icon = path.join(root, 'brand', 'dist', 'tray.ico');
  for (const line of stage(from, to)) console.log('stage:', line);
  const rcedit = arg('--rcedit');
  if (rcedit) {
    run(rcedit, [path.join(to, EXE), '--set-icon', icon, '--set-version-string', 'ProductName', 'Arc Harness', '--set-version-string', 'FileDescription', 'Arc Harness',
      '--set-version-string', 'CompanyName', 'Arc Harness', '--set-version-string', 'OriginalFilename', EXE, '--set-version-string', 'InternalName', 'Arc Harness', '--set-product-version', version]);
    console.log('brand: icon and file details of', EXE);
  } else console.log('brand: skipped, no --rcedit');
  const iscc = arg('--iscc');
  if (iscc) {
    run(iscc, ['/Qp', `/DAppVersion=${version}`, `/DStage=${to}`, `/DOutDir=${path.join(root, 'build')}`, `/DIcon=${icon}`, path.join(root, 'installer', 'arc-harness.iss')]);
    console.log('pack:', path.join(root, 'build', `Arc-Harness-Setup-${version}.exe`));
  } else console.log('pack: skipped, no --iscc');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
