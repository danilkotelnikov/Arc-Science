import {copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs';
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
    // Every Vite chunk: the main bundle and lazy chunks such as the Mol* viewer.
    if(entry.isFile()&&/^[A-Za-z]\w*-[\w-]+\.(js|css)$/.test(entry.name))unlinkSync(join(directory,entry.name));
  }
}
if(!cleanDist){
  // Node's recursive cpSync can abort on Windows cloud-backed directories.
  // Vite emits ordinary files/directories, so copy those explicitly.
  function copyDirectory(source,destination) {
    mkdirSync(destination,{recursive:true});
    for(const entry of readdirSync(source,{withFileTypes:true})) {
      const from=join(source,entry.name),to=join(destination,entry.name);
      if(entry.isDirectory())copyDirectory(from,to);
      else if(entry.isFile())copyFileSync(from,to);
      else throw new Error('Unexpected non-regular build entry: '+from);
    }
  }
  copyDirectory(resolve('dist'),target);
  copyFileSync(resolve('../THIRD_PARTY_NOTICES.md'),join(target,'THIRD_PARTY_NOTICES.md'));
}
