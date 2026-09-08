import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('prebuild removes only generated dist chunks so packaging cannot resurrect the old app',()=>{
  const root=mkdtempSync(join(tmpdir(),'arc-ui-package-'));
  try {
    const cwd=join(root,'web'),dist=join(cwd,'dist'),assets=join(dist,'assets');
    mkdirSync(assets,{recursive:true});
    writeFileSync(join(root,'THIRD_PARTY_NOTICES.md'),'notices');
    for(const name of ['index-stale.js','index-stale.css','operator-notes.txt'])writeFileSync(join(assets,name),'old');
    writeFileSync(join(dist,'index.html'),'old index');
    const script=resolve('scripts/package-ui.mjs');
    const clean=spawnSync(process.execPath,[script,'--clean-dist'],{cwd,encoding:'utf8'});
    expect(clean.status,clean.stderr).toBe(0);
    expect(readdirSync(assets)).toEqual(['operator-notes.txt']);
    // Model the next Vite output, then run the real packaging path.
    writeFileSync(join(assets,'index-current.js'),'new application');
    writeFileSync(join(dist,'index.html'),'<script src="/assets/index-current.js"></script>');
    const packaged=spawnSync(process.execPath,[script],{cwd,encoding:'utf8'});
    expect(packaged.status,packaged.stderr).toBe(0);
    const target=join(root,'src/arc_science/static/web');
    expect(readFileSync(join(target,'assets/index-current.js'),'utf8')).toBe('new application');
    expect(existsSync(join(target,'assets/index-stale.js'))).toBe(false);
    expect(existsSync(join(target,'assets/index-stale.css'))).toBe(false);
    expect(readFileSync(join(assets,'operator-notes.txt'),'utf8')).toBe('old');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
