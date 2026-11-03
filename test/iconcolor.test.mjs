// Unit tests of lib/iconcolor.mjs recolorBlueHues: blue and violet go, status colours, neutrals and non-colours stay, output is stable.
//   node test/iconcolor.test.mjs
import { recolorBlueHues, replaceVendorBlue } from '../lib/iconcolor.mjs';

let bad = 0;
const t = (label, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' :: ' + detail}`); };
const gone = (label, input, re) => { const out = recolorBlueHues(input); t(label, !re.test(out) && out !== input, out); };
const same = (label, input) => { const out = recolorBlueHues(input); t(label, out === input, out); };

// blue and violet, in every form the app uses
gone('hex', 'a{color:#4d6bfe}', /#4d6bfe/i);
gone('hex with alpha keeps the alpha', 'a{color:#5d35a0cc}', /#5d35a0/i);
t('hex alpha stays', /cc\}/.test(recolorBlueHues('a{color:#5d35a0cc}')));
gone('rgba with a number alpha', 'x:rgba(82,130,255,.12)', /82,\s*130/);
gone('rgba with an expression alpha', 'x:`rgba(236,222,255,${Math.min(1, alpha + 0.26)})`', /236,\s*222/);
t('the expression alpha is kept', recolorBlueHues('x:`rgba(236,222,255,${Math.min(1, alpha + 0.26)})`').includes('${Math.min(1, alpha + 0.26)}'));
gone('rgb with spaces', 'x:rgb(60 80 250 / 40%)', /60 80 250/);
gone('hsl with commas', 'x:hsl(220,70%,50%)', /220/);
gone('hsl with spaces and alpha', 'x:hsl(250 60% 40% / .5)', /250 60%/);
gone('oklch', '--c:oklch(62.3% .214 259.8)', /259\.8/);
gone('oklch with alpha', '--c:oklch(60.6% .25 292.7 / 40%)', /292\.7/);
gone('oklch at the chroma limit (slate)', '--c:oklch(70.4% .04 255)', /255/);
gone('oklch just above the chroma limit', '--c:oklch(70.4% .036 255)', /255/);
same('oklch just below the chroma limit', 'x:oklch(70.4% .034 255)');
gone('uppercase function name', 'x:RGB(10,20,250)', /10,\s*20/);

// meaning and non-colours stay
same('red status', 'x:#ef4444;y:rgb(239,68,68)');
same('green status', 'x:#22c55e;y:oklch(70% .15 145)');
same('amber status', 'x:#f59e0b');
same('teal', 'x:#54ECE7');
same('pink oklch', 'x:oklch(65.6% .241 354.3)');
same('warm hsl', 'x:hsl(30,60%,50%)');
same('neutrals and the Arc palette', 'x:#26231f;y:#faf9f6;z:#75736c;w:#54453c');
same('HTML entity with six digits', 'a &#128199; b');
same('url fragment', 'a{fill:url(#3366ff)} b#3366ff');
same('rgb above 255', 'x:rgb(300,20,250)');

// stable and keeps the shape of the text
const sample = 'a{background:linear-gradient(100deg,#03040a 0%,#101d4c 45%,#5d35a0 100%);box-shadow:0 0 7px rgba(82,130,255,.64)}';
const once = recolorBlueHues(sample);
t('second run changes nothing', recolorBlueHues(once) === once);
t('same number of colour stops', (once.match(/#[0-9a-f]{6}/g) || []).length === 3);
t('replaceVendorBlue', replaceVendorBlue('var(--x,#4D6BFE)') === 'var(--x,#54453c)');

console.log(bad ? 'FAILED' : 'ALL PASS');
process.exit(bad ? 1 : 0);
