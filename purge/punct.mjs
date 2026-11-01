// Deterministic ASCII form of text that holds only CJK punctuation (no ideographs).
const MAP = {
  '　': ' ', '、': ',', '。': '.', '「': '"', '」': '"', '『': "'", '』': "'", '【': '[', '】': ']',
  '《': '"', '》': '"', '〈': '<', '〉': '>', '〔': '(', '〕': ')',
};
export function asciiPunct(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; const cc = c.codePointAt(0);
    let r;
    if (MAP[c] !== undefined) r = MAP[c];
    else if (cc >= 0xff01 && cc <= 0xff5e) r = String.fromCharCode(cc - 0xfee0);
    else r = c;
    out += r;
    // add a space after clause marks when text continues
    if (/[,;:!?.]/.test(r) && MAP[c] !== undefined || (cc >= 0xff01 && cc <= 0xff5e && /[,;:!?]/.test(r))) {
      const next = s[i + 1];
      if (next !== undefined && !/\s/.test(next) && !/[)\]"'>]/.test(next)) out += ' ';
    }
  }
  return out;
}
