import {cpSync, existsSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs';
import {resolve, join} from 'node:path';
const target=resolve('../src/arc_science/static/web');
const cleanDist=process.argv.includes('--clean-dist');
if(!cleanDist)mkdirSync(join(target,'assets'),{recursive:true});
// Prune only Vite-generated chunks. Also clear setuptools' copied chunk cache so
// repeated wheel builds cannot silently include a previously compiled app.
// Explicit prebuild pruning also prevents stale dist chunks from being copied
// back into the target when the build environment retains previous output.
const directories=cleanDist?[resolve('dist/assets')]:[join(target,'assets'),resolve('../build/lib/arc_science/static/web/assets')];
for(const directory of directories) {
  if(!existsSync(directory))continue;
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    if(entry.isFile()&&/^index-[\w-]+\.(js|css)$/.test(entry.name))unlinkSync(join(directory,entry.name));
  }
}
if(!cleanDist){
  cpSync(resolve('dist'),target,{recursive:true});
  cpSync(resolve('../THIRD_PARTY_NOTICES.md'),join(target,'THIRD_PARTY_NOTICES.md'));
}
