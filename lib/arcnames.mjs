import { pathToFileURL } from 'node:url';

// One rename map from the original internal names to Arc names. The build applies it to the app archive,
// and the installer applies it to the copied data folder (profiles, local plugins), so both sides agree.
//   @deepseek-ai/dsh-chat     -> @arc-harness/arc-chat        (package names and import paths)
//   _deepseek_ai_dsh_store    -> _arc_harness_arc_store       (bundler names built from package names)
//   dsh/node_modules, dsh-x   -> arc/node_modules, arc-x      (folders, bundle names, CSS variables)
//   DSH_HOME, dshHome, Dsh    -> ARC_HOME, arcHome, Arc       (constants and code names)
//   .dsh, "dsh" field, dsh    -> .arc, "arc" field, arc       (data folder, package.json field, command name)
// Matches never start or end inside a word, so handshake, spreadsheetml and oldShape stay.
// Base64 text (data: URLs, integrity strings) is left alone: a run of 120 or more base64 characters is skipped.
export const RULES = [
  [/(?<![A-Za-z0-9-])dsh-theme-pair(?![a-z0-9-])/g, 'arc-theme'], // the plugin's name; the word rule below would give arc-theme-pair
  [/@deepseek-ai\//g, '@arc-harness/'],
  [/(?<![A-Za-z0-9])@deepseek-ai(?![\w-])/g, '@arc-harness'],
  [/(?<![A-Za-z0-9])_deepseek_ai_/g, '_arc_harness_'],
  [/(?<![A-Za-z0-9])deepseek-ai(?=[/_])/g, 'arc-harness'],
  [/(?<=#)deepseek-aidsh-/g, 'arc-harnessarc-'], // Markdown heading anchors of "@deepseek-ai/dsh-x"
  [/(?<![A-Za-z0-9])ds-harness(?![A-Za-z0-9])/g, 'arc-harness'],
  [/(?<![A-Za-z0-9])DSH(?![a-z0-9])/g, 'ARC'],
  [/(?<=[a-z0-9])Dsh(?![a-z0-9])/g, 'Arc'],
  [/(?<![A-Za-z0-9])Dsh(?![a-z0-9])/g, 'Arc'],
  [/(?<![A-Za-z0-9])dsh(?![a-z0-9])/g, 'arc'],
  [/(?<![A-Za-z0-9])dsh(?=viz)/g, 'arc'], // class names of the chart plugin (dshviz-option); dshow (DirectShow) stays
];

const B64 = /[A-Za-z0-9+/=_-]{120,}/g;

// rename the internal names in one text; returns [newText, count]
export function arcText(s) {
  if (!/dsh|deepseek[-_]ai|ds-harness/i.test(s)) return [s, 0];
  let n = 0;
  const one = (t) => { for (const [re, to] of RULES) t = t.replace(re, () => (n++, to)); return t; };
  let out = '', at = 0;
  for (const m of s.matchAll(B64)) {
    if (!/dsh|deepseek[-_]ai/i.test(m[0])) continue;
    // a long run that is a real identifier list (it holds a dot or slash-separated path) is still renamed; only base64-looking runs are kept
    if (!/[+=]/.test(m[0]) && /dsh-|_dsh_|deepseek-ai/.test(m[0])) continue;
    out += one(s.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return [out + one(s.slice(at)), n];
}

// rename one path ("dsh/node_modules/@deepseek-ai/dsh-chat/lib/x.js")
export const arcPath = (p) => arcText(p)[0];

// leftovers after the rename: the same word rule, for the zero-leftover checks
export const LEFT = /(?<![A-Za-z0-9])(?:dsh|DSH|Dsh)(?![a-z0-9])|(?<=[a-z0-9])Dsh(?![a-z0-9])|deepseek-ai|_deepseek_ai_/g;

// self-check: node lib/arcnames.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const eq = (a, b) => { if (a !== b) { console.error(`FAIL\n  got  ${a}\n  want ${b}`); process.exitCode = 1; } };
  eq(arcPath('dsh-theme-pair'), 'arc-theme');
  eq(arcPath('dsh-hoh'), 'arc-hoh');
  eq(arcPath('dsh/node_modules/@deepseek-ai/dsh-chat/lib/x.js'), 'arc/node_modules/@arc-harness/arc-chat/lib/x.js');
  eq(arcText('import { a } from "@deepseek-ai/dsh-tools"; _deepseek_ai_dsh_client_ui_primitives')[0], 'import { a } from "@arc-harness/arc-tools"; _arc_harness_arc_client_ui_primitives');
  eq(arcText('const DSH_HOME_DIR_NAME = ".dsh"; resolveDshHome(); dshHomePath(); pj.dsh?.profile; "dsh": {}')[0],
    'const ARC_HOME_DIR_NAME = ".arc"; resolveArcHome(); arcHomePath(); pj.arc?.profile; "arc": {}');
  eq(arcText('--dsh-file-type-violet; V7pFBG_dsh-plugin-highlight; superpowers-dsh; @dsh-ops/x; ds-harness-remote')[0],
    '--arc-file-type-violet; V7pFBG_arc-plugin-highlight; superpowers-arc; @arc-ops/x; arc-harness-remote');
  eq(arcText('handshake spreadsheetml oldShape extendShape abortHandshake dshx DSHx')[0], 'handshake spreadsheetml oldShape extendShape abortHandshake dshx DSHx');
  const b64 = 'data:font/woff2;base64,' + 'QUJD+dsh/'.repeat(20);
  eq(arcText(b64)[0], b64);
  eq(arcText('setAsDefaultProtocolClient("dsh"); bin dsh web')[0], 'setAsDefaultProtocolClient("arc"); bin arc web');
  console.log(process.exitCode ? 'arcnames: FAIL' : 'arcnames: all checks pass');
}
