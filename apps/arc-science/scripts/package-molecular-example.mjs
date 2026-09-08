// Repackage an approved checkpoint; never render or modify the frozen candidate.
import {readFileSync, writeFileSync, copyFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
const source = resolve(process.argv[2]);
const candidate = join(source, 'examples/molecular-figures/candidates/03');
const output = resolve('src/arc_science/example_assets/1dqj');
mkdirSync(output, {recursive:true});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = ['collage.png','collage.svg','overview.png','interface.png','rotated.png','contacts.csv','source.cif','scene.json','molecular_worker.py','manifest.json','worker-receipt.json','checks.json','caption.md','run.json'];
if (digest(readFileSync(join(candidate,'collage.png'))) !== '7394f162dca9bba20ca985a2cd43473da2c9df7d88be5e39acaec81f30f598d9') throw Error('Wrong frozen candidate');
const svg = readFileSync(join(candidate,'collage.svg'),'utf8');
const svgHash = digest(svg);
if (svgHash !== '71cfeb7a84177e18a6cc00cff54c6449e985dd30718e209136513553562682c6') throw Error('Wrong source SVG');
for(const name of originals) copyFileSync(join(candidate,name),join(output,name));
const views = {overview:'0 48 700 480',interface:'700 48 700 480',rotated:'0 528 700 510'};
for(const [name,viewport] of Object.entries(views)) {
  const [, , width,height] = viewport.split(' ');
  const focused = svg.replace('width="1400" height="1090" viewBox="0 0 1400 1090"',`width="${width}" height="${height}" viewBox="${viewport}" data-source-sha256="${svgHash}"`);
  writeFileSync(join(output,name+'.svg'),focused);
}
copyFileSync(join(source,'docs/intermediates/visual-reset-2026-09-05/candidate-03-visual-review.md'),join(output,'visual-review.md'));
const packetPath = join(source,'.superpowers/sdd/2026-09-07-molecular-figures/candidate-03-review-packet.json');
const packetBytes = readFileSync(packetPath);
const packet = JSON.parse(packetBytes);
const metadata = {...packet, format:'arc-figure-review-packet-metadata/1', original_packet_file_sha256:digest(packetBytes),
  note:'Metadata-only public record. Publisher reference pixels removed; not an executable review packet. Original packet digest is historical, not the digest of this derivative.',
  images:packet.images.map(({data_base64,...image})=>image)};
writeFileSync(join(output,'review-packet-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
const names = [...originals,...Object.keys(views).map(name=>name+'.svg'),'visual-review.md','review-packet-metadata.json'];
const assets = Object.fromEntries(names.map(name=>{const bytes=readFileSync(join(output,name));return [name,{sha256:digest(bytes),bytes:bytes.length}];}));
writeFileSync(join(output,'integrity.json'),JSON.stringify({source_commit:'8a68f2e',candidate:'03',originals,derived_views:{source_sha256:svgHash,viewports:views},excluded:'Editable .blend files and publisher/reference pixels are not in this public package.',assets},null,2)+'\n');
