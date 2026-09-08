// Unit-check the diagnostic gallery's out-of-order fetch behavior without a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.value = 'unit-test'; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
}
const elements = new Map(), pending = new Map(), revoked = new Set();
let nextUrl = 0;
const context = vm.createContext({
  document: {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); },
    createElement(tag) { return new Element(tag); }
  },
  URL: { createObjectURL: () => 'blob:unit-' + (++nextUrl), revokeObjectURL: url => revoked.add(url) },
  fetch: url => new Promise(resolve => pending.set(url, resolve)),
  setInterval, clearInterval, setTimeout, console
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/arc_science/static/console.js'), 'utf8'), context);
const artifact = { digest: 'a'.repeat(64), source_observation_id: 'fit' };
context.unitArtifact = artifact;
const respond = mission => pending.get(`/api/missions/${mission}/artifacts/${artifact.digest}`)({
  ok: true, blob: async () => Buffer.from('unit-image')
});
(async () => {
  const old = vm.runInContext("selected='old'; renderArtifacts('old',[unitArtifact])", context);
  const current = vm.runInContext("selected='current'; renderArtifacts('current',[unitArtifact])", context);
  respond('current');
  await current;
  const gallery = elements.get('artifacts');
  const currentUrl = gallery.children[0].children[0].src;
  respond('old');
  await old;
  assert.equal(gallery.children[0].children[0].src, currentUrl, 'A stale fetch replaced the selected mission image');
  assert.equal(revoked.has(currentUrl), false, 'A stale fetch revoked the selected mission image');
  assert.equal(revoked.size, 1, 'The discarded image URL must be released');
  console.log('PASS: stale artifact fetch cannot replace or revoke the selected mission image');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
