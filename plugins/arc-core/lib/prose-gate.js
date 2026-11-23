// arc-core prose gate (2026-11-18). One deterministic check for text that speaks for the author.
//
// SELF_UNDERCUT  a sentence announces what the author has not done:
//                "... the evidence and what has not been done.", "Not trained.", "No simulation outcome yet."
//                Two bands (the owner's decision, 18.XI.2026: "Yes, mark them"). Only the clear core blocks: the author or the project as
//                the subject of unfinished work, or a bare status fragment. A match outside that core, and every match of
//                a null-result, other-group or property exception, is UNSURE_ABSENCE: a mark for a reader that never blocks,
//                and that no repair or rewrite removes. A word exception leaks (L013); a mark keeps the leak visible.
// OVERCLAIM      a sentence states as done what the given facts deny. It keeps a repair honest: a rewrite
//                that removes "Not trained." must not turn into "the trained model".
//
// The gate returns where the fault is, the sentence it saw and a sentence that is allowed. A repair loop needs
// all three (Ray and Goyal, arXiv:2607.14167, July 2026). A model judge can advise below this check; it never
// decides (design judgement, after Shaib et al., arXiv:2509.19163: model judges agreed with human labels at chance).
//
// SPEC is the one specification. Another implementation (Rust, Python) reads these lines and must pass
// test/prose-gate.cases.txt. English only: Russian needs its own lists.

export const SPEC = `
neg_adv     not never
neg_det     no nothing nobody none
filler      been yet even fully actually really still ever being
aux         is are was were has have had be
work_part   done built trained tested run started finished completed measured validated verified implemented published released benchmarked evaluated simulated executed demonstrated reported produced recorded
work_noun   result results outcome outcomes benchmark benchmarks
absent_adj  missing open undone unfinished outstanding left incomplete unavailable
perfect     has have had
percept     seen met encountered observed faced heard known needed
not_part    been even seven often open hidden given taken eleven dozen golden broken changed increased decreased declined risen grown fallen happened occurred
status_now  yet currently presently
lack_verb   lack lacks lacked lacking
await_verb  await awaits awaited awaiting
have_verb   include includes support supports provide provides offer offers cover covers handle handles exist exists
open_next   source access science data to for
un_part     untrained untested unbuilt unverified unvalidated unfinished unpublished unmeasured unimplemented unproven
only_part   planned designed derived proposed
only_noun   design plan proposal sketch draft prototype concept idea outline stub placeholder mock-up
rule_cond   before until unless without when if while once after
rel_front   that which who whose if when unless until whether
limits_head limits limitations limitation caveats caveat ограничения ограничение оговорки пределы
modal       to will would can could should must may might shall
bare_part   run
past_aux    has have had was were
adverse     harmed crashed failed lost injured damaged leaked breached compromised exposed infected killed corrupted hurt
adverse_noun error errors bug bugs incident incidents failure failures crash crashes complaint complaints breach breaches leak leaks death deaths
artifact    model models network networks weights checkpoint checkpoints version versions prototype prototypes pipeline pipelines system systems tool tools code design designs method methods baseline baselines module modules component components release releases feature features engine server dataset datasets claim claims
sure_form   not-done none-done no-result not-yet un-done done-nothing yet-to-be still-to-do
ru_fill     был была было были ещё еще так и ни разу конца
ru_work     обуч провер протестир тестир запуск запуст запущ провод провед измер реализ постро выполн оцен валидир опублик публик сравн собр внедр заверш разработ созда рассчит смоделир моделир сдела отлаж
ru_adverse  ошиб утеч сбо сомнен проблем инцидент жалоб уязвим
present_aux is are
null_noun   adverse event events effect effects difference differences change changes signal signals toxicity association associations correlation correlations interaction interactions reaction reactions sign signs mutation mutations increase decrease improvement improvements
other_actor groups studies labs teams competitors others literature researchers investigators papers
observe_part reported observed found detected measured seen noted recorded
outcome_part observed detected found seen noted
time_word   yet ever even still
other_mark  other earlier previous prior another
first_person we our us i my ours
own_word    project projects what
ru_first    мы наш наша наше наши нашего нашей нашем нашим нашими наших нам нас нами я мне меня мной мой моя моё мое мои
ru_artifact модел нейросет веса весов чекпоинт верси прототип конвейер пайплайн систем инструмент код дизайн метод модул компонент релиз функци движок движк сервер датасет набор утвержден проект
ru_other    друг предыдущ прежн ранн
homoglyph   аa еe оo рp сc уy хx іi јj ѕs кk ԁd ӏl
ru_done_end н на но ны ён ена ено ены ли ла ло лся лась лось лись
ru_now      пока ещё еще
ru_absent   нет отсутствует отсутствуют отсутствие отсутствуют
ru_result   результат бенчмарк сравнени валидаци эксперимент измерени публикаци оценк проверк тестировани обучени
ru_only     только лишь
ru_plan     проект план замысел набросок концепц черновик прототип эскиз
ru_cond     если когда пока до после перед прежде без
ru_rel      который которая которое которые которых которой которым чтобы
prep        of on in for with from at by across under over about into within than
stop       that this with from have been were they their there which what when will would could should also only into over under more most than then them these those each every some such very much many about after before does make made
weights     SELF_UNDERCUT=3 OVERCLAIM=5 MIXED_SCRIPT=3
`;

function parseSpec(spec) {
  const out = {};
  for (const line of spec.split('\n')) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts[0].startsWith('#')) continue;
    out[parts[0]] = new Set(parts.slice(1));
  }
  return out;
}

const L = parseSpec(SPEC);
const WEIGHTS = Object.fromEntries([...L.weights].map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
export const ALLOWED_HINT = 'State what exists and what comes next. Put a limit beside the claim that it limits, with its reason, or in the limits section.';
export const MARK_HINT = 'A reader decides. Keep it when it states a result, a property or the work of others; rewrite it when it announces work of the author that is not done.';

const WORD = /[a-z]+(?:[-'][a-z]+)*|\d+(?:[.,]\d+)*%?/g;
const SENTENCE_END = /(?<=[.!?;:])\s+/;
const MAX_HITS = 12;   // findings per sentence; more says nothing new and costs time on hostile text
const isPart = (w) => Boolean(w) && (L.work_part.has(w) || (/(?:ed|en)$/.test(w) && w.length > 4 && !L.not_part.has(w)));

// A word that mixes Latin and Cyrillic letters takes the Latin look-alike of each Cyrillic letter, so a homoglyph cannot
// hide an English word from the rules (F100). Each pair keeps the length, so places in the sentence stay right.
const HOMO = new Map([...L.homoglyph].map((p) => [p[0], p[1]]));
const RUN = /[a-zа-яёіјѕԁӏ]+/g;
const isMixed = (w) => /[a-z]/.test(w) && /[а-яёіјѕԁӏ]/.test(w);
const foldMixed = (lower) => lower.replace(RUN, (w) => (isMixed(w) ? [...w].map((c) => HOMO.get(c) || c).join('') : w));
const mixedWords = (sentence) => (sentence.toLowerCase().match(RUN) || []).filter(isMixed);

// The token indexes that open a clause after punctuation: "Tested on Windows, not on Linux" opens a clause at "not".
const CLAUSE_MARK = /[,;:()–—]/;
function opensOf(lower, words, at) {
  const opens = new Set();
  for (let j = 1; j < words.length; j += 1) if (CLAUSE_MARK.test(lower.slice(at[j - 1] + words[j - 1].length, at[j]))) opens.add(j);
  return opens;
}

// The clause start of every token and running counts of word kinds, built in one pass. clauseStart(a) and count(kind, s, a)
// then cost O(1), so a sentence stays linear however long its clause is (review of PR 36: a 30,000-word clause took seconds).
// opensAt(k) says that a clause opens at token k, after punctuation or after a conjunction.
function clauseIndex(t, opensAt, kinds) {
  const start = new Int32Array(t.length + 1);
  const run = Object.fromEntries(Object.keys(kinds).map((name) => [name, new Int32Array(t.length + 1)]));
  for (let k = 0; k <= t.length; k += 1) {
    start[k] = k === 0 || opensAt(k) ? k : start[k - 1];
    if (k < t.length) for (const [name, test] of Object.entries(kinds)) run[name][k + 1] = run[name][k] + (test(t[k]) ? 1 : 0);
  }
  return { clauseStart: (a) => (a > 0 && a <= t.length ? start[a] : a), count: (name, s, a) => run[name][a] - run[name][s] };
}

function tokensOf(sentence) {
  const lower = foldMixed(sentence.toLowerCase().replace(/’/g, "'")).replace(/\bcannot\b/g, 'can not').replace(/n't\b/g, ' not');
  const words = [];
  const at = [];
  for (const m of lower.matchAll(WORD)) { words.push(m[0]); at.push(m.index); }
  return { words, at, opens: opensOf(lower, words, at), shifted: lower.length !== sentence.length };
}

// A hit blocks when it is in the clear core; any other hit is a mark. `why` names the reason for a mark.
const CONJ = new Set(['and', 'but', 'while', 'whereas', 'so', 'because', 'although', 'though']);
// The marks of the exceptions (scope item 2): a rewrite keeps the clause of such a mark. A 'subject' mark may be an undercut.
const HELD = new Set(['null-result', 'other-group', 'property', 'procedure', 'restriction']);
const isBlock = (h) => h.band === 'block';
const isMark = (h) => h.band === 'mark';
// Collect hits in two bands. A block hit replaces the marks it overlaps; marks never use up the cap of the blocks.
function collector(core) {
  const out = [];
  let blocks = 0;
  let marks = 0;
  // exc: the exception that makes a mark; soft: the reason when only the subject keeps a hit out of the core; from: the
  // first token of the clause of the hit, so a rewrite can be held to the clause of a mark
  const push = (form, a, b, exc, soft = null, from = a) => {
    const band = exc ? 'mark' : core(a, b) ? 'block' : 'mark';
    const why = exc || (band === 'mark' ? soft || 'subject' : null);
    if (band === 'block' ? blocks >= MAX_HITS : marks >= MAX_HITS) return;   // the caps keep the cost linear on hostile text (F091)
    const over = out.filter((h) => a <= h.b && b >= h.a);
    if (over.some(isBlock) || (band === 'mark' && over.length)) return;
    for (const h of over) { out.splice(out.indexOf(h), 1); marks -= 1; }
    out.push({ form, a, b, band, why, from });
    if (band === 'block') blocks += 1; else marks += 1;
  };
  return { out, push, full: () => blocks >= MAX_HITS };
}

// Every place in one sentence where the author may announce work that is not done. Token indexes, both ends inclusive.
// Each hit carries its band: 'block' for the clear core, 'mark' for the rest, with `why` naming the reason for a mark.
function undercuts(t, opens = new Set()) {
  const has = (set, i) => i >= 0 && i < t.length && set.has(t[i]);
  const skip = (i, max) => { let k = i; let n = 0; while (n < max && has(L.filler, k)) { k += 1; n += 1; } return k; };
  // "No model is trained before the split is frozen" states a procedure. It is no status.
  const condAfter = (end) => { for (let k = end + 1; k <= end + 4 && k < t.length && !opens.has(k); k += 1) if (L.rule_cond.has(t[k])) return true; return false; };
  // "A claim that is not tested stays on the lowest rung" restricts a noun. It is no status.
  const relBefore = (start) => { for (let k = start - 1; k >= start - 3 && k >= 0; k -= 1) if (L.rel_front.has(t[k])) return true; return false; };
  // "No errors have been reported", "the service has never crashed": a missing harm is a result, not missing work (F094)
  const adverseNear = (a, b) => { for (let k = Math.max(clauseStart(a), a - 5); k <= b; k += 1) if (L.adverse_noun.has(t[k])) return true; return false; };
  // A null result (F102): the head of the subject names an observation and the verb reports one. "No adverse events were
  // reported" and "no change in binding was measured" are results; "no toxicity assay has been run" (head: assay) and
  // "no changes have been tested" (verb: tested) announce missing work. The head is the last word before any preposition.
  // a preposition right after "no" belongs to the noun ("no in vivo effects"), so the cut starts at the second word
  const headOf = (words) => { const cut = words.findIndex((w, k) => k > 0 && L.prep.has(w)); const h = cut >= 0 ? words.slice(0, cut) : words; return h[h.length - 1]; };
  // "by us", "by our team" after a work verb make the missing measurement the authors' own (review wf_d9f77b04-4ab)
  const byUs = (k) => { for (let j = k + 1; j <= k + 4 && j < t.length - 1; j += 1) if (t[j] === 'by' && has(L.first_person, j + 1)) return true; return false; };
  const ourWork = (k) => !has(L.outcome_part, k) && byUs(k);
  // only "no" opens a null result; "none of the effects were measured" says the authors measured none of them
  const nullAfterNo = (i) => {
    if (t[i] !== 'no') return false;
    for (let a = i + 1; a <= i + 6 && a < t.length; a += 1) {
      if (!L.aux.has(t[a])) continue;
      const k = skip(a + 1, 1);
      return L.null_noun.has(headOf(t.slice(i + 1, a))) && has(L.observe_part, k) && !ourWork(k);
    }
    return false;
  };
  // After "not" the verb must report an outcome: "Adverse events were not observed" is a result; "Toxicity was not measured"
  // says a measurement was not made. "Reported" counts only for adverse events ("Adverse events were not reported").
  const outcome = (k, a, b) => has(L.outcome_part, k) || (t[k] === 'reported' && [a, b].some((x) => t[x] === 'adverse' || has(L.adverse_noun, x)));
  const nullBeforeNot = (i) => has(L.aux, i - 1) && L.null_noun.has(t[i - 2]) && outcome(skip(i + 1, 2), i - 2, i - 3) && !ourWork(skip(i + 1, 2));
  // Work of other people (F102), only in the active perfect: "Earlier groups have not measured the off-rate". A passive
  // ("studies have not been run", "studies were not run") names the authors' own missing work. A first-person word in the
  // determiner slot ("Our groups have not ...") makes the actor the authors.
  const afterNeg = (k) => { let j = k; while (has(L.time_word, j)) j += 1; return t[j]; };
  // The actor must be marked as other right before it ("other groups", "earlier studies") or be "others", and the noun phrase
  // must not open with a first-person word ("our earlier studies"). "Clinical studies", "our pilot studies" and "our two
  // teams" carry no marker, so they stay the authors'. A framing clause ("We note that other groups ...") does not count.
  const markedOther = (a) => (t[a] === 'others' && !has(L.first_person, a - 1))
    || (L.other_actor.has(t[a]) && has(L.other_mark, a - 1) && !has(L.first_person, a - 2));
  const otherActorNot = (i) => has(L.perfect, i - 1) && markedOther(i - 2) && afterNeg(i + 1) !== 'been';   // at "not"
  const otherActorAux = (i) => markedOther(i - 1) && afterNeg(i + 2) !== 'been';                             // at "have"
  // The clear core (the owner's decision, 18.XI.2026). The clause of the hit has no subject ("Not trained.", "Has not been run.",
  // ", not yet benchmarked."), or its subject is the author or the project: a first-person word, an artifact or work noun,
  // "project", or a free relative "what" ("... and what has not been done"). A subject marked as another group is no core.
  const bare = (w) => L.aux.has(w) || L.filler.has(w) || L.status_now.has(w);
  const { clauseStart, count } = clauseIndex(t, (k) => opens.has(k) || CONJ.has(t[k - 1]), {
    full: (w) => !bare(w),
    other: (w) => L.other_mark.has(w) || w === 'others',
    own: (w) => L.first_person.has(w) || L.artifact.has(w) || L.work_noun.has(w) || L.own_word.has(w),
  });
  const core = (a, b) => {
    const s = clauseStart(a);
    if (!count('full', s, a)) return true;
    if (count('other', s, a)) return false;
    if (count('own', s, a)) return true;
    return byUs(b) || (L.un_part.has(t[a]) && [1, 2].some((n) => has(L.artifact, b + n)));   // "an untrained model"
  };
  const { out, push: add, full } = collector(core);
  // A procedure ("No model is trained before the split is frozen") and a restricted noun ("A claim that is not tested
  // stays on the lowest rung") state a property of the design: a mark.
  const push = (form, a, b, exc = null, soft = null) => add(form, a, b, exc || (condAfter(b) ? 'procedure' : relBefore(a) ? 'restriction' : null), soft, clauseStart(a));
  for (let i = 0; i < t.length && !full(); i += 1) {
    const w = t[i];
    if (L.neg_adv.has(w)) {                                   // not (yet) trained, never been run
      const k = skip(i + 1, 2);
      // "is never published", "is never run as root" promise a property in the present tense (F101); outside the core, a
      // present passive ("Calls are not recorded.") states a property too
      if (has(L.work_part, k)) {
        push('not-done', i, k, adverseNear(i, k) || nullBeforeNot(i) ? 'null-result' : w === 'never' && has(L.present_aux, i - 1) ? 'property' : otherActorNot(i) ? 'other-group' : null,
          has(L.present_aux, i - 1) ? 'property' : null);
      }
    }
    if (L.neg_det.has(w)) {                                   // nothing has been run, no model was trained; "nothing is executed remotely" is a property (F094)
      for (let j = i + 1; j <= i + 6 && j < t.length; j += 1) {
        if (!L.aux.has(t[j])) continue;
        const k = skip(j + 1, 1);
        if (has(L.work_part, k)) push('none-done', i, k, !L.past_aux.has(t[j]) ? 'property' : adverseNear(i, k) || nullAfterNo(i) ? 'null-result' : null);
        break;
      }
      if (w === 'no') {                                       // no simulation result, no outcome yet
        for (let j = i + 1; j <= i + 3 && j < t.length; j += 1) if (L.work_noun.has(t[j])) { push('no-result', i, j); break; }
      }
    }
    if (L.aux.has(w)) {                                       // have run nothing
      const k = skip(i + 1, 1);
      if (has(L.work_part, k) && has(L.neg_det, k + 1)) push('done-nothing', i, k + 1);
    }
    if (w === 'what' && (has(L.aux, i + 1) || t[i + 1] === 'remains' || t[i + 1] === 'stays')) {   // what is still missing
      let k = i + 2; let n = 0;
      while (n < 2 && (has(L.filler, k) || t[k] === 'to' || t[k] === 'be')) { k += 1; n += 1; }
      if (has(L.absent_adj, k) && !(t[k] === 'open' && has(L.open_next, k + 1))) push('what-missing', i, k);
    }
    if (w === 'only') {                                       // only planned, only a design, plan only
      if (has(L.only_part, i + 1)) push('only', i, i + 1);
      else if ((t[i + 1] === 'a' || t[i + 1] === 'an') && has(L.only_noun, i + 2)) push('only', i, i + 2);
      else if (i === t.length - 1 && has(L.only_noun, i - 1)) push('only', i - 1, i);
    }
    // untrained: as a status ("is untrained", "Untrained.") or on a work thing ("an untrained model"); "the untrained eye" is no status (F094)
    // ...and at the end of a clause: "Linux and macOS untested.", "real store untested; ..." (seen in the benchmark of 18.XI.2026)
    if (L.un_part.has(w) && (has(L.aux, i - 1) || ['still', 'remains', 'remain'].includes(t[i - 1]) || t.length <= 2
      || i === t.length - 1 || ['and', 'but', 'so', 'while', 'yet', 'because'].includes(t[i + 1])
      || [1, 2].some((n) => has(L.artifact, i + n) || has(L.work_noun, i + n)))) push('un-done', i, i);
    if (L.perfect.has(w) && has(L.neg_adv, i + 1)) {          // have not finalized, has never been optimised: denied work in the perfect tense
      const k = skip(i + 2, 2);
      const nullPerfect = L.null_noun.has(t[i - 1]) && afterNeg(i + 2) === 'been' && outcome(k, i - 1, i - 2);   // "Adverse events have not been reported"
      if (isPart(t[k]) && !L.percept.has(t[k])) {
        push('not-done', i + 1, k, L.adverse.has(t[k]) || adverseNear(i, k) || nullPerfect ? 'null-result' : otherActorAux(i) ? 'other-group' : null);
      }
    }
    if (L.neg_det.has(w)) {                                   // no tests have been performed; with no prototype built
      for (let j = i + 1; j <= i + 7 && j < t.length - 2; j += 1) {
        if (L.perfect.has(t[j]) && t[j + 1] === 'been' && isPart(t[j + 2]) && !L.percept.has(t[j + 2])) {
          push('none-done', i, j + 2, L.adverse.has(t[j + 2]) || adverseNear(i, j + 2) || nullAfterNo(i) ? 'null-result' : null);
          break;
        }
      }
      if (w === 'no') for (let j = i + 1; j <= i + 4 && j < t.length; j += 1) if (L.work_part.has(t[j]) && (j === t.length - 1 || L.status_now.has(t[j + 1]))) { push('none-done', i, j, nullAfterNo(i) ? 'null-result' : null); break; }
    }
    // does not yet support, not available so far: a status, with its time word; a null result or other people's work is a mark (F102)
    if (L.neg_adv.has(w) || L.neg_det.has(w) || w === 'cannot') {
      const otherOrNull = L.neg_adv.has(w) ? (nullBeforeNot(i) ? 'null-result' : otherActorNot(i) ? 'other-group' : null) : w === 'no' && nullAfterNo(i) ? 'null-result' : null;
      for (let j = i + 1; j <= i + 7 && j < t.length; j += 1) {
        const pair = `${t[j]} ${t[j + 1]}`;
        const three = `${pair} ${t[j + 2]}`;
        if (L.status_now.has(t[j])) { push('not-yet', i, j, otherOrNull); break; }
        if (['so far', 'to date', 'for now'].includes(pair)) { push('not-yet', i, j + 1, otherOrNull); break; }
        if (['at this stage', 'at present'].includes(three) || pair === 'at present') { push('not-yet', i, j + 1, otherOrNull); break; }
      }
    }
    // we lack a benchmark, the module is still lacking tests; "mice lacking TNF" names a group (F094)
    if (L.lack_verb.has(w) && (w !== 'lacking' || has(L.aux, i - 1) || (t[i - 1] === 'still' && has(L.aux, i - 2)))) push('lacks', i, i);
    if (L.await_verb.has(w)) {                                // awaits stress testing, await cluster execution
      for (let j = i + 1; j <= i + 4 && j < t.length; j += 1) if (/(ion|ing|ment|review|results|data|compute|cluster|approval|funding)$/.test(t[j])) { push('awaits', i, j); break; }
    }
    if (w === 'pending' && (i === t.length - 1 || has(L.aux, i - 1) || t[i - 1] === 'still' || t[i - 1] === 'remains')) push('pending', i, i);
    if (w === 'work' && t[i + 1] === 'in' && t[i + 2] === 'progress') push('in-progress', i, i + 2);
    // at an early stage (of work); "early stage breast cancer" is a class (F094)
    if (w === 'early' && (t[i + 1] === 'stage' || t[i + 1] === 'stages') && (i + 2 >= t.length || has(L.prep, i + 2) || ['and', 'but', 'so'].includes(t[i + 2]))) push('early-stage', i, i + 1);
    if (w === 'still' && (t[i + 1] === 'need' || t[i + 1] === 'needs') && t[i + 2] === 'to') push('still-to-do', i, i + 2);
    if ((w === 'remains' || w === 'remain' || w === 'needs' || w === 'need') && t[i + 1] === 'to' && t[i + 2] === 'be' && isPart(t[i + 3])) push('still-to-do', i, i + 3);
    if ((w === 'yet' || w === 'still' || w === 'remains' || w === 'remain') && t[i + 1] === 'to' && t[i + 2] === 'be' && has(L.work_part, i + 3)) push('yet-to-be', i, i + 3);
    if (w === 'yet' && t[i + 1] === 'to') push('yet-to', i, i + 1);                       // has yet to optimise; after yet-to-be, which names the work
  }
  return out;
}

// ---- Russian. A sentence with a Cyrillic letter takes this path. Its own lists live in the ru_ lines of SPEC.
const CYR = /[а-яё]/i;
const WORD_RU = /[а-яёa-z0-9]+(?:-[а-яёa-z0-9]+)*/g;
export const ALLOWED_HINT_RU = 'Скажите, что есть и что будет дальше. Ограничение поставьте рядом с утверждением, которое оно ограничивает, или в раздел ограничений.';
const startsWithAny = (w, set) => Boolean(w) && [...set].some((s) => w.startsWith(s));
const endsWithAny = (w, set) => Boolean(w) && [...set].some((s) => w.endsWith(s));

function tokensRu(sentence) {
  const lower = sentence.toLowerCase();
  const words = [];
  const at = [];
  for (const m of lower.matchAll(WORD_RU)) { words.push(m[0]); at.push(m.index); }
  return { words, at, opens: opensOf(lower, words, at), shifted: lower.length !== sentence.length };
}

// "Модель пока не обучена", "Ничего не запускали", "Результатов пока нет", "Это только проект", "Нам предстоит обучить".
// "Пока модель не обучена, ..." is a condition, and "модель, которая не обучена, ..." restricts a noun: both are marks.
const CONJ_RU = new Set(['и', 'но', 'а', 'однако']);
function undercutsRu(t, opens = new Set()) {
  const has = (set, i) => i >= 0 && i < t.length && set.has(t[i]);
  // The clear core, as in English: no subject before the hit, or a first-person word, an artifact or a work noun of the
  // project, or the free relative "то, что ..." ("... и то, что ещё не сделано"). A subject marked as other is no core.
  const { clauseStart, count } = clauseIndex(t, (k) => opens.has(k) || CONJ_RU.has(t[k - 1]), {
    full: (w) => !(L.ru_now.has(w) || L.ru_fill.has(w) || w === 'не' || w === 'нет'),
    other: (w) => startsWithAny(w, L.ru_other),
    own: (w) => L.ru_first.has(w) || startsWithAny(w, L.ru_artifact) || startsWithAny(w, L.ru_result),
  });
  const core = (a) => {
    const s = clauseStart(a);
    if (!count('full', s, a)) return true;
    if (count('other', s, a)) return false;
    if (t[s] === 'что' && t[s - 1] === 'то') return true;
    return count('own', s, a) > 0;
  };
  const { out, push: add, full } = collector(core);
  // "пока не" and "до сих пор", "до конца" mark a status; "пока модель не ...", "до заморозки" mark a condition
  const isCond = (k, i) => has(L.ru_cond, k) && !(t[k] === 'пока' && (k === i - 1 || t[k + 1] === 'не' || t[k + 1] === 'нет'))
    && !(t[k] === 'до' && (t[k + 1] === 'сих' || t[k + 1] === 'конца'));
  const condNear = (a, b) => {
    for (let k = Math.max(0, a - 3); k < a; k += 1) if (isCond(k, a)) return true;
    for (let k = b + 1; k <= b + 4 && k < t.length; k += 1) if (isCond(k, -1)) return true;
    return false;
  };
  const relBefore = (a) => { for (let k = Math.max(0, a - 3); k < a; k += 1) if (has(L.ru_rel, k)) return true; return false; };
  const push = (form, a, b, exc = null) => add(form, a, b, exc || (condNear(a, b) ? 'procedure' : relBefore(a) ? 'restriction' : null), null, clauseStart(a));
  for (let i = 0; i < t.length && !full(); i += 1) {
    const w = t[i];
    if (has(L.ru_now, i) && (t[i + 1] === 'не' || t[i + 1] === 'нет')) push('ru-not-yet', i, i + 1);
    if (w === 'до' && t[i + 1] === 'сих' && t[i + 2] === 'пор' && t[i + 3] === 'не') push('ru-not-yet', i, i + 3);
    if (w === 'не') {
      let k = i + 1; let n = 0;
      while (n < 3 && has(L.ru_fill, k)) { k += 1; n += 1; }
      if (startsWithAny(t[k], L.ru_work) && endsWithAny(t[k], L.ru_done_end)) push('ru-not-done', i, k);
    }
    // "Результатов нет" is missing work; "утечек нет", "нет сомнений" report an absent harm or doubt (F101): a mark
    if (has(L.ru_absent, i)) {
      const harm = [-3, -2, -1, 1, 2, 3].some((d) => startsWithAny(t[i + d], L.ru_adverse)) ? 'null-result' : null;
      for (let k = Math.max(0, i - 3); k <= i + 3 && k < t.length; k += 1) if (k !== i && startsWithAny(t[k], L.ru_result)) { push('ru-no-result', Math.min(i, k), Math.max(i, k), harm); break; }
    }
    if (has(L.ru_only, i) && [1, 2].some((n) => startsWithAny(t[i + n], L.ru_plan))) push('ru-only', i, i + ([1, 2].find((n) => startsWithAny(t[i + n], L.ru_plan))));
    if (w === 'предстоит') push('ru-yet-to', i, i);
  }
  return out;
}

// Every sentence takes the English rules on its Latin words, and a sentence with Cyrillic letters also takes the Russian
// rules. A Cyrillic letter or a Russian aside can add a finding; it can never remove one (F100).
function readSentence(sentence) {
  const en = tokensOf(sentence);
  const ru = CYR.test(sentence) ? tokensRu(sentence) : null;
  return { en, enHits: undercuts(en.words, en.opens), ru, ruHits: ru ? undercutsRu(ru.words, ru.opens) : [], words: ru ? ru.words.length : en.words.length };
}

// A sentence that may announce missing work and may state a scope: "does not include a visual interface", "no data exists".
// A script cannot tell the two apart, so the gate marks the sentence for a reader and does not block it.
function unsure(t) {
  for (let i = 0; i < t.length; i += 1) {
    if (!(L.neg_adv.has(t[i]) || t[i] === 'no')) continue;
    for (let j = i + 1; j <= i + 5 && j < t.length; j += 1) if (L.have_verb.has(t[j])) return { form: 'scope-or-gap', a: i, b: j };
  }
  return null;
}

// The work that the facts deny: the participle, and the head nouns of the clause that it denies. The head stops at the
// first preposition: "A real store of one million cards has not been measured" denies the store, not the cards (F088).
// An empty noun set ("Not trained.") denies the work for every subject.
// ponytail: clauses split at punctuation and conjunctions, with no grammar. A parser is the upgrade when a wrong mark appears.
const CLAUSE = /[,;:]\s+|\s(?:and|but|while|whereas|so)\s+/i;
// The participle that a denial names: "not trained" and "yet to be trained" name trained; "untrained" names it too (F096).
const DENIAL_FORMS = new Set(['not-done', 'none-done', 'done-nothing', 'un-done', 'yet-to-be', 'still-to-do']);
const deniedPart = (t, h) => {
  const span = t.slice(h.a, h.b + 1);
  const un = span.find((w) => L.un_part.has(w));
  if (un && L.work_part.has(un.slice(2))) return un.slice(2);
  return span.find((w) => L.work_part.has(w));
};
const headNouns = (words) => {
  const cut = words.findIndex((w) => L.prep.has(w));
  return (cut > 0 ? words.slice(0, cut) : words).filter((w) => w.length >= 4 && !L.stop.has(w) && !L.work_part.has(w) && !L.neg_det.has(w) && !L.filler.has(w) && !L.aux.has(w));
};
// The denials, grouped by their participle. At most MAX_DENIALS are read, so a long facts text costs little (F101). When
// one more denial follows, the map is marked `truncated` and check() reports it (review of PR 35): no denial goes unread
// without notice.
const MAX_DENIALS = 300;
function deniedBy(factsText) {
  const byPart = new Map();
  let n = 0;
  for (const sentence of String(factsText || '').split(/\n+/).flatMap((l) => l.split(SENTENCE_END))) {
    const before = [];   // head nouns of the clauses before this one, built once
    for (const clause of sentence.split(CLAUSE)) {
      const tok = tokensOf(clause);
      const t = tok.words;
      for (const h of undercuts(t, tok.opens)) {
        // a null result, other people's work, a property, a procedure or a restriction denies nothing; an unclear subject does
        if (!DENIAL_FORMS.has(h.form) || (h.why && h.why !== 'subject')) continue;
        const part = deniedPart(t, h);
        if (!part) continue;
        let nouns = headNouns(t.slice(0, h.form === 'un-done' ? h.a : h.b));
        if (h.form === 'un-done') nouns.push(...t.slice(h.b + 1, h.b + 3).filter((w) => L.artifact.has(w)));   // an untrained model
        // "The session, the seats and the engine are planned, not built": the subject stands in the clauses before
        if (!nouns.length) nouns = before;
        if (n >= MAX_DENIALS) { byPart.truncated = true; return byPart; }
        if (!byPart.has(part)) byPart.set(part, []);
        byPart.get(part).push(new Set(nouns));
        n += 1;
      }
      before.push(...headNouns(t));
    }
  }
  return byPart;
}

function overclaims(tok, sentence, hits, denied) {
  const out = [];
  const t = tok.words;
  if (!denied.size) return out;
  // A condition frame claims nothing: "once trained", "before any model is trained". The condition word must open the
  // clause of the work word, with no comma between them: "If anything, it is trained." is a claim (F097).
  const sameClause = (a, b, unsure) => (tok.shifted ? unsure : !/[,;:]/.test(sentence.slice(tok.at[a], tok.at[b])));
  const condFrame = (i) => L.rule_cond.has(t[i - 1])
    || (L.aux.has(t[i - 1]) && [2, 3, 4, 5].some((n) => L.rule_cond.has(t[i - n]) && sameClause(i - n, i, false)));
  for (let i = 0; i < t.length; i += 1) {
    if (hits.some((h) => i >= h.a && i <= h.b)) continue;
    // "still to run" names the work and claims nothing (F088)
    if (L.modal.has(t[i - 1]) || condFrame(i)) continue;
    const sets = denied.get(t[i]);
    if (!sets) continue;
    if (L.bare_part.has(t[i]) && ![1, 2].some((n) => L.aux.has(t[i - n]) || t[i - n] === 'been')) continue;   // "a benchmark run" is a noun
    if ([1, 2, 3].some((n) => L.neg_adv.has(t[i - n]) || L.neg_det.has(t[i - n]))) continue;
    // the denied object must stand in the clause of the work word: "tested on Windows 11, Linux and macOS untested"
    const near = [];
    for (let j = Math.max(0, i - 6); j <= Math.min(t.length - 1, i + 6); j += 1) if (sameClause(Math.min(i, j), Math.max(i, j), true)) near.push(t[j]);
    if (sets.some((nouns) => nouns.size === 0 || near.some((w) => nouns.has(w)))) out.push({ form: 'denied-by-facts', a: i, b: i });
  }
  return out;
}

const spanText = (sentence, tok, h) => (tok.shifted ? tok.words.slice(h.a, h.b + 1).join(' ') : sentence.slice(tok.at[h.a], tok.at[h.b] + tok.words[h.b].length));

// One sentence without its undercut, or null when a writer is needed. A marked sentence is never cut or removed.
function repairSentence(sentence) {
  const ru = CYR.test(sentence) ? tokensRu(sentence) : null;
  const ruHits = ru ? undercutsRu(ru.words, ru.opens) : [];
  if (ruHits.some(isBlock)) return null;                            // Russian goes to a writer
  const tok = tokensOf(sentence);
  const all = undercuts(tok.words, tok.opens);
  const hits = all.filter(isBlock);
  if (!hits.length) return sentence;
  if (all.some(isMark) || ruHits.length || tok.shifted) return null;   // a writer decides; a rule removes no marked words
  const numbers = tok.words.some((w) => /\d/.test(w));
  const names = /[A-Z]/.test(sentence.trim().slice(1));             // TNF, GROMACS and a project name all keep a sentence (F095)
  const sure = hits.every((h) => L.sure_form.has(h.form));          // "we lack", "awaits", "pending" go to a writer
  if (tok.words.length <= 7 && !numbers && !names && sure) return '';   // a bare fragment: "Not trained."
  if (hits.length === 1 && (sure || hits[0].form === 'what-missing')) {   // a list tail: "..., the evidence and what has not been done."
    const h = hits[0];
    const head = sentence.slice(0, tok.at[h.a]);
    const cut = head.lastIndexOf(' and ');
    const between = cut < 0 ? 99 : (head.slice(cut + 5).match(/[A-Za-z]+/g) || []).length;
    const tailWords = tok.words.length - 1 - h.b;
    if (cut > 0 && between <= 4 && tailWords <= 2) {
      let kept = head.slice(0, cut).replace(/[,\s]+$/, '');
      const comma = kept.lastIndexOf(', ');
      if (comma > 0) kept = `${kept.slice(0, comma)} and ${kept.slice(comma + 2)}`;
      const end = sentence.trim().slice(-1);
      return kept + ('.!?'.includes(end) ? end : '.');
    }
  }
  return null;
}

/** Repair the undercuts that a rule can repair. `unresolved` counts the sentences that need a writer. */
// `removed` lists every sentence that the repair takes out, and `cut` every sentence it shortens ("..., the evidence and
// what has not been done." loses its tail), each with its line, so no caller loses words without notice. drop: false keeps
// such a sentence whole and counts it as unresolved; a detector then marks it for a writer (F102).
export function repair(text, { drop = true } = {}) {
  let unresolved = 0;
  let changed = 0;
  const removed = [];
  const cut = [];
  const limits = new Set(zoneLines(text, 'public').filter((z) => z.zone === 'limits').map((z) => z.no));   // check() exempts these lines, so repair keeps them
  const lines = String(text ?? '').split('\n').map((line, idx) => {
    if (limits.has(idx + 1)) return line;
    const parts = line.split(SENTENCE_END);
    const kept = [];
    for (const s of parts) {
      const r = repairSentence(s);
      if (r === null || (r !== s && !drop)) { unresolved += 1; kept.push(s); } else if (r !== s) {
        changed += 1;
        if (r) { kept.push(r); cut.push({ line: idx + 1, sentence: s.trim(), now: r.trim() }); } else {
          removed.push({ line: idx + 1, sentence: s.trim() });
          if (kept.length && /[;:]$/.test(kept[kept.length - 1])) kept[kept.length - 1] = `${kept[kept.length - 1].slice(0, -1)}.`;   // the dropped fragment closed a "…; not trained yet." pair
        }
      } else kept.push(s);
    }
    return kept.join(' ');
  });
  const out = lines.join('\n');
  // a repair never empties a text, and never leaves only headings behind ("## Nimbus\n")
  const prose = (s) => s.split('\n').some((l) => l.trim() && !/^\s*#/.test(l));
  if (changed && !prose(out)) return { text: String(text ?? ''), changed: 0, unresolved: unresolved + changed, removed: [], cut: [] };
  return { text: out, changed, unresolved, removed, cut };
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
// A heading or a label names the limits when its first word is a limits word and it holds at most four words:
// "Limits", "Limitations of the pilot", "Ограничения". "API rate limits" and "Pushing the limits of ..." do not (F101).
const namesLimits = (s) => { const w = s.toLowerCase().match(/[a-zа-яё]+/g) || []; return w.length > 0 && w.length <= 4 && L.limits_head.has(w[0]); };
const isLimitsLabel = (raw) => {
  // "Limits:", "**Limitations**", "Limits of 1.0.0:" on a line of its own. A colon may only close the line, so an inline
  // "Limits: not trained" is no label (F093).
  const bare = raw.replace(/[*_]/g, ' ').trim();
  if (/[.!?;]\s+\S/.test(bare) || LIST_ITEM.test(raw) || /:\s*\S/.test(bare)) return false;
  return namesLimits(bare);
};

function zoneLines(text, zone) {
  // Markdown: a heading with a limits word opens a limits zone. It ends at the next heading of the same or a higher level.
  // Plain text: a label line with a limits word, over a list, opens a limits zone for that list. It ends at a blank line.
  // A label with no list under it is an ordinary line and is checked.
  const out = [];
  let limitsLevel = 0;
  let plain = 0;                                        // 1: a label waits for its list; 2: inside the list
  let fence = null;                                     // the open fence: its character (` or ~) and its length
  const rows = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const listFollows = (idx) => { for (let k = idx + 1; k < rows.length; k += 1) if (rows[k].trim()) return LIST_ITEM.test(rows[k]); return false; };
  for (const [idx, raw] of rows.entries()) {
    // A fence line is no prose; the words inside a fence are read like any line, but a heading or a label there opens no
    // zone (review of PR 35). As in CommonMark, ``` and ~~~ open a fence, only the same character at the same length or
    // longer closes it, and ```code``` on one line opens nothing.
    const f = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (f) {
      const ch = f[1][0], len = f[1].length, rest = raw.slice(f[0].length);
      if (!fence) { if (!(ch === '`' && rest.includes('`'))) fence = { ch, len }; } else if (ch === fence.ch && len >= fence.len && !rest.trim()) fence = null;
      continue;
    }
    const head = fence ? null : /^(#{1,6})\s+(.*)$/.exec(raw);
    if (head) {
      const level = head[1].length;
      const isLimits = namesLimits(head[2]);
      if (isLimits) limitsLevel = level; else if (limitsLevel && level <= limitsLevel) limitsLevel = 0;
      plain = 0;
      continue;
    }
    if (!raw.trim()) { if (plain === 2) plain = 0; continue; }
    if (!fence && isLimitsLabel(raw) && listFollows(idx)) { plain = 1; continue; }
    if (plain && (LIST_ITEM.test(raw) || (plain === 2 && /^\s{2,}\S/.test(raw)))) plain = 2; else plain = 0;
    const line = raw.replace(/`([^`\n]+)`/g, ' $1 ').replace(/https?:\/\/\S+/g, ' ');
    if (line.trim()) out.push({ no: idx + 1, line, zone: limitsLevel || plain === 2 ? 'limits' : zone });
  }
  return out;
}

/** The sentences of a text as the gate reads them, with their zone and whether a rule finds an undercut. The judge reads these. */
export function sentences(text, { zone = 'public' } = {}) {
  const out = [];
  for (const { no, line, zone: z } of zoneLines(text, zone)) {
    for (const s of line.split(SENTENCE_END)) {
      if (!s.trim()) continue;
      const r = readSentence(s);
      const hits = [...r.enHits, ...r.ruHits];
      // held: the clause of each exception mark, from its first word to the end of the hit ("No adverse events were
      // reported"). A rewrite must keep it; a mark for an unclear subject is no exception and a writer may rewrite it.
      const clause = (tok) => (h) => spanText(s, tok, { a: h.from, b: h.b });
      const heldOf = (tok, hs) => hs.filter((h) => isMark(h) && HELD.has(h.why)).map(clause(tok));
      out.push({ line: no, zone: z, sentence: s.trim(), undercut: hits.some(isBlock), mark: hits.some(isMark), held: [...heldOf(r.en, r.enHits), ...(r.ru ? heldOf(r.ru, r.ruHits) : [])] });
    }
  }
  return out;
}

/**
 * Check a text. zone: 'public' (speaks for the author; an undercut is an error), 'report' (a status report to the
 * owner; an undercut is a warning) or 'limits' (a limits section; an undercut is allowed there).
 * facts: sentences that say what is not done, such as the limits list of a project. They feed OVERCLAIM.
 * overclaim: the severity of OVERCLAIM. A match by words gave 6 false alarms in 72 texts (F088), so it advises
 * ('review') by default; verifyRewrite makes it block for the denials of the original text and of the facts it gets.
 */
export function check(text, { zone = 'public', facts = '', overclaim = 'review' } = {}) {
  const findings = [];
  const denied = deniedBy(facts);
  if (denied.truncated) {
    findings.push({ line: 0, rule: 'FACTS_TRUNCATED', form: 'denials', severity: overclaim, sentence: '', span: `more than ${MAX_DENIALS} denials`,
      allowed: `Shorten the facts. Denials after the first ${MAX_DENIALS} are not read, so OVERCLAIM cannot see them.` });
  }
  let words = 0;
  let before = false;                                // a sentence with words came earlier in the text
  for (const { no, line, zone: z } of zoneLines(text, zone)) {
    for (const sentence of line.split(SENTENCE_END)) {
      const r = readSentence(sentence);
      words += r.words;
      const any = r.enHits.some(isBlock) || r.ruHits.some(isBlock);
      const marked = r.enHits.some(isMark) || r.ruHits.some(isMark);
      if (z !== 'limits') {
        // a word in two scripts is no honest word; it can also hide a word from the rules (F100)
        for (const w of mixedWords(sentence)) findings.push({ line: no, rule: 'MIXED_SCRIPT', form: 'latin-cyrillic', severity: z === 'report' ? 'warn' : 'error', sentence: sentence.trim(), span: w, allowed: 'Write each word in one script.' });
      }
      if (z !== 'limits' && any) {
        const fixed = repairSentence(sentence);     // once per sentence: the cost stays linear in the hits (F091)
        const dropped = before ? 'Remove this sentence. The sentence before it already states what exists.' : ALLOWED_HINT;
        const push = (tok, hits, hint) => {
          for (const h of hits.filter(isBlock)) {
            findings.push({
              line: no, rule: 'SELF_UNDERCUT', form: h.form, severity: z === 'report' ? 'warn' : 'error',
              sentence: sentence.trim(), span: spanText(sentence, tok, h), allowed: fixed === null ? hint : (fixed || dropped),
            });
          }
        };
        push(r.en, r.enHits, ALLOWED_HINT);
        if (r.ru) push(r.ru, r.ruHits, ALLOWED_HINT_RU);
      }
      if (z !== 'limits' && marked) {
        // the mark band: a reader decides, and nothing here blocks or is removed
        const push = (tok, hits) => {
          for (const h of hits.filter(isMark)) findings.push({ line: no, rule: 'UNSURE_ABSENCE', form: h.why, severity: 'review', sentence: sentence.trim(), span: spanText(sentence, tok, h), allowed: MARK_HINT });
        };
        push(r.en, r.enHits);
        if (r.ru) push(r.ru, r.ruHits);
      }
      if (z === 'public' && !any && !marked) {
        const u = unsure(r.en.words);
        if (u) findings.push({ line: no, rule: 'UNSURE_ABSENCE', form: u.form, severity: 'review', sentence: sentence.trim(), span: spanText(sentence, r.en, u), allowed: 'Keep it when it states the scope of the design. Rewrite it when it announces work that is not done.' });
      }
      for (const h of overclaims(r.en, sentence, r.enHits, denied)) {   // OVERCLAIM reads English facts on the Latin words
        findings.push({ line: no, rule: 'OVERCLAIM', form: h.form, severity: overclaim, sentence: sentence.trim(), span: spanText(sentence, r.en, h), allowed: 'State only what the facts support. The facts deny this word for this subject.' });
      }
      if (r.words) before = true;
    }
  }
  const errors = findings.filter((f) => f.severity === 'error');
  const points = errors.reduce((n, f) => n + (WEIGHTS[f.rule] || 1), 0);
  return { ok: errors.length === 0, points, words, per100: words ? Math.round((points * 1000) / words) / 10 : 0, findings };
}

/** Check every prose string of a JSON value. A key named limits, limitations or caveats opens a limits zone. */
export function checkJson(value, { zone = 'public', facts = '' } = {}) {
  const findings = [];
  let points = 0;
  let words = 0;
  const walk = (node, where, z) => {
    if (typeof node === 'string') {
      // markup is read as text; a single word is no sentence ("Not trained" is two words, F101)
      const text = node.replace(/<[^>]*>/g, ' ');
      if (!/\S\s+\S/.test(text)) return;
      const r = check(text, { zone: z, facts });
      points += r.points; words += r.words;
      for (const f of r.findings) findings.push({ ...f, path: where });
    } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${where}[${i}]`, z));
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, where ? `${where}.${k}` : k, L.limits_head.has(k.toLowerCase()) ? 'limits' : z);
    }
  };
  walk(value, '', zone);
  return { ok: !findings.some((f) => f.severity === 'error'), points, words, per100: words ? Math.round((points * 1000) / words) / 10 : 0, findings };
}

const numbersOf = (s) => new Set(String(s).match(/\d+(?:[.,]\d+)*/g) || []);
// A capital that opens a sentence, a label or a list item marks no name ("Limits", "Because": F087). Such a word counts
// as a name only with a second capital or a digit (GROMACS, Hit5), or when the text also writes it capitalized inside a sentence.
// ponytail: a new plain name that only ever opens a sentence ("Rosetta scores it.") passes; a name list is the upgrade.
// Only the last 16 characters before a word decide, so the cost stays linear in the text (F091).
const OPENS_TAIL = /(?:[.!?:;]|\n[ \t]*(?:[-*+>#]+|\d+[.)])?)[\s"'(\[*_]*$/;
const opensAt = (text, at) => {
  const before = text.slice(Math.max(0, at - 16), at);
  return OPENS_TAIL.test(before) || (at <= 16 && /^[\s"'(\[*_]*$/.test(before));
};
function namesOf(s) {
  const text = String(s);
  const inner = new Set();
  const opening = new Set();
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9À-ɏ-]+/g)) (opensAt(text, m.index) ? opening : inner).add(m[0]);
  for (const w of opening) if (/[A-Z0-9]/.test(w.slice(1))) inner.add(w);
  return inner;
}
const wordsOf = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9À-ɏ]+(?:-[a-z0-9À-ɏ]+)*/g) || []);

/**
 * Accept a rewrite only when it is clean, adds no number and no name, and claims nothing that the original or the
 * facts deny. A rewrite that is told to keep the facts still changes them (Wang et al., arXiv:2611.00359), so a script checks.
 */
export function verifyRewrite(original, rewrite, { facts = '', zone = 'public' } = {}) {
  const reasons = [];
  const before = check(original, { zone, facts });
  // every sentence of the original counts, its limits section too: a limit there denies the work as much as one in the text (F101)
  const denies = [facts, sentences(original, { zone: 'report' }).map((s) => s.sentence).join('\n')].join('\n');
  const after = check(rewrite, { zone, facts: denies, overclaim: 'error' });
  for (const f of after.findings.filter((x) => x.severity === 'error')) reasons.push(`${f.rule}: ${f.span}`);
  const n0 = numbersOf(original);
  for (const n of numbersOf(rewrite)) if (!n0.has(n)) reasons.push(`new number: ${n}`);
  const words0 = wordsOf(original);   // a whole word of the original, never a part of a longer word ("Flow" in "workflow")
  for (const n of namesOf(rewrite)) if (!words0.has(n.toLowerCase())) reasons.push(`new name: ${n}`);
  // A mark of an exception (a null result, other people's work, a property, a procedure, a restricted noun) states a fact or
  // a rule: a rewrite keeps the clause of the mark word for word, case and spacing aside ("No adverse events were reported").
  // A rewrite may still fix a block hit in the same sentence. A mark for an unclear subject ("Domain training not yet run.")
  // may be an undercut, so a writer may remove it; the rule repair never removes a marked sentence (S049).
  // the held clause comes from the tokens, where "aren't" reads "are not": the rewrite gets the same expansion (tokensOf)
  const flat = (s) => String(s ?? '').toLowerCase().replace(/’/g, "'").replace(/\bcannot\b/g, 'can not').replace(/n't\b/g, ' not').replace(/\s+/g, ' ');
  const kept = flat(rewrite);
  for (const s of sentences(original, { zone })) if (s.zone !== 'limits' && s.held.some((c) => !kept.includes(flat(c)))) reasons.push(`removed marked sentence: ${s.sentence}`);
  if (!String(rewrite ?? '').trim()) reasons.push('empty rewrite');
  return { ok: reasons.length === 0, reasons, before: before.points, after: after.points };
}
