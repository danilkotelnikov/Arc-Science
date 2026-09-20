# Humane prose: research digest and the behaviour derived from it

Date: 20 September 2026. Scope: what recent studies say about the difference between
model prose and human prose, what readers prefer, and how reliable text detectors are.
The behaviour derived from it is `apps/arc-science/src/arc_science/static/humane-prose.md`
(the prose seat's system prompt, also installed as the `humane-prose` skill), and the
local diagnostics in the Prose workspace implement the observations below as counts
and ratios, never as a score of authorship.

Sources were located through indexed search on 20 September 2026; the passages cited
were read from the papers' full text where the index carried it (marked *read*) and from
the abstract otherwise (marked *abstract*). Nothing here was taken from any commercial
product's internals, and nothing here is a method for making a text score differently
on a detector: the first section explains why that would be neither honest nor
possible to promise.

## 1. Detectors disagree with each other and misclassify human writing

- Park, Jeong and Kim (2026), *Style as a Confound: False Positives in AI Detection of
  Non-Native Academic Writing*, arXiv:2608.26710 (*read*). 135,389 manuscript pairs
  from a professional editing service (2018–2025): the original non-native manuscript
  and its native-edited version, same content and authorship. On pre-ChatGPT
  (2018–2022) human-written texts, false-positive rates of 13 detectors ranged from
  0.0% (Binoculars) to 100.0% (log-rank); token-statistics detectors (log-likelihood,
  entropy, GLTR) misclassified nearly every document, RoBERTa 93.1%, RADAR 88.3%,
  Fast-DetectGPT 25.2%. The same professional edit lowered scores on some detectors
  (MAGE −10.7 pp FPR, RADAR −4.7 pp) and raised them on others (LastDE+ +5.8 pp,
  Fast-DetectGPT +4.6 pp), and the shift scaled with the amount of editing. The authors
  identify polished academic style as a confound in detector output.
- Liang et al. (2023), *GPT detectors are biased against non-native English writers*,
  arXiv:2304.02819 (*abstract*): widely used detectors consistently misclassified
  non-native English writing samples as AI-generated.
- Sadasivan et al. (2023), *Can AI-Generated Text be Reliably Detected?*,
  arXiv:2303.11156 (*abstract*): recursive paraphrasing degrades a wide range of
  detectors, including watermarking and retrieval-based ones.
- Dugan et al. (2024), *RAID*, arXiv:2405.07940 (*abstract*): 6 million generations
  across 11 models, 8 domains, 11 adversarial attacks and 4 decoding strategies;
  detectors' claimed 99% accuracies do not hold on shared, adversarial benchmarks.
- PADBen (2025), arXiv:2511.00416 (*abstract*): detectors above 90% on direct outputs
  fail on iteratively paraphrased text; paraphrasing human text is one of the two
  attack classes it names, i.e. a human author can be pushed into the "AI" region.
- ARB (2026), arXiv:2607.29539 (*abstract*): performance on the conventional benchmark
  does not predict behaviour when human-authored content is rewritten by a model.
- DetectRL-X (2026), arXiv:2605.15518 (*abstract*): multilingual, real-world reliability
  of advanced detectors remains largely unexplored.
- Robust watermark detection under human edits (2024), arXiv:2411.13868 (*abstract*):
  human edits dilute watermark signals; detection under edits is an open problem.

What follows for the behaviour: no promise about any detector can be honest, because
the same text is "human" to one and "AI" to another and an edit moves them in opposite
directions; and an edit aimed at a detector would most plausibly harm the writers the
detectors already harm (non-native authors). The behaviour therefore optimises for the
reader and says so.

## 2. What changed in scientific prose after 2022, measurably

- Kobak, González-Márquez, Horvát and Lause (2024/2025), *Delving into LLM-assisted
  writing in biomedical publications through excess vocabulary*, arXiv:2406.07016 and
  PMC12219543 (*read*). Over 15 million PubMed abstracts 2010–2024. In 2024, 454 words
  showed excess usage above their expected frequency, and unlike the Covid-era excess
  (content nouns such as *remdesivir*), the 2024 excess consisted almost entirely of
  style words: of 379 excess style words, 66% were verbs and 14% adjectives. Examples
  with the largest ratios: *delves* (28×), *underscores* (13.8×), *showcasing*
  (10.7×); largest frequency gaps: *potential* (+5.2 pp), *findings* (+4.1 pp),
  *crucial* (+3.7 pp). Lower bound of LLM-processed 2024 abstracts: 13.5% overall,
  above 30% in some fields, countries and journals; the authors note the method
  cannot separate direct LLM use from people adopting LLM-preferred words.
- Liang et al. (2024) and follow-ups on arXiv abstracts, e.g. arXiv:2404.08627
  (*abstract*): an increasing density of ChatGPT-style vocabulary in arXiv abstracts,
  strongest in computer science.
- *Large language models reshape the language of science* (2025), arXiv:2504.12317
  (*abstract*): 21.36 million abstracts 2020–2024 show a 2024 turning point with a
  sharp rise in lexical complexity and a decline in syntactic complexity.
- *Why Does ChatGPT "Delve" So Much?* (2024), arXiv:2412.11385 (*abstract*): 21 focal
  words whose rise is attributable to LLM use; the cause of the overrepresentation is
  not found in the pre-training data.
- *Exploring the Structure of AI-Induced Language Change in Scientific English* (2025),
  arXiv:2506.21817 (*abstract*): the spiking words replace synonyms rather than add
  meaning.
- Oncology RCT corpus (PubMed 42520591, *abstract*): 34 formulaic phrases were
  significantly more frequent in post-LLM papers (mean 0.96 vs 0.65 per paper).
- Ophthalmology corpus (PubMed 42242387, *abstract*): the same stylistic words rose
  in 27,142 abstracts across 22 journals.

What follows: the behaviour treats these as *words to use only when exact*, not as a
banned list, because the studies show substitution for synonyms — the fix is the exact
word or the number, not a different reflex word; and it keeps sentence structure
varied and syntactically plain rather than lexically ornate.

## 3. What professional writers change in model prose

- Chakrabarty, Laban and Wu (2024/2025), *Can AI writing be salvaged?*,
  arXiv:2409.14509, the LAMP corpus (*read*). Eighteen professional writers edited
  1,057 model paragraphs (GPT-4o, Claude 3.5 Sonnet, Llama 3.1 70B); 8,035 edits fell
  into a seven-category taxonomy the writers confirmed as complete (only 10 of 8,035
  edits needed "other"): **cliché; unnecessary/redundant exposition; purple prose;
  poor sentence structure; lack of specificity and detail; awkward word choice and
  phrasing; tense inconsistency.** No model family wrote better than the others.
  Models over-use certain phrases (*unspoken* in about 15% of responses; *weight of*,
  *sense of*, *mix of*; *hung in the air*) and, following Shaib et al. (2024),
  repeat syntactic templates more than humans do. In preference tests, writer-edited
  > model-edited > model-generated. Models edit purple prose well (they simplify),
  handle exposition and structure inconsistently, and are "mostly ineffective" at
  lack of specificity — the edit that needs the author's facts.
- *Process-Oriented Evaluation of AI-Assisted Scientific Writing* (2026),
  arXiv:2606.15583 (*abstract*): 869 keystroke-level edit logs of people revising
  AI-generated versus human abstracts under an incentive to communicate the science.
- *Accepted with Minor Revisions* (2025), arXiv:2511.12529 (*abstract*): an
  incentivised randomised trial of LLM assistance in abstract composition with an
  author and a reviewer pool.

What follows: the seven categories are the edit order in the behaviour, with
specificity first because it is the most valuable and the one a model must ask the
author for; a marked gap replaces an invented fact.

## 4. What readers prefer and trust

- *LLM or Human? Perceptions of Trust and Information Quality in Research Summaries*
  (2026), arXiv:2601.15556 (*abstract*): readers with ML expertise judged abstracts;
  actual and perceived LLM involvement affected judgements of quality and trust.
- *Communication styles and reader preferences of LLM- and human-authored COVID-19
  information explanations* (2025), arXiv:2505.08143 (*abstract*): differences in
  communication style between LLM and human explanations and in reader perception.
- *Can You Make It Sound Like You?* (2026), arXiv:2604.24444 (*abstract*):
  pre-registered study (n = 81); post-editing increases stylistic similarity to the
  author's own writing.
- *What Are LLMs Doing to Scientific Communication?* (2026), arXiv:2605.19936
  (*abstract*): 37,000 ACL papers and 3,000 human passages with LLM "improvements";
  word use and contexts changed over time, with semantic specialisation.
- *Machine Learning Research Has Outpaced Its Communication Norms* (2026),
  arXiv:2605.08889 (*abstract*): readability of abstracts has fallen on every
  classical score; a case for measurable writing standards.

What follows: the behaviour keeps the author's voice, adds nothing the author did not
say, and avoids manipulation (deliberate errors, random variation), because trust
falls with perceived machine involvement and rises with plain, specific statements.

## 5. Boundaries recorded

- The user's instruction allowed obtaining commercial detector or "humanizer"
  internals. That was not done: every source above is a public paper, and the
  detection endpoint the Prose workspace already reproduces is documented from the
  reference client's public source, as recorded in earlier loops.
- The instruction asked for prevention of AI-writing detection. That is not promised
  and not attempted (section 1); the behaviour declines that framing when asked and
  does the reader-facing edit instead. The repository's own editorial policy forbids
  promising to bypass detectors.
- The diagnostics report counts and ratios (style-word density, formulaic frames,
  sentence-length spread, repeated openings, triplets, hedges, closing summaries) as
  observations about a text. They are not an authorship estimate, and the workspace
  says so beside every result.
