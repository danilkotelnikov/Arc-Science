// Module prose_gate: the engine's prose gate in Rust, ported from plugins/arc-core/lib/prose-gate.js.
//
// No word list lives here. The lexicon (SPEC) is read at build time from the JS file, the one source, and the
// case files in plugins/arc-core/test are the contract: test/native-transition.test.mjs compares this port with the
// JS gate on every case, and the tests below run the fitted splits. Only the undercut rules and the zones are ported;
// repair, OVERCLAIM and verifyRewrite stay in the engine.
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const JS: &str = include_str!("../../../plugins/arc-core/lib/prose-gate.js");
const MAX_HITS: usize = 12;

pub struct Lexicon {
    sets: HashMap<String, HashSet<String>>,
}

impl Lexicon {
    fn set(&self, name: &str) -> Option<&HashSet<String>> {
        self.sets.get(name)
    }
    fn has(&self, name: &str, w: &str) -> bool {
        self.set(name).is_some_and(|s| s.contains(w))
    }
    fn starts(&self, name: &str, w: &str) -> bool {
        self.set(name).is_some_and(|s| s.iter().any(|p| w.starts_with(p.as_str())))
    }
    fn ends(&self, name: &str, w: &str) -> bool {
        self.set(name).is_some_and(|s| s.iter().any(|p| w.ends_with(p.as_str())))
    }
}

/// The SPEC text between "export const SPEC = `" and the closing backtick of prose-gate.js.
pub fn spec_text() -> &'static str {
    let open = "export const SPEC = `";
    let start = JS.find(open).expect("SPEC in prose-gate.js") + open.len();
    let end = start + JS[start..].find('`').expect("end of SPEC");
    &JS[start..end]
}

pub fn lexicon() -> &'static Lexicon {
    static LEX: OnceLock<Lexicon> = OnceLock::new();
    LEX.get_or_init(|| {
        let mut sets = HashMap::new();
        for line in spec_text().split('\n') {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 || parts[0].starts_with('#') {
                continue;
            }
            sets.insert(parts[0].to_string(), parts[1..].iter().map(|s| s.to_string()).collect());
        }
        Lexicon { sets }
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub form: &'static str,
    pub a: isize,
    pub b: isize,
    /// "block" for the clear core, "mark" for a reader (JS two bands, S049)
    pub band: &'static str,
    /// the reason for a mark: null-result, other-group, property, procedure, restriction or subject
    pub why: &'static str,
}

/// JS collector: a block hit replaces the marks it overlaps; marks never use up the cap of the blocks.
struct Coll {
    out: Vec<Hit>,
    blocks: usize,
    marks: usize,
}

impl Coll {
    fn new() -> Self {
        Coll { out: Vec::new(), blocks: 0, marks: 0 }
    }
    fn add(&mut self, form: &'static str, a: isize, b: isize, exc: Option<&'static str>, soft: Option<&'static str>, core: bool) {
        let band = if exc.is_none() && core { "block" } else { "mark" };
        let why = exc.unwrap_or(if band == "mark" { soft.unwrap_or("subject") } else { "" });
        if (band == "block" && self.blocks >= MAX_HITS) || (band == "mark" && self.marks >= MAX_HITS) {
            return;
        }
        let over: Vec<usize> = (0..self.out.len()).filter(|&k| a <= self.out[k].b && b >= self.out[k].a).collect();
        if over.iter().any(|&k| self.out[k].band == "block") || (band == "mark" && !over.is_empty()) {
            return;
        }
        for &k in over.iter().rev() {
            self.out.remove(k);
            self.marks -= 1;
        }
        self.out.push(Hit { form, a, b, band, why });
        if band == "block" {
            self.blocks += 1;
        } else {
            self.marks += 1;
        }
    }
    fn full(&self) -> bool {
        self.blocks >= MAX_HITS
    }
}

/// JS opensOf: a token opens a clause when punctuation stands between it and the token before.
fn clause_mark(c: char) -> bool {
    matches!(c, ',' | ';' | ':' | '(' | ')' | '\u{2013}' | '\u{2014}')
}

fn is_w(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// JS: replace(/\bcannot\b/g, 'can not') then replace(/n't\b/g, ' not'), on ASCII word boundaries.
fn expand_negations(lower: &str) -> String {
    let mut s = String::with_capacity(lower.len() + 8);
    let b = lower.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i..].starts_with(b"cannot") && (i == 0 || !is_w(b[i - 1])) && (i + 6 == b.len() || !is_w(b[i + 6])) {
            s.push_str("can not");
            i += 6;
            continue;
        }
        let ch = lower[i..].chars().next().unwrap();
        s.push(ch);
        i += ch.len_utf8();
    }
    let mut out = String::with_capacity(s.len() + 8);
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i..].starts_with(b"n't") && (i + 3 == b.len() || !is_w(b[i + 3])) {
            out.push_str(" not");
            i += 3;
            continue;
        }
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// English words: /[a-z]+(?:[-'][a-z]+)*|\d+(?:[.,]\d+)*%?/g over the lower-cased sentence.
fn is_run_cyr(c: char) -> bool {
    ('а'..='я').contains(&c) || "ёіјѕԁӏ".contains(c)
}

fn homoglyphs() -> &'static HashMap<char, char> {
    static MAP: OnceLock<HashMap<char, char>> = OnceLock::new();
    MAP.get_or_init(|| {
        let mut m = HashMap::new();
        if let Some(set) = lexicon().set("homoglyph") {
            for p in set {
                let mut cs = p.chars();
                if let (Some(a), Some(b)) = (cs.next(), cs.next()) {
                    m.insert(a, b);
                }
            }
        }
        m
    })
}

/// JS foldMixed: a run of Latin and Cyrillic letters that holds both scripts takes the Latin look-alike of each letter.
fn fold_mixed(lower: &str) -> String {
    let map = homoglyphs();
    let chars: Vec<char> = lower.chars().collect();
    let mut out = String::with_capacity(lower.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_lowercase() || is_run_cyr(chars[i]) {
            let s = i;
            while i < chars.len() && (chars[i].is_ascii_lowercase() || is_run_cyr(chars[i])) {
                i += 1;
            }
            let run = &chars[s..i];
            let mixed = run.iter().any(|c| c.is_ascii_lowercase()) && run.iter().any(|&c| is_run_cyr(c));
            for c in run {
                out.push(if mixed { *map.get(c).unwrap_or(c) } else { *c });
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

pub fn tokens_en(sentence: &str) -> Vec<String> {
    tokens_en_opens(sentence).0
}

/// The English tokens and the indexes of the tokens that open a clause after punctuation (JS tokensOf opens).
pub fn tokens_en_opens(sentence: &str) -> (Vec<String>, HashSet<isize>) {
    let lower = expand_negations(&fold_mixed(&sentence.to_lowercase().replace('\u{2019}', "'")));
    let b = lower.as_bytes();
    let mut out = Vec::new();
    let mut opens = HashSet::new();
    let mut prev_end: Option<usize> = None;
    let mut i = 0;
    while i < b.len() {
        let s = i;
        if b[i].is_ascii_lowercase() || b[i].is_ascii_digit() {
            if let Some(pe) = prev_end {
                if lower[pe..s].chars().any(clause_mark) {
                    opens.insert(out.len() as isize);
                }
            }
        }
        if b[i].is_ascii_lowercase() {
            while i < b.len() && b[i].is_ascii_lowercase() {
                i += 1;
            }
            while i + 1 < b.len() && (b[i] == b'-' || b[i] == b'\'') && b[i + 1].is_ascii_lowercase() {
                i += 1;
                while i < b.len() && b[i].is_ascii_lowercase() {
                    i += 1;
                }
            }
            out.push(lower[s..i].to_string());
            prev_end = Some(i);
        } else if b[i].is_ascii_digit() {
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
            while i + 1 < b.len() && (b[i] == b'.' || b[i] == b',') && b[i + 1].is_ascii_digit() {
                i += 1;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
            }
            if i < b.len() && b[i] == b'%' {
                i += 1;
            }
            out.push(lower[s..i].to_string());
            prev_end = Some(i);
        } else {
            i += 1;
        }
    }
    (out, opens)
}

fn is_cyr(c: char) -> bool {
    ('а'..='я').contains(&c) || c == 'ё' || ('А'..='Я').contains(&c) || c == 'Ё'
}

fn is_ru_word(c: char) -> bool {
    ('а'..='я').contains(&c) || c == 'ё' || c.is_ascii_lowercase() || c.is_ascii_digit()
}

/// Russian words: /[а-яёa-z0-9]+(?:-[а-яёa-z0-9]+)*/g over the lower-cased sentence.
pub fn tokens_ru(sentence: &str) -> Vec<String> {
    tokens_ru_opens(sentence).0
}

/// The Russian tokens and the indexes of the tokens that open a clause after punctuation.
pub fn tokens_ru_opens(sentence: &str) -> (Vec<String>, HashSet<isize>) {
    let chars: Vec<char> = sentence.to_lowercase().chars().collect();
    let mut out = Vec::new();
    let mut opens = HashSet::new();
    let mut prev_end: Option<usize> = None;
    let mut i = 0;
    while i < chars.len() {
        if !is_ru_word(chars[i]) {
            i += 1;
            continue;
        }
        let s = i;
        if let Some(pe) = prev_end {
            if chars[pe..s].iter().any(|&c| clause_mark(c)) {
                opens.insert(out.len() as isize);
            }
        }
        while i < chars.len() && is_ru_word(chars[i]) {
            i += 1;
        }
        while i + 1 < chars.len() && chars[i] == '-' && is_ru_word(chars[i + 1]) {
            i += 1;
            while i < chars.len() && is_ru_word(chars[i]) {
                i += 1;
            }
        }
        out.push(chars[s..i].iter().collect());
        prev_end = Some(i);
    }
    (out, opens)
}

struct Words<'a> {
    t: &'a [String],
    lx: &'a Lexicon,
}

impl<'a> Words<'a> {
    fn get(&self, i: isize) -> Option<&'a str> {
        if i >= 0 && (i as usize) < self.t.len() {
            Some(self.t[i as usize].as_str())
        } else {
            None
        }
    }
    fn n(&self) -> isize {
        self.t.len() as isize
    }
    fn has(&self, set: &str, i: isize) -> bool {
        self.get(i).is_some_and(|w| self.lx.has(set, w))
    }
    fn eq(&self, i: isize, s: &str) -> bool {
        self.get(i) == Some(s)
    }
    fn is_part(&self, i: isize) -> bool {
        self.get(i).is_some_and(|w| {
            self.lx.has("work_part", w) || ((w.ends_with("ed") || w.ends_with("en")) && w.len() > 4 && !self.lx.has("not_part", w))
        })
    }
    fn skip(&self, i: isize, max: usize) -> isize {
        let mut k = i;
        let mut n = 0;
        while n < max && self.has("filler", k) {
            k += 1;
            n += 1;
        }
        k
    }
}

/// JS clauseIndex: the clause start of every token and running counts of three word kinds (a word that is not bare, a mark of
/// another group, a word of the author or the project), built in one pass. A hit then costs O(1), so a sentence stays linear
/// however long its clause is (review of PR 36: a 30,000-word clause took seconds).
struct ClauseIndex {
    start: Vec<isize>,
    full: Vec<u32>,
    other: Vec<u32>,
    own: Vec<u32>,
}

impl ClauseIndex {
    fn new(
        n: isize,
        opens_at: impl Fn(isize) -> bool,
        full: impl Fn(isize) -> bool,
        other: impl Fn(isize) -> bool,
        own: impl Fn(isize) -> bool,
    ) -> Self {
        let len = n.max(0) as usize + 1;
        let mut ix = ClauseIndex { start: vec![0; len], full: vec![0; len], other: vec![0; len], own: vec![0; len] };
        for k in 0..len as isize {
            let u = k as usize;
            ix.start[u] = if k == 0 || opens_at(k) { k } else { ix.start[u - 1] };
            if u + 1 < len {
                ix.full[u + 1] = ix.full[u] + full(k) as u32;
                ix.other[u + 1] = ix.other[u] + other(k) as u32;
                ix.own[u + 1] = ix.own[u] + own(k) as u32;
            }
        }
        ix
    }
    fn clause_start(&self, a: isize) -> isize {
        if a > 0 && (a as usize) < self.start.len() {
            self.start[a as usize]
        } else {
            a
        }
    }
    /// How many words of one kind lie in s..a.
    fn count(&self, run: &[u32], s: isize, a: isize) -> u32 {
        let at = |x: isize| run[(x.max(0) as usize).min(run.len() - 1)];
        at(a) - at(s)
    }
}

/// Every place in one English sentence where the author announces work that is not done.
pub fn undercuts_en(t: &[String], opens: &HashSet<isize>) -> Vec<Hit> {
    let w = Words { t, lx: lexicon() };
    let n = w.n();
    let mut out = Coll::new();
    // JS clauseStart: back to the token after punctuation or after a conjunction
    let conj = ["and", "but", "while", "whereas", "so", "because", "although", "though"];
    let ci = ClauseIndex::new(
        n,
        |k| opens.contains(&k) || conj.iter().any(|c| w.eq(k - 1, c)),
        |k| !(w.has("aux", k) || w.has("filler", k) || w.has("status_now", k)),
        |k| w.has("other_mark", k) || w.eq(k, "others"),
        |k| w.has("first_person", k) || w.has("artifact", k) || w.has("work_noun", k) || w.has("own_word", k),
    );
    let clause_start = |a: isize| ci.clause_start(a);
    // JS condAfter and adverseNear: both stay inside the clause of the hit
    let cond_after = |end: isize| (end + 1..=end + 4).take_while(|&k| k < n && !opens.contains(&k)).any(|k| w.has("rule_cond", k));
    let rel_before = |start: isize| (start - 3..start).any(|k| k >= 0 && w.has("rel_front", k));
    let adverse_near = |a: isize, b: isize| (clause_start(a).max(a - 5)..=b).any(|k| w.has("adverse_noun", k));
    // JS nullSubject and otherActor: a null result ("No adverse events were reported") and work of other people (F102)
    // JS headOf: the last word of the subject before any preposition
    let head_of = |a: isize, b: isize| -> Option<&str> {
        let mut end = b;
        for k in a + 1..b {
            if w.has("prep", k) {
                end = k;
                break;
            }
        }
        if end > a {
            w.get(end - 1)
        } else {
            None
        }
    };
    // JS byUs and ourWork: "by us", "by our team" after a work verb
    let by_us = |k: isize| {
        let mut j = k + 1;
        while j <= k + 4 && j < n - 1 {
            if w.eq(j, "by") && w.has("first_person", j + 1) {
                return true;
            }
            j += 1;
        }
        false
    };
    let our_work = |k: isize| !w.has("outcome_part", k) && by_us(k);
    // JS nullAfterNo: only "no"; the head of the subject names an observation, and the verb reports one
    let null_after_no = |i: isize| {
        if !w.eq(i, "no") {
            return false;
        }
        let mut a = i + 1;
        while a <= i + 6 && a < n {
            if w.has("aux", a) {
                let part = w.skip(a + 1, 1);
                return head_of(i + 1, a).is_some_and(|h| w.lx.has("null_noun", h)) && w.has("observe_part", part) && !our_work(part);
            }
            a += 1;
        }
        false
    };
    // JS outcome: an outcome verb, or "reported" with adverse events
    let outcome = |k: isize, a: isize, b: isize| {
        w.has("outcome_part", k) || (w.eq(k, "reported") && [a, b].iter().any(|&x| w.eq(x, "adverse") || w.has("adverse_noun", x)))
    };
    // JS nullBeforeNot: "Adverse events were not observed"
    let null_before_not =
        |i: isize| w.has("aux", i - 1) && w.has("null_noun", i - 2) && outcome(w.skip(i + 1, 2), i - 2, i - 3) && !our_work(w.skip(i + 1, 2));
    // JS afterNeg, otherActorNot and otherActorAux: other people in the active perfect only, no first person before them
    let after_neg = |k: isize| {
        let mut j = k;
        while w.has("time_word", j) {
            j += 1;
        }
        w.get(j)
    };
    // JS markedOther: "other groups", "earlier studies" or "others", with no first-person word opening the noun phrase
    let marked_other = |a: isize| {
        (w.eq(a, "others") && !w.has("first_person", a - 1))
            || (w.has("other_actor", a) && w.has("other_mark", a - 1) && !w.has("first_person", a - 2))
    };
    let other_actor_not = |i: isize| w.has("perfect", i - 1) && marked_other(i - 2) && after_neg(i + 1) != Some("been");
    let other_actor_aux = |i: isize| marked_other(i - 1) && after_neg(i + 2) != Some("been");
    // JS core: the clause of the hit has no subject, or its subject is the author or the project
    let core = |a: isize, b: isize| {
        let s = clause_start(a);
        if ci.count(&ci.full, s, a) == 0 {
            return true;
        }
        if ci.count(&ci.other, s, a) > 0 {
            return false;
        }
        if ci.count(&ci.own, s, a) > 0 {
            return true;
        }
        by_us(b) || (w.has("un_part", a) && [1, 2].iter().any(|&d| w.has("artifact", b + d)))
    };
    // JS push: a procedure or a restricted noun is a mark; soft names the reason when only the subject keeps a hit out
    let push_soft = |out: &mut Coll, form: &'static str, a: isize, b: isize, exc: Option<&'static str>, soft: Option<&'static str>| {
        let e = exc.or(if cond_after(b) {
            Some("procedure")
        } else if rel_before(a) {
            Some("restriction")
        } else {
            None
        });
        out.add(form, a, b, e, soft, core(a, b));
    };
    let push = |out: &mut Coll, form: &'static str, a: isize, b: isize, exc: Option<&'static str>| push_soft(out, form, a, b, exc, None);
    let mut i: isize = 0;
    while i < n && !out.full() {
        let wd = w.get(i).unwrap();
        if w.has("neg_adv", i) {
            let k = w.skip(i + 1, 2);
            if w.has("work_part", k) {
                let why = if adverse_near(i, k) || null_before_not(i) {
                    Some("null-result")
                } else if wd == "never" && w.has("present_aux", i - 1) {
                    Some("property")
                } else if other_actor_not(i) {
                    Some("other-group")
                } else {
                    None
                };
                // outside the core, a present passive ("Calls are not recorded.") states a property
                let soft = if w.has("present_aux", i - 1) { Some("property") } else { None };
                push_soft(&mut out, "not-done", i, k, why, soft);
            }
        }
        if w.has("neg_det", i) {
            let mut j = i + 1;
            while j <= i + 6 && j < n {
                if !w.has("aux", j) {
                    j += 1;
                    continue;
                }
                let k = w.skip(j + 1, 1);
                if w.has("work_part", k) {
                    let why = if !w.has("past_aux", j) {
                        Some("property")
                    } else if adverse_near(i, k) || null_after_no(i) {
                        Some("null-result")
                    } else {
                        None
                    };
                    push(&mut out, "none-done", i, k, why);
                }
                break;
            }
            if wd == "no" {
                let mut j = i + 1;
                while j <= i + 3 && j < n {
                    if w.has("work_noun", j) {
                        push(&mut out, "no-result", i, j, None);
                        break;
                    }
                    j += 1;
                }
            }
        }
        if w.has("aux", i) {
            let k = w.skip(i + 1, 1);
            if w.has("work_part", k) && w.has("neg_det", k + 1) {
                push(&mut out, "done-nothing", i, k + 1, None);
            }
        }
        if wd == "what" && (w.has("aux", i + 1) || w.eq(i + 1, "remains") || w.eq(i + 1, "stays")) {
            let mut k = i + 2;
            let mut m = 0;
            while m < 2 && (w.has("filler", k) || w.eq(k, "to") || w.eq(k, "be")) {
                k += 1;
                m += 1;
            }
            if w.has("absent_adj", k) && !(w.eq(k, "open") && w.has("open_next", k + 1)) {
                push(&mut out, "what-missing", i, k, None);
            }
        }
        if wd == "only" {
            if w.has("only_part", i + 1) {
                push(&mut out, "only", i, i + 1, None);
            } else if (w.eq(i + 1, "a") || w.eq(i + 1, "an")) && w.has("only_noun", i + 2) {
                push(&mut out, "only", i, i + 2, None);
            } else if i == n - 1 && w.has("only_noun", i - 1) {
                push(&mut out, "only", i - 1, i, None);
            }
        }
        if w.has("un_part", i)
            && (w.has("aux", i - 1)
                || w.eq(i - 1, "still")
                || w.eq(i - 1, "remains")
                || w.eq(i - 1, "remain")
                || n <= 2
                || i == n - 1
                || ["and", "but", "so", "while", "yet", "because"].iter().any(|c| w.eq(i + 1, c))
                || [1, 2].iter().any(|&d| w.has("artifact", i + d) || w.has("work_noun", i + d)))
        {
            push(&mut out, "un-done", i, i, None);
        }
        if w.has("perfect", i) && w.has("neg_adv", i + 1) {
            let k = w.skip(i + 2, 2);
            // JS nullPerfect: "Adverse events have not been reported"
            let null_perfect = w.has("null_noun", i - 1) && after_neg(i + 2) == Some("been") && outcome(k, i - 1, i - 2);
            if w.is_part(k) && !w.has("percept", k) {
                let why = if w.has("adverse", k) || adverse_near(i, k) || null_perfect {
                    Some("null-result")
                } else if other_actor_aux(i) {
                    Some("other-group")
                } else {
                    None
                };
                push(&mut out, "not-done", i + 1, k, why);
            }
        }
        if w.has("neg_det", i) {
            let mut j = i + 1;
            while j <= i + 7 && j < n - 2 {
                if w.has("perfect", j) && w.eq(j + 1, "been") && w.is_part(j + 2) && !w.has("percept", j + 2) {
                    let why = if w.has("adverse", j + 2) || adverse_near(i, j + 2) || null_after_no(i) { Some("null-result") } else { None };
                    push(&mut out, "none-done", i, j + 2, why);
                    break;
                }
                j += 1;
            }
            if wd == "no" {
                let mut j = i + 1;
                while j <= i + 4 && j < n {
                    if w.has("work_part", j) && (j == n - 1 || w.has("status_now", j + 1)) {
                        let why = if null_after_no(i) { Some("null-result") } else { None };
                        push(&mut out, "none-done", i, j, why);
                        break;
                    }
                    j += 1;
                }
            }
        }
        if w.has("neg_adv", i) || w.has("neg_det", i) || wd == "cannot" {
            let other_or_null = if w.has("neg_adv", i) {
                if null_before_not(i) {
                    Some("null-result")
                } else if other_actor_not(i) {
                    Some("other-group")
                } else {
                    None
                }
            } else if wd == "no" && null_after_no(i) {
                Some("null-result")
            } else {
                None
            };
            let mut j = i + 1;
            while j <= i + 7 && j < n {
                let pair = match (w.get(j), w.get(j + 1)) {
                    (Some(x), Some(y)) => format!("{} {}", x, y),
                    _ => String::new(),
                };
                let three = match w.get(j + 2) {
                    Some(z) if !pair.is_empty() => format!("{} {}", pair, z),
                    _ => String::new(),
                };
                if w.has("status_now", j) {
                    push(&mut out, "not-yet", i, j, other_or_null);
                    break;
                }
                if ["so far", "to date", "for now"].contains(&pair.as_str()) {
                    push(&mut out, "not-yet", i, j + 1, other_or_null);
                    break;
                }
                if three == "at this stage" || pair == "at present" {
                    push(&mut out, "not-yet", i, j + 1, other_or_null);
                    break;
                }
                j += 1;
            }
        }
        if w.has("lack_verb", i) && (wd != "lacking" || w.has("aux", i - 1) || (w.eq(i - 1, "still") && w.has("aux", i - 2))) {
            push(&mut out, "lacks", i, i, None);
        }
        if w.has("await_verb", i) {
            let ends = ["ion", "ing", "ment", "review", "results", "data", "compute", "cluster", "approval", "funding"];
            let mut j = i + 1;
            while j <= i + 4 && j < n {
                if ends.iter().any(|e| w.get(j).unwrap().ends_with(e)) {
                    push(&mut out, "awaits", i, j, None);
                    break;
                }
                j += 1;
            }
        }
        if wd == "pending" && (i == n - 1 || w.has("aux", i - 1) || w.eq(i - 1, "still") || w.eq(i - 1, "remains")) {
            push(&mut out, "pending", i, i, None);
        }
        if wd == "work" && w.eq(i + 1, "in") && w.eq(i + 2, "progress") {
            push(&mut out, "in-progress", i, i + 2, None);
        }
        if wd == "early"
            && (w.eq(i + 1, "stage") || w.eq(i + 1, "stages"))
            && (i + 2 >= n || w.has("prep", i + 2) || w.eq(i + 2, "and") || w.eq(i + 2, "but") || w.eq(i + 2, "so"))
        {
            push(&mut out, "early-stage", i, i + 1, None);
        }
        if wd == "still" && (w.eq(i + 1, "need") || w.eq(i + 1, "needs")) && w.eq(i + 2, "to") {
            push(&mut out, "still-to-do", i, i + 2, None);
        }
        if ["remains", "remain", "needs", "need"].contains(&wd) && w.eq(i + 1, "to") && w.eq(i + 2, "be") && w.is_part(i + 3) {
            push(&mut out, "still-to-do", i, i + 3, None);
        }
        if ["yet", "still", "remains", "remain"].contains(&wd) && w.eq(i + 1, "to") && w.eq(i + 2, "be") && w.has("work_part", i + 3) {
            push(&mut out, "yet-to-be", i, i + 3, None);
        }
        if wd == "yet" && w.eq(i + 1, "to") {
            push(&mut out, "yet-to", i, i + 1, None);
        }
        i += 1;
    }
    out.out
}

/// Every place in one Russian sentence where the author announces work that is not done.
pub fn undercuts_ru(t: &[String], opens: &HashSet<isize>) -> Vec<Hit> {
    let w = Words { t, lx: lexicon() };
    let lx = lexicon();
    let n = w.n();
    let mut out = Coll::new();
    let starts = |set: &str, i: isize| w.get(i).is_some_and(|x| lx.starts(set, x));
    let is_cond = |k: isize, i: isize| {
        w.has("ru_cond", k)
            && !(w.eq(k, "пока") && (k == i - 1 || w.eq(k + 1, "не") || w.eq(k + 1, "нет")))
            && !(w.eq(k, "до") && (w.eq(k + 1, "сих") || w.eq(k + 1, "конца")))
    };
    let cond_near = |a: isize, b: isize| {
        ((a - 3).max(0)..a).any(|k| is_cond(k, a)) || (b + 1..=b + 4).take_while(|&k| k < n).any(|k| is_cond(k, -1))
    };
    let rel_before = |a: isize| ((a - 3).max(0)..a).any(|k| w.has("ru_rel", k));
    // JS undercutsRu core: no subject, a first-person word, an artifact or work noun, or "то, что ..."
    let conj = ["и", "но", "а", "однако"];
    let ci = ClauseIndex::new(
        n,
        |k| opens.contains(&k) || conj.iter().any(|c| w.eq(k - 1, c)),
        |k| !(w.has("ru_now", k) || w.has("ru_fill", k) || w.eq(k, "не") || w.eq(k, "нет")),
        |k| starts("ru_other", k),
        |k| w.has("ru_first", k) || starts("ru_artifact", k) || starts("ru_result", k),
    );
    let clause_start = |a: isize| ci.clause_start(a);
    let core = |a: isize| {
        let s = clause_start(a);
        if ci.count(&ci.full, s, a) == 0 {
            return true;
        }
        if ci.count(&ci.other, s, a) > 0 {
            return false;
        }
        if w.eq(s, "что") && w.eq(s - 1, "то") {
            return true;
        }
        ci.count(&ci.own, s, a) > 0
    };
    let push = |out: &mut Coll, form: &'static str, a: isize, b: isize, exc: Option<&'static str>| {
        let e = exc.or(if cond_near(a, b) {
            Some("procedure")
        } else if rel_before(a) {
            Some("restriction")
        } else {
            None
        });
        out.add(form, a, b, e, None, core(a));
    };
    let mut i: isize = 0;
    while i < n && !out.full() {
        let wd = w.get(i).unwrap();
        if w.has("ru_now", i) && (w.eq(i + 1, "не") || w.eq(i + 1, "нет")) {
            push(&mut out, "ru-not-yet", i, i + 1, None);
        }
        if wd == "до" && w.eq(i + 1, "сих") && w.eq(i + 2, "пор") && w.eq(i + 3, "не") {
            push(&mut out, "ru-not-yet", i, i + 3, None);
        }
        if wd == "не" {
            let mut k = i + 1;
            let mut m = 0;
            while m < 3 && w.has("ru_fill", k) {
                k += 1;
                m += 1;
            }
            if starts("ru_work", k) && w.get(k).is_some_and(|x| lx.ends("ru_done_end", x)) {
                push(&mut out, "ru-not-done", i, k, None);
            }
        }
        if w.has("ru_absent", i) {
            let harm = if [-3, -2, -1, 1, 2, 3].iter().any(|&d| starts("ru_adverse", i + d)) { Some("null-result") } else { None };
            let mut k = (i - 3).max(0);
            while k <= i + 3 && k < n {
                if k != i && starts("ru_result", k) {
                    push(&mut out, "ru-no-result", i.min(k), i.max(k), harm);
                    break;
                }
                k += 1;
            }
        }
        if w.has("ru_only", i) {
            if let Some(d) = [1, 2].into_iter().find(|&d| starts("ru_plan", i + d)) {
                push(&mut out, "ru-only", i, i + d, None);
            }
        }
        if wd == "предстоит" {
            push(&mut out, "ru-yet-to", i, i, None);
        }
        i += 1;
    }
    out.out
}

/// One sentence: the English hits on its Latin words, then the Russian hits when it holds a Cyrillic letter.
/// A Cyrillic letter can add a hit and can never remove one (JS readSentence).
pub fn undercuts_of(sentence: &str) -> Vec<Hit> {
    let (t, opens) = tokens_en_opens(sentence);
    let mut hits = undercuts_en(&t, &opens);
    if sentence.chars().any(is_cyr) {
        let (r, ropens) = tokens_ru_opens(sentence);
        hits.extend(undercuts_ru(&r, &ropens));
    }
    hits
}

fn unsure(t: &[String]) -> bool {
    let w = Words { t, lx: lexicon() };
    let n = w.n();
    for i in 0..n {
        if !(w.has("neg_adv", i) || w.eq(i, "no")) {
            continue;
        }
        let mut j = i + 1;
        while j <= i + 5 && j < n {
            if w.has("have_verb", j) {
                return true;
            }
            j += 1;
        }
    }
    false
}

/// JS \s: Unicode white space without U+0085, and with U+FEFF.
fn is_ws(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// JS: line.split(/(?<=[.!?;:])\s+/).
pub fn split_sentences(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut i = 0;
    while i < chars.len() {
        if is_ws(chars[i]) && i > 0 && ".!?;:".contains(chars[i - 1]) {
            let mut j = i;
            while j < chars.len() && is_ws(chars[j]) {
                j += 1;
            }
            out.push(std::mem::take(&mut cur));
            i = j;
            continue;
        }
        cur.push(chars[i]);
        i += 1;
    }
    out.push(cur);
    out
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(is_ws)
}

fn list_item(raw: &str) -> bool {
    // /^\s*(?:[-*+]|\d+[.)])\s+/
    let s = raw.trim_start_matches(is_ws);
    let rest = if let Some(r) = s.strip_prefix(['-', '*', '+']) {
        r
    } else {
        let d = s.chars().take_while(|c| c.is_ascii_digit()).count();
        if d == 0 {
            return false;
        }
        match s[d..].strip_prefix(['.', ')']) {
            Some(r) => r,
            None => return false,
        }
    };
    rest.starts_with(is_ws)
}

fn words_az(s: &str) -> Vec<String> {
    // lower-cased runs of [a-zа-яё]
    let lower = s.to_lowercase();
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in lower.chars() {
        if c.is_ascii_lowercase() || ('а'..='я').contains(&c) || c == 'ё' {
            cur.push(c);
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn is_limits_label(raw: &str) -> bool {
    let bare_owned: String = raw.chars().map(|c| if c == '*' || c == '_' { ' ' } else { c }).collect();
    let bare = js_trim(&bare_owned);
    let chars: Vec<char> = bare.chars().collect();
    // /[.!?;]\s+\S/ and /:\s*\S/
    for (i, &c) in chars.iter().enumerate() {
        if ".!?;".contains(c) {
            let mut j = i + 1;
            while j < chars.len() && is_ws(chars[j]) {
                j += 1;
            }
            if j > i + 1 && j < chars.len() {
                return false;
            }
        }
        if c == ':' {
            let mut j = i + 1;
            while j < chars.len() && is_ws(chars[j]) {
                j += 1;
            }
            if j < chars.len() {
                return false;
            }
        }
    }
    if list_item(raw) {
        return false;
    }
    let words = words_az(bare);
    names_limits_words(&words)
}

/// JS namesLimits: at most four words, and the first one is a limits word.
fn names_limits_words(words: &[String]) -> bool {
    !words.is_empty() && words.len() <= 4 && lexicon().has("limits_head", &words[0])
}

fn strip_code_and_urls(raw: &str) -> String {
    // /`([^`\n]+)`/g -> ' $1 ' (the words in a code span are read), then /https?:\/\/\S+/g -> ' '
    let chars: Vec<char> = raw.chars().collect();
    let mut s = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '`' {
            if let Some(off) = chars[i + 1..].iter().position(|&c| c == '`' || c == '\n') {
                if off > 0 && chars[i + 1 + off] == '`' {
                    s.push(' ');
                    s.extend(&chars[i + 1..i + 1 + off]);
                    s.push(' ');
                    i += off + 2;
                    continue;
                }
            }
        }
        s.push(chars[i]);
        i += 1;
    }
    // one pass: a scheme counts only with at least one non-space character after it, as in the JS regex
    let cs: Vec<char> = s.chars().collect();
    let at = |i: usize, p: &str| p.chars().enumerate().all(|(k, c)| cs.get(i + k) == Some(&c));
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < cs.len() {
        let scheme = if at(i, "https://") { 8 } else if at(i, "http://") { 7 } else { 0 };
        if scheme > 0 && i + scheme < cs.len() && !is_ws(cs[i + scheme]) {
            let mut j = i + scheme;
            while j < cs.len() && !is_ws(cs[j]) {
                j += 1;
            }
            out.push(' ');
            i = j;
            continue;
        }
        out.push(cs[i]);
        i += 1;
    }
    out
}

/// The lines of a text with their zone ("public", "report" or "limits"), as zoneLines in the engine.
pub fn zone_lines(text: &str, zone: &'static str) -> Vec<(usize, String, &'static str)> {
    let body = text.strip_prefix('\u{feff}').unwrap_or(text);
    let rows: Vec<&str> = body.split('\n').map(|r| r.strip_suffix('\r').unwrap_or(r)).collect();
    let mut out = Vec::new();
    let mut limits_level = 0usize;
    let mut plain = 0u8;
    // JS fence: the open fence, its character (` or ~) and its length
    let mut fence: Option<(char, usize)> = None;
    for (idx, raw) in rows.iter().enumerate() {
        // a fence line is no prose; the words inside a fence are read like any line, but a heading or a label there opens no
        // zone. ``` and ~~~ open a fence, only the same character at the same length or longer closes it, and ```code```
        // on one line opens nothing.
        let lead = raw.trim_start_matches(is_ws);
        if let Some(c @ ('`' | '~')) = lead.chars().next() {
            let len = lead.chars().take_while(|&x| x == c).count();
            if len >= 3 {
                let rest = &lead[len..];
                match fence {
                    None => {
                        if !(c == '`' && rest.contains('`')) {
                            fence = Some((c, len));
                        }
                    }
                    Some((fc, fl)) => {
                        if c == fc && len >= fl && js_trim(rest).is_empty() {
                            fence = None;
                        }
                    }
                }
                continue;
            }
        }
        let hashes = raw.chars().take_while(|&c| c == '#').count();
        // JS /^(#{1,6})\s+(.*)$/: the text after the space run may hold no CR, U+2028 or U+2029
        let heading = fence.is_none()
            && (1..=6).contains(&hashes)
            && raw[hashes..].starts_with(is_ws)
            && !raw[hashes..].trim_start_matches(is_ws).contains(['\r', '\u{2028}', '\u{2029}']);
        if heading {
            let is_limits = names_limits_words(&words_az(&raw[hashes..]));
            if is_limits {
                limits_level = hashes;
            } else if limits_level > 0 && hashes <= limits_level {
                limits_level = 0;
            }
            plain = 0;
            continue;
        }
        if js_trim(raw).is_empty() {
            if plain == 2 {
                plain = 0;
            }
            continue;
        }
        let list_follows = rows[idx + 1..].iter().find(|r| !js_trim(r).is_empty()).is_some_and(|r| list_item(r));
        if fence.is_none() && is_limits_label(raw) && list_follows {
            plain = 1;
            continue;
        }
        let indented = {
            let lead = raw.chars().take_while(|&c| is_ws(c)).count();
            lead >= 2 && raw.chars().nth(lead).is_some()
        };
        plain = if plain > 0 && (list_item(raw) || (plain == 2 && indented)) { 2 } else { 0 };
        let line = strip_code_and_urls(raw);
        if !js_trim(&line).is_empty() {
            out.push((idx + 1, line, if limits_level > 0 || plain == 2 { "limits" } else { zone }));
        }
    }
    out
}

/// The line and form of every undercut in the block band outside a limits zone (JS SELF_UNDERCUT).
pub fn findings(text: &str, zone: &'static str) -> Vec<(usize, &'static str)> {
    let mut out = Vec::new();
    for (no, line, z) in zone_lines(text, zone) {
        if z == "limits" {
            continue;
        }
        for s in split_sentences(&line) {
            for h in undercuts_of(&s).into_iter().filter(|h| h.band == "block") {
                out.push((no, h.form));
            }
        }
    }
    out
}

/// The verdict that tools/prose-gate.mjs scoreCases gives a case: "undercut", "review" or "clean".
pub fn verdict(text: &str, zone: &'static str) -> &'static str {
    let mut review = false;
    for (_, line, z) in zone_lines(text, zone) {
        for s in split_sentences(&line) {
            let hits = undercuts_of(&s);
            if z != "limits" && hits.iter().any(|h| h.band == "block") {
                return "undercut";
            }
            // the mark band (JS UNSURE_ABSENCE with a reason), and the older scope-or-gap mark when nothing else is found
            if (z != "limits" && !hits.is_empty()) || (z == "public" && hits.is_empty() && unsure(&tokens_en(&s))) {
                review = true;
            }
        }
    }
    if review {
        "review"
    } else {
        "clean"
    }
}

pub fn zone_of(name: &str) -> &'static str {
    match name {
        "limits" => "limits",
        "report" => "report",
        _ => "public",
    }
}
