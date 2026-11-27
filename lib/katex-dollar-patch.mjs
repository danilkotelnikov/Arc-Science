// Patch micromark-extension-math single-dollar inline math tokenizer (Xg in vendor-DcuzkuQH.js)
// so currency values like "$1,000 ... $5k" or "$200; **Yes** for $4,800+" stay plain text
// while real LaTeX math ($x$, $$...$$, \(...\), \[...\]) continues to render via KaTeX.

const ORIGINAL_XG = 'function Xg(e){let n={}.singleDollarTextMath;return n==null&&(n=!0),{tokenize:r,resolve:Yg,previous:Zg,name:"mathText"};function r(a,i,s){let o=0,l,u;return c;function c(k){return a.enter("mathText"),a.enter("mathTextSequence"),h(k)}function h(k){return k===36?(a.consume(k),o++,h):o<2&&!n?s(k):(a.exit("mathTextSequence"),f(k))}function f(k){return k===null?s(k):k===36?(u=a.enter("mathTextSequence"),l=0,b(k)):k===32?(a.enter("space"),a.consume(k),a.exit("space"),f):X(k)?(a.enter("lineEnding"),a.consume(k),a.exit("lineEnding"),f):(a.enter("mathTextData"),d(k))}function d(k){return k===null||k===32||k===36||X(k)?(a.exit("mathTextData"),f(k)):(a.consume(k),d)}function b(k){return k===36?(a.consume(k),l++,b):l===o?(a.exit("mathTextSequence"),a.exit("mathText"),i(k)):(u.type="mathTextData",d(k))}}}';

// Guard rules applied only when opening sequence has a single "$" (o === 1):
// 1. Opening "$" must not follow ASCII alphanumeric (e.g. US$50, a$b).
// 2. Opening "$" must not be followed by EOF or markdown whitespace (e.g. "$ 5$").
// 3. Inside single-dollar math, consecutive "**" (markdown bold boundary) aborts mathText.
// 4. Closing "$" must not follow whitespace, or an opening/dash delimiter "(", "\"", "–", "—", "‘", "“".
// 5. Closing "$" must not be followed immediately by an ASCII digit (e.g. "$100-$200", "$1,000 ... $5k").
const PATCHED_XG = 'function Xg(e){let n={}.singleDollarTextMath;return n==null&&(n=!0),{tokenize:r,resolve:Yg,previous:Zg,name:"mathText"};function r(a,i,s){const q=this.previous;let o=0,l,u,p=!1,g=0,m=0;return c;function c(k){return a.enter("mathText"),a.enter("mathTextSequence"),h(k)}function h(k){return k===36?(a.consume(k),o++,h):o<2&&(!n||k===null||fe(k)||q!==null&&(q>=48&&q<=57||q>=65&&q<=90||q>=97&&q<=122))?s(k):(a.exit("mathTextSequence"),f(k))}function f(k){return k===null?s(k):k===36?(u=a.enter("mathTextSequence"),l=0,b(k)):oe(k)?(p=!0,g=k,m=0,a.enter("space"),a.consume(k),a.exit("space"),f):X(k)?(p=!0,g=k,m=0,a.enter("lineEnding"),a.consume(k),a.exit("lineEnding"),f):(a.enter("mathTextData"),d(k))}function d(k){return k===null||oe(k)||k===36||X(k)?(a.exit("mathTextData"),f(k)):(p=!1,g=k,m=k===42?m+1:0,o===1&&m>=2?s(k):(a.consume(k),d))}function b(k){return k===36?(a.consume(k),l++,b):l===o?(o===1&&(p||g===40||g===34||g===8211||g===8212||g===8216||g===8220||k!==null&&k>=48&&k<=57)?s(k):(a.exit("mathTextSequence"),a.exit("mathText"),i(k))):(p=!1,g=36,m=0,u.type="mathTextData",d(k))}}}';

export function patchKatexDollar(code, must = (c, m) => { if (!c) throw new Error(m); }) {
  const hits = code.split(ORIGINAL_XG).length - 1;
  must(hits === 1, `vendor mathText tokenizer Xg: expected 1 match, found ${hits}`);
  return code.replace(ORIGINAL_XG, () => PATCHED_XG);
}

export function applyKatexDollarPatch({ text, put, must, mustParse, report }) {
  const p = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/vendor-DcuzkuQH.js';
  const next = patchKatexDollar(text(p), must);
  mustParse(next, p);
  put(p, next);
  report.push('markdown math: single-dollar KaTeX tokenizer ignores currency ranges and prose delimiters');
}
