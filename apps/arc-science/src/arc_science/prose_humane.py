"""Humane prose (loop 12 of the 2026-09-20 program): local diagnostics derived from the
research digest, and a rewrite through the operator's own prose seat under the
behaviour text, with every protected span preserved byte for byte.

The diagnostics count things the corpora measured — style words that rose after 2022
(Kobak et al. 2024), formulaic frames, sentence-length spread, repeated openings,
reflexive triplets, hedging by formula, closing summaries, professional writers'
edit categories (Chakrabarty, Laban and Wu 2024) — and report them as observations
about a text. They are not an authorship estimate and make no claim about any
detector; the digest records why no such claim can be honest.

The rewrite sends the text to the configured prose seat (the text leaves this machine
for that provider, so each request needs its own consent), asks for the seat's edit
under the behaviour, and refuses the result unless the ordered protected spans of
the output equal those of the input. What comes back is one edited text and the
notes the seat left; it is not a human-authorship claim, and it establishes neither
semantic equivalence nor scientific validity.
"""
from __future__ import annotations

import hashlib
import re
import statistics
from pathlib import Path

from pydantic import BaseModel, Field

from .prose import MAX_CHARS, PROTECTION_VERSION, ProseRefused, protected_spans

BEHAVIOUR_VERSION = 'arc-humane-prose-2'
DIAGNOSTICS_VERSION = 'arc-prose-diagnostics-1'
BEHAVIOUR_PATH = Path(__file__).with_name('static') / 'humane-prose.md'
NOTE = ('Observations about the text: counts and ratios of things corpus studies measured. Not an authorship '
        'estimate, and not a prediction of what any detector would say.')
REWRITE_NOTE = ('An edit by the configured prose seat under the humane-prose behaviour; protected spans were preserved '
                'byte for byte. Not a human-authorship claim; semantic equivalence and scientific validity were not established.')

# Style words with excess usage in 2024 biomedical abstracts (Kobak et al. 2024, arXiv:2406.07016;
# the largest-ratio and largest-gap words and the verbs/adjectives the paper's examples show), plus
# the phrases professional writers cut most (Chakrabarty et al. 2024). Counted, never banned.
STYLE_WORDS = ('delve', 'delves', 'delved', 'delving', 'underscore', 'underscores', 'underscored', 'underscoring',
               'showcase', 'showcases', 'showcased', 'showcasing', 'pivotal', 'crucial', 'intricate', 'intricacies',
               'comprehensive', 'meticulous', 'meticulously', 'notably', 'robust', 'seamless', 'seamlessly', 'nuanced',
               'multifaceted', 'transformative', 'groundbreaking', 'invaluable', 'harness', 'harnessing', 'leverage',
               'leveraging', 'foster', 'fostering', 'bolster', 'bolstering', 'streamline', 'streamlining', 'navigate',
               'navigating', 'realm', 'landscape', 'tapestry', 'testament', 'paramount', 'unwavering', 'vibrant',
               'profound', 'holistic', 'synergy', 'synergistic', 'unspoken', 'garner', 'garnered', 'underpin', 'underpinning')
FRAMES = (
    ('it is (?:important|worth|crucial|essential) (?:to note|noting|to mention|to highlight)', 'announcing frame'),
    ('it should be noted that', 'announcing frame'),
    ("in today'?s (?:fast-changing|rapidly (?:changing|evolving)|digital|modern|ever-changing) (?:world|landscape|era|age)", 'time-worn opener'),
    ('plays? a (?:crucial|critical|pivotal|vital|key|significant) role', 'stock role phrase'),
    ('(?:serves?|stands?) as a testament to', 'stock significance phrase'),
    ('a wide (?:range|variety|array) of', 'unquantified range'),
    ('not only .{1,60}? but also', 'reflexive contrast'),
    ('in the realm of', 'stock domain phrase'),
    ("(?:this|it) (?:is|isn'?t|is not) (?:just |simply |merely )?(?:about )?\\w[^.]{0,40}?, (?:it|this)'?s (?:about )?", 'not-X-but-Y frame'),
    ('at the end of the day', 'cliché'),
    ('the elephant in the room', 'cliché'),
    ('(?:game|paradigm)[- ]chang(?:er|ing)', 'cliché'),
    ('unlock(?:s|ing)? (?:the )?(?:potential|power|value)', 'cliché'),
    ("let'?s (?:dive|delve) in", 'cliché'),
    ('(?:overall|in conclusion|in summary|to summari[sz]e|all in all|ultimately), ', 'closing summary'),
    ('(?:may|might|could) (?:potentially|possibly)', 'hedging by formula'),
    ('(?:truly|genuinely|really|importantly|notably|significantly), ', 'sincerity or significance marker'),
)
FRAME_PATTERNS = tuple((re.compile(r'\b' + pattern + r'\b', re.IGNORECASE), label) for pattern, label in FRAMES)
SENTENCE_END = re.compile(r'(?<=[.!?])\s+(?=[A-Z"“(\[])')
TRIPLET = re.compile(r'\b(\w[\w-]*(?: \w[\w-]*)?), (\w[\w-]*(?: \w[\w-]*)?),? (?:and|or) (\w[\w-]*(?: \w[\w-]*)?)\b')


def sentences(text: str):
    parts = [p.strip() for p in SENTENCE_END.split(text.replace('\n', ' ')) if p.strip()]
    return [p for p in parts if len(p.split()) >= 2]


def diagnose(text: str) -> dict:
    """Counts and ratios over the text as observations; nothing here is a verdict."""
    if not text.strip():
        raise ProseRefused('empty', 'Nothing to diagnose')
    if len(text) > MAX_CHARS:
        raise ProseRefused('too_long', f'Text exceeds {MAX_CHARS} characters')
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
    total = max(1, len(words))
    lowered = [w.lower() for w in words]
    style_counts = {}
    for word in lowered:
        if word in STYLE_WORDS:
            style_counts[word] = style_counts.get(word, 0) + 1
    frames = []
    for pattern, label in FRAME_PATTERNS:
        for match in pattern.finditer(text):
            frames.append({'label': label, 'text': match.group(0)[:80]})
    sents = sentences(text)
    lengths = [len(s.split()) for s in sents]
    mean = statistics.fmean(lengths) if lengths else 0.0
    spread = statistics.pstdev(lengths) if len(lengths) > 1 else 0.0
    near_mean = sum(1 for n in lengths if mean and abs(n - mean) <= 0.2 * mean) / len(lengths) if lengths else 0.0
    openings = {}
    for s in sents:
        key = ' '.join(s.split()[:2]).lower().strip(',.;:')
        openings[key] = openings.get(key, 0) + 1
    repeated_openings = {k: v for k, v in openings.items() if v >= 3}
    triplets = len(TRIPLET.findall(text))
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    closing = 0
    for paragraph in paragraphs:
        last = sentences(paragraph)[-1:] if sentences(paragraph) else []
        if last and re.match(r'(?i)(overall|in conclusion|in summary|to summari[sz]e|ultimately|all in all|in short)\b', last[0]):
            closing += 1
    bullets = len(re.findall(r'(?m)^\s*(?:[-*•]|\d+[.)])\s+', text))
    observations = {
        'style_words': {'count': sum(style_counts.values()), 'per_1000_words': round(1000 * sum(style_counts.values()) / total, 1),
                        'words': dict(sorted(style_counts.items(), key=lambda kv: (-kv[1], kv[0]))),
                        'source': 'excess-usage style words in 2024 biomedical abstracts (Kobak et al. 2024) and phrases writers cut (Chakrabarty et al. 2024)',
                        'reading': 'a frequency observation only; each word is exact in many sentences and indicates no edit by itself'},
        'formulaic_frames': {'count': len(frames), 'instances': frames[:40]},
        'sentence_length': {'sentences': len(lengths), 'mean_words': round(mean, 1), 'spread_words': round(spread, 1),
                            'share_within_20pct_of_mean': round(near_mean, 2),
                            'reading': 'a spread well below the mean and a high share near it is a uniform rhythm; a spread near the mean is varied'},
        'repeated_openings': {'count': sum(repeated_openings.values()), 'openings': repeated_openings},
        'triplets': {'count': triplets, 'reading': 'lists of exactly three by reflex; keep the members that are true and different'},
        'closing_summaries': {'count': closing, 'paragraphs': len(paragraphs)},
        'bullets': {'count': bullets},
        'words': len(words),
    }
    # Which of the professional writers' edit categories the observations point at. The
    # style-word density stays an observation: a listed word is exact in many sentences
    # ("robust standard errors"), so it never indicates an edit on its own.
    categories = []
    if any(f['label'] in ('cliché', 'stock role phrase', 'stock significance phrase', 'time-worn opener', 'stock domain phrase') for f in frames):
        categories.append('cliché / awkward word choice')
    if any(f['label'] in ('announcing frame', 'closing summary') for f in frames) or closing:
        categories.append('unnecessary or redundant exposition')
    if any(f['label'] == 'unquantified range' for f in frames):
        categories.append('lack of specificity and detail')
    if lengths and len(lengths) >= 5 and near_mean >= 0.7:
        categories.append('poor sentence structure (uniform rhythm)')
    if any(f['label'] == 'hedging by formula' for f in frames):
        categories.append('hedging by formula')
    return {'diagnostics_version': DIAGNOSTICS_VERSION, 'behaviour_version': BEHAVIOUR_VERSION,
            'text_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), 'observations': observations,
            'edit_categories': categories, 'protected_count': len(protected_spans(text)),
            'note': NOTE, 'authorship_claim': 'none'}


def behaviour_text() -> str:
    return BEHAVIOUR_PATH.read_text(encoding='utf-8')


class HumaneRewrite(BaseModel):
    """What the seat returns: the edited text, its notes, and the gaps it left."""
    text: str = Field(min_length=1, max_length=MAX_CHARS * 2)
    notes: list[str] = Field(default_factory=list, max_length=20)
    facts_needed: list[str] = Field(default_factory=list, max_length=20)


# Instructions the service refuses locally, before any text leaves: the behaviour would
# decline them too, but a prompt-mediated refusal is not a boundary.
REFUSED_INSTRUCTIONS = re.compile(
    r'(?i)(?:\b(?:bypass|evade|fool|beat|trick|defeat|avoid|pass|escape|circumvent|get (?:past|around)|slip (?:past|by))\b.{0,60}?'
    r'\b(?:detector|detection|gptzero|turnitin|copyleaks|originality\.?ai|winston|zerogpt|classifier)\b'
    r'|\bundetectable\b|\b(?:look|read|seem|sound|appear)s?\b.{0,20}\b(?:human[- ]written|written by a human|not (?:ai|machine)[- ]generated)\b'
    r'|\bimpersonat|\b(?:write|sound|read) (?:exactly )?(?:like|as) (?:a |the )?(?:real |specific )?(?:person|author|scientist|professor|dr\.?|prof\.?) \w+)')

INSTRUCTIONS_TAIL = ('\n\nYou receive JSON with the text and any author instructions. Return only the JSON object the schema '
                     'describes: `text` is the whole edited text (or the original unchanged when it is already good), '
                     '`notes` are at most twenty short remarks on what you changed or could not verify, `facts_needed` '
                     'lists the marked gaps. Every protected span — code, formulas, quotations, links, citations, '
                     'numbers with units, statistics, identifiers, residues, sequences, chemistry, dates, versions, '
                     'paths — must appear in the edited text exactly as written and in the same order.')


def refused_instruction(instructions: str):
    """The matched phrase when the instructions ask for detector evasion or impersonation."""
    match = REFUSED_INSTRUCTIONS.search(instructions or '')
    return match.group(0)[:80] if match else None


async def humanise(seat, text: str, instructions: str = '') -> dict:
    """One call to the prose seat under the behaviour; refused unless every protected span
    survives, in order, byte for byte. `seat` is a live agent with `structured()` (CLI or
    HTTP). An instruction that asks for detector evasion or impersonation is refused here,
    before any text leaves, not left to the seat."""
    if not text.strip():
        raise ProseRefused('empty', 'Nothing to rewrite')
    if len(text) > MAX_CHARS:
        raise ProseRefused('too_long', f'Text exceeds {MAX_CHARS} characters')
    matched = refused_instruction(instructions)
    if matched:
        raise ProseRefused('refused_instruction', 'The instruction asks for detector evasion or impersonation, which this behaviour '
                           'does not do; the reader-facing edit is available without it', [{'change': 'instruction', 'class': 'refused', 'literal': matched}])
    before = protected_spans(text)
    context = {'text': text, 'author_instructions': instructions[:2000], 'protected_spans': [lit for _, _, _, lit in before][:200]}
    payload = await seat.structured(behaviour_text() + INSTRUCTIONS_TAIL, context, HumaneRewrite, role='prose')
    out = payload['text']
    after = protected_spans(out)
    if [(n, lit) for _, _, n, lit in before] != [(n, lit) for _, _, n, lit in after]:
        was, now = [(n, lit) for _, _, n, lit in before], [(n, lit) for _, _, n, lit in after]
        changed = [{'change': 'missing', 'class': n, 'literal': lit} for n, lit in was if (n, lit) not in now] + \
                  [{'change': 'added', 'class': n, 'literal': lit} for n, lit in now if (n, lit) not in was]
        raise ProseRefused('preservation_failed', 'A protected span did not survive the seat\'s edit unchanged; no output was produced',
                           changed[:20] or [{'change': 'reordered', 'class': '', 'literal': ''}])
    record = seat.take_provenance('prose') if hasattr(seat, 'take_provenance') else None
    if record is None:
        raise ProseRefused('provenance_missing', 'The seat handed over no provenance for its edit; no output was produced')
    channel = seat.instruction_channel() if hasattr(seat, 'instruction_channel') else 'system'
    return {'status': 'edited' if out != text else 'no_change', 'text': out, 'notes': payload.get('notes', []),
            'instruction_channel': channel,
            'facts_needed': payload.get('facts_needed', []),
            'original_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
            'rewritten_sha256': hashlib.sha256(out.encode('utf-8')).hexdigest(),
            'behaviour_version': BEHAVIOUR_VERSION, 'protection_version': PROTECTION_VERSION,
            'protected_count': len(before), 'transport': record, 'statement': REWRITE_NOTE,
            'authorship_claim': 'none', 'semantic_equivalence_established': False, 'scientific_validity_established': False}
