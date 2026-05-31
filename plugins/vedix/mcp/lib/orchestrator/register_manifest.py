"""Pure-stdlib reader for the trained-classifier manifest.

The Layer B register classifiers live under ``~/.vedix/classifiers/`` as
``register_{discipline}_{language}/`` directories, each with a
``metrics.json``. The training scripts also maintain an aggregate
``manifest.json`` at the classifiers root listing every trained model
with its eval metrics.

This module reads those without importing torch / transformers, so the
pipeline and the reviewer agent can answer "is there a trained register
classifier for chemistry/en, and how good is it?" cheaply — before
deciding whether to pay the cost of loading a 1.1 GB model.

Public surface
--------------
:class:`RegisterManifest` — reads the classifiers root, exposes
    ``available_pairs()``, ``is_available(discipline, language)``, and
    ``metrics_for(discipline, language)``.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional


def default_classifiers_root() -> Path:
    """``$VEDIX_HOME/classifiers`` (or legacy ``$AI_SCIENTIST_HOME``),
    defaulting to ``~/.vedix/classifiers``."""
    home = Path(
        os.environ.get("VEDIX_HOME")
        or os.environ.get("AI_SCIENTIST_HOME")
        or (Path(os.environ.get("USERPROFILE") or os.environ.get("HOME") or ".") / ".vedix")
    )
    # VEDIX_HOME already points at ~/.vedix; if it's a bare home, append.
    if home.name == ".vedix":
        return home / "classifiers"
    return home / ".vedix" / "classifiers"


class RegisterManifest:
    """Read-only view over the trained-classifier directory.

    Args:
        classifiers_root: Directory containing ``register_*`` model dirs
            and an optional aggregate ``manifest.json``. Defaults to
            :func:`default_classifiers_root`.
    """

    def __init__(self, classifiers_root: Optional[Path] = None) -> None:
        self.root = Path(classifiers_root) if classifiers_root else default_classifiers_root()

    # ------------------------------------------------------------------ #

    def _pair_dir(self, discipline: str, language: str) -> Path:
        return self.root / f"register_{discipline}_{language}"

    def is_available(self, discipline: str, language: str) -> bool:
        """True iff a trained model with weights exists for the pair."""
        d = self._pair_dir(discipline, language)
        return (d / "model.safetensors").exists() or (d / "pytorch_model.bin").exists()

    def metrics_for(self, discipline: str, language: str) -> dict:
        """Return the pair's ``metrics.json`` (empty dict if absent)."""
        m = self._pair_dir(discipline, language) / "metrics.json"
        if not m.exists():
            return {}
        try:
            return json.loads(m.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def available_pairs(self) -> list[dict]:
        """List every trained pair on disk with its name + f1 + path.

        Walks the directory (not the aggregate manifest) so the answer
        reflects what's actually loadable right now.
        """
        if not self.root.exists():
            return []
        out: list[dict] = []
        for d in sorted(self.root.glob("register_*")):
            if not d.is_dir():
                continue
            has_weights = (d / "model.safetensors").exists() or (d / "pytorch_model.bin").exists()
            if not has_weights:
                continue
            # Parse "register_<discipline>_<language>". Discipline may
            # itself contain underscores (computer_science), so split
            # the language off the end.
            stem = d.name[len("register_"):]
            parts = stem.rsplit("_", 1)
            if len(parts) == 2:
                discipline, language = parts
            else:
                discipline, language = stem, "?"
            metrics = {}
            mfile = d / "metrics.json"
            if mfile.exists():
                try:
                    metrics = json.loads(mfile.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    metrics = {}
            out.append({
                "name": d.name,
                "discipline": discipline,
                "language": language,
                "f1": metrics.get("f1"),
                "accuracy": metrics.get("accuracy"),
                "path": str(d),
            })
        return out

    def aggregate_manifest(self) -> dict:
        """Return the aggregate ``manifest.json`` if present, else ``{}``."""
        m = self.root / "manifest.json"
        if not m.exists():
            return {}
        try:
            return json.loads(m.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def summary(self) -> dict:
        """Coverage summary: number of pairs, mean F1, per-language counts."""
        pairs = self.available_pairs()
        f1s = [p["f1"] for p in pairs if isinstance(p.get("f1"), (int, float))]
        by_lang: dict[str, int] = {}
        for p in pairs:
            by_lang[p["language"]] = by_lang.get(p["language"], 0) + 1
        return {
            "classifiers_root": str(self.root),
            "n_pairs": len(pairs),
            "mean_f1": round(sum(f1s) / len(f1s), 4) if f1s else None,
            "min_f1": round(min(f1s), 4) if f1s else None,
            "by_language": by_lang,
            "pairs": pairs,
        }


__all__ = ["RegisterManifest", "default_classifiers_root"]
