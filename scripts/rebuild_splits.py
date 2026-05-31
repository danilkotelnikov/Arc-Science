#!/usr/bin/env python3
"""Rebuild train/val/test splits for a discipline by combining three
negative sources with the real-paper positives.

Input layout per discipline (under ``~/.vedix/corpus/<discipline>/en/``):

- ``positives.jsonl``         — labeled academic paragraphs from real
                                 papers (produced by prepare_corpus
                                 stages 6-7)
- ``negatives.jsonl``         — template-generated adversarial AI-style
                                 negatives (prepare_corpus stage 8)
- ``popsci_negatives.jsonl``  — Wikipedia encyclopedic-register chunks
                                 from ``scripts/scrape_popsci.py``

Output:

- ``train.jsonl`` / ``val.jsonl`` / ``test.jsonl`` — overwritten in place.
- ``corpus_mix.json``        — descriptor of the mix (counts, split
                                 strategy, seed).

The split is stratified by ``paper_id`` so all paragraphs from one
paper land in the same split — prevents within-paper leakage. Negatives
are sub-sampled to a 50/50 class balance against positives; the two
negative sources are sub-sampled to equal halves of the budget so
neither dominates.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path


def load_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    out: list[dict] = []
    with p.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--discipline", required=True,
                    choices=["biology", "chemistry", "physics", "medicine",
                             "computer_science", "materials", "geology"])
    ap.add_argument("--lang", default="en")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--test-frac", type=float, default=0.1)
    ap.add_argument("--corpus-root", default=None,
                    help="Override the default ~/.vedix/corpus root.")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    root_base = Path(args.corpus_root or os.path.expanduser("~/.vedix/corpus"))
    root = root_base / args.discipline / args.lang
    if not root.exists():
        print(f"ERROR: discipline corpus dir not found: {root}", file=sys.stderr)
        return 2

    pos = load_jsonl(root / "positives.jsonl")
    syn = load_jsonl(root / "negatives.jsonl")
    ws = load_jsonl(root / "popsci_negatives.jsonl")

    # Normalize: every negative gets label=0; tag source if missing.
    for s in syn:
        s["label"] = 0
        s.setdefault("label_source", "synthetic_template")
    for s in ws:
        s["label"] = 0
        s.setdefault("label_source", "popsci_wikipedia")

    print(f"Loaded {args.discipline}/{args.lang}: pos={len(pos)} "
          f"synthetic_neg={len(syn)} popsci_neg={len(ws)}")
    if not pos:
        print(f"ERROR: positives.jsonl empty for {args.discipline}; run "
              f"scripts/prepare_corpus.py first.", file=sys.stderr)
        return 2

    # 50/50 mix: sample equal halves from synthetic + popsci to total len(pos).
    target_neg = len(pos)
    budget_per_src = target_neg // 2
    syn_sample = rng.sample(syn, min(len(syn), budget_per_src))
    ws_sample = rng.sample(ws, min(len(ws), budget_per_src))
    neg_sample = syn_sample + ws_sample

    # If under budget on either, top up from whichever source has slack.
    if len(neg_sample) < target_neg:
        leftover = target_neg - len(neg_sample)
        already = set(id(x) for x in syn_sample + ws_sample)
        pool = [x for x in (syn + ws) if id(x) not in already]
        neg_sample += rng.sample(pool, min(len(pool), leftover))

    print(f"Balanced mix: pos={len(pos)} synthetic_neg={len(syn_sample)} "
          f"popsci_neg={len(ws_sample)} total_neg={len(neg_sample)}")

    # Stratified split by paper_id: every paper's paragraphs land in one
    # split. Prevents within-paper leakage.
    combined = pos + neg_sample
    by_paper: dict[str, list[dict]] = defaultdict(list)
    for item in combined:
        by_paper[item["paper_id"]].append(item)
    paper_ids = list(by_paper.keys())
    rng.shuffle(paper_ids)
    n = len(paper_ids)
    val_n = max(1, int(n * args.val_frac))
    test_n = max(1, int(n * args.test_frac))
    val_ids = set(paper_ids[:val_n])
    test_ids = set(paper_ids[val_n:val_n + test_n])
    train_ids = set(paper_ids[val_n + test_n:])

    train = [i for pid in train_ids for i in by_paper[pid]]
    val = [i for pid in val_ids for i in by_paper[pid]]
    test = [i for pid in test_ids for i in by_paper[pid]]
    for s in (train, val, test):
        rng.shuffle(s)

    for name, lst in (("train", train), ("val", val), ("test", test)):
        p = root / f"{name}.jsonl"
        with p.open("w", encoding="utf-8") as f:
            for it in lst:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")

    def stats(items: list[dict], name: str) -> None:
        lbl = Counter(i["label"] for i in items)
        src = Counter(i.get("label_source", "unknown") for i in items)
        pos_frac = lbl[1] / max(1, len(items))
        print(f"{name}: total={len(items)}  pos={lbl[1]}  neg={lbl[0]}  "
              f"pos%={pos_frac:.1%}  sources={dict(src)}")

    stats(train, "train")
    stats(val,   "val  ")
    stats(test,  "test ")

    mix = {
        "discipline":           args.discipline,
        "lang":                 args.lang,
        "total_positives":      len(pos),
        "synthetic_negatives":  len(syn_sample),
        "popsci_negatives":     len(ws_sample),
        "train_size":           len(train),
        "val_size":             len(val),
        "test_size":            len(test),
        "split_strategy":       "stratified_by_paper_id",
        "split_seed":           args.seed,
    }
    (root / "corpus_mix.json").write_text(json.dumps(mix, indent=2))
    print()
    print(f"Wrote corpus_mix.json -> {root / 'corpus_mix.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
