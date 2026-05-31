"""Register-quality gate — the pipeline's single entry point to the
trained Layer B (and optional Layer A) register classifiers.

The §5.3 HybridDiscriminator (``register_discriminator.py``) does the raw
inference; this module is the *orchestration seam* that the manuscript
phase calls. It:

- Reads the ``orchestrator.register_discriminator`` settings block.
- Lazily loads the per-(discipline, language) classifier only when a
  manuscript actually needs judging, and caches it for the job.
- Degrades gracefully: if disabled, if torch/transformers are missing,
  or if no trained model exists for the pair, every paragraph passes and
  the audit records ``skipped`` with a reason — the pipeline never
  crashes for lack of a model.
- Produces ``register_audit.json`` (one verdict per paragraph + a
  summary) that the reviewer agent reads alongside ``linguistic_audit.json``
  and ``source_usage.json`` to confirm the manuscript reads as genuine
  academic prose rather than AI-stylistic or popular-science register.

This sits next to :mod:`anti_llm_lint` (regex blacklist) and
:mod:`linguistic_audit` (locale rules): three complementary register
checks. anti_llm_lint catches known trigger words; linguistic_audit
catches typographic/locale slips; register_gate catches the subtle
statistical register signal that no rule can express.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from .register_manifest import RegisterManifest, default_classifiers_root


_LOG = logging.getLogger(__name__)


# Default settings used when the caller passes an empty / partial config.
_DEFAULTS: dict[str, Any] = {
    "enabled": True,
    "mode": "layer_b_only",        # "layer_b_only" | "hybrid"
    "layer_b_threshold": 0.5,
    "fail_action": "flag",          # "warn" | "flag" | "block"
    "min_pass_fraction": 0.7,
    "max_paragraphs": 400,          # safety cap so a runaway manuscript can't OOM
}


class _LayerBAdapter:
    """Wraps a bare :class:`register_discriminator.LayerB` so its verdict
    matches the HybridDiscriminator JSON shape (``layer_b`` + ``overall_pass``)."""

    def __init__(self, layer_b: Any, *, threshold: float) -> None:
        self._lb = layer_b
        self._threshold = threshold

    def judge_paragraph(self, text: str) -> dict[str, Any]:
        v = self._lb.judge(text, threshold=self._threshold)
        return {
            "layer_b": {"pass": v.pass_, "score": v.score, "explanation": v.explanation},
            "overall_pass": v.pass_,
        }


class _HybridAdapter:
    """Wraps :class:`register_discriminator.HybridDiscriminator` to expose a
    uniform ``judge_paragraph`` name."""

    def __init__(self, hybrid: Any) -> None:
        self._h = hybrid

    def judge_paragraph(self, text: str) -> dict[str, Any]:
        return self._h.judge(text)


class RegisterGate:
    """Settings-driven register-quality gate.

    Construct via :meth:`from_settings` in production; the bare
    constructor is for tests that inject explicit roots.
    """

    def __init__(
        self,
        *,
        enabled: bool = True,
        mode: str = "layer_b_only",
        layer_b_threshold: float = 0.5,
        fail_action: str = "flag",
        min_pass_fraction: float = 0.7,
        max_paragraphs: int = 400,
        classifiers_root: Optional[Path] = None,
        corpus_root: Optional[Path] = None,
        log: Optional[logging.Logger] = None,
    ) -> None:
        self.enabled = enabled
        self.mode = mode
        self.layer_b_threshold = float(layer_b_threshold)
        self.fail_action = fail_action
        self.min_pass_fraction = float(min_pass_fraction)
        self.max_paragraphs = int(max_paragraphs)
        self.classifiers_root = (
            Path(classifiers_root) if classifiers_root else default_classifiers_root()
        )
        self.corpus_root = Path(corpus_root) if corpus_root else None
        self.log = log or _LOG
        self.manifest = RegisterManifest(self.classifiers_root)
        # Per-(discipline, language) loaded-discriminator cache.
        self._cache: dict[tuple[str, str], Any] = {}

    # ------------------------------------------------------------------ #
    # Construction
    # ------------------------------------------------------------------ #

    @classmethod
    def from_settings(
        cls,
        settings: Optional[dict[str, Any]],
        *,
        classifiers_root: Optional[Path] = None,
        corpus_root: Optional[Path] = None,
        log: Optional[logging.Logger] = None,
    ) -> "RegisterGate":
        """Build from the ``orchestrator.register_discriminator`` config block.

        ``settings`` is the plugin settings dict (the whole thing, or just
        the ``register_discriminator`` sub-block — both are accepted).
        Missing keys fall back to :data:`_DEFAULTS`.
        """
        block = cls._extract_block(settings)
        cfg = {**_DEFAULTS, **block}
        # The block can override the classifiers root with a string path
        # (e.g. "~/.vedix/classifiers"); CLI arg wins if provided.
        root = classifiers_root
        if root is None and isinstance(block.get("classifiers_root"), str):
            root = Path(block["classifiers_root"]).expanduser()
        return cls(
            enabled=bool(cfg["enabled"]),
            mode=str(cfg["mode"]),
            layer_b_threshold=float(cfg["layer_b_threshold"]),
            fail_action=str(cfg["fail_action"]),
            min_pass_fraction=float(cfg["min_pass_fraction"]),
            max_paragraphs=int(cfg["max_paragraphs"]),
            classifiers_root=root,
            corpus_root=corpus_root,
            log=log,
        )

    @staticmethod
    def _extract_block(settings: Optional[dict[str, Any]]) -> dict[str, Any]:
        """Pull the register_discriminator block out of any of the
        accepted settings shapes."""
        if not settings:
            return {}
        # Already the sub-block?
        if "layer_b_threshold" in settings or "fail_action" in settings:
            return dict(settings)
        # plugins.vedix.orchestrator.register_discriminator
        try:
            return dict(
                settings["plugins"]["vedix"]["orchestrator"]["register_discriminator"]
            )
        except (KeyError, TypeError):
            pass
        # orchestrator.register_discriminator
        try:
            return dict(settings["orchestrator"]["register_discriminator"])
        except (KeyError, TypeError):
            pass
        # register_discriminator at top level
        if isinstance(settings.get("register_discriminator"), dict):
            return dict(settings["register_discriminator"])
        return {}

    # ------------------------------------------------------------------ #
    # Availability
    # ------------------------------------------------------------------ #

    def available(self, discipline: str, language: str) -> bool:
        """Whether the gate can judge this pair (enabled + model on disk)."""
        return self.enabled and self.manifest.is_available(discipline, language)

    # ------------------------------------------------------------------ #
    # Inference
    # ------------------------------------------------------------------ #

    def _get_discriminator(self, discipline: str, language: str) -> Optional[Any]:
        """Lazily load + cache the discriminator for the pair.

        Returns ``None`` (and logs) when torch/transformers are absent or
        the model fails to load — callers treat that as "skip the gate".
        """
        key = (discipline, language)
        if key in self._cache:
            return self._cache[key]

        model_dir = self.classifiers_root / f"register_{discipline}_{language}"
        if not (model_dir / "model.safetensors").exists() \
                and not (model_dir / "pytorch_model.bin").exists():
            self._cache[key] = None
            return None

        try:
            from .register_discriminator import LayerB, HybridDiscriminator
        except Exception as exc:  # noqa: BLE001
            self.log.warning("register_discriminator import failed: %s", exc)
            self._cache[key] = None
            return None

        try:
            if self.mode == "hybrid" and self.corpus_root is not None:
                disc: Any = _HybridAdapter(
                    HybridDiscriminator(
                        corpus_root=self.corpus_root,
                        classifiers_root=self.classifiers_root,
                        discipline=discipline,
                        language=language,
                    )
                )
            else:
                disc = _LayerBAdapter(
                    LayerB(model_dir=model_dir),
                    threshold=self.layer_b_threshold,
                )
        except Exception as exc:  # noqa: BLE001
            self.log.warning(
                "failed to load register classifier for %s/%s: %s",
                discipline, language, exc,
            )
            self._cache[key] = None
            return None

        self._cache[key] = disc
        return disc

    def judge_paragraph(
        self, text: str, *, discipline: str, language: str,
    ) -> dict[str, Any]:
        """Judge a single paragraph. Returns the verdict dict, or a
        pass-through ``{"skipped": ...}`` shape when the gate can't run."""
        if not self.enabled:
            return {"skipped": True, "reason": "gate_disabled", "overall_pass": True}
        disc = self._get_discriminator(discipline, language)
        if disc is None:
            return {
                "skipped": True,
                "reason": "no_model_or_torch",
                "overall_pass": True,
            }
        return disc.judge_paragraph(text)

    def judge_manuscript(
        self,
        paragraphs: list[str],
        *,
        discipline: str,
        language: str,
        output_dir: Optional[Path] = None,
    ) -> dict[str, Any]:
        """Judge every paragraph; write + return a ``register_audit.json``.

        The returned dict always has ``enabled``, ``available``,
        ``blocked``, and ``pass_fraction`` keys so the stage gate can
        branch on them without a None-check.
        """
        audit: dict[str, Any] = {
            "enabled": self.enabled,
            "mode": self.mode,
            "discipline": discipline,
            "language": language,
            "threshold": self.layer_b_threshold,
            "fail_action": self.fail_action,
            "min_pass_fraction": self.min_pass_fraction,
            "n_paragraphs": len(paragraphs),
            "available": False,
            "skipped": False,
            "blocked": False,
            "n_pass": 0,
            "pass_fraction": 1.0,
            "flagged_paragraphs": [],
            "metrics": {},
        }

        if not self.enabled:
            audit["skipped"] = True
            audit["skip_reason"] = "gate_disabled"
            self._maybe_write(audit, output_dir)
            return audit

        if not self.manifest.is_available(discipline, language):
            audit["skipped"] = True
            audit["skip_reason"] = "no_trained_model_for_pair"
            self._maybe_write(audit, output_dir)
            return audit

        disc = self._get_discriminator(discipline, language)
        if disc is None:
            audit["skipped"] = True
            audit["skip_reason"] = "torch_unavailable_or_load_failed"
            self._maybe_write(audit, output_dir)
            return audit

        audit["available"] = True
        audit["metrics"] = self.manifest.metrics_for(discipline, language)

        capped = paragraphs[: self.max_paragraphs]
        if len(paragraphs) > self.max_paragraphs:
            audit["truncated_to"] = self.max_paragraphs

        n_pass = 0
        flagged: list[dict[str, Any]] = []
        for i, para in enumerate(capped):
            if not para or not para.strip():
                continue
            verdict = disc.judge_paragraph(para)
            passed = bool(verdict.get("overall_pass"))
            if passed:
                n_pass += 1
            else:
                lb = verdict.get("layer_b", {})
                flagged.append({
                    "para_idx": i,
                    "score": lb.get("score"),
                    "explanation": lb.get("explanation"),
                    "text_preview": para[:160] + ("…" if len(para) > 160 else ""),
                })

        n_eval = sum(1 for p in capped if p and p.strip())
        pass_fraction = n_pass / n_eval if n_eval else 1.0
        blocked = (
            self.fail_action == "block" and pass_fraction < self.min_pass_fraction
        )
        audit.update({
            "n_evaluated": n_eval,
            "n_pass": n_pass,
            "pass_fraction": round(pass_fraction, 3),
            "flagged_paragraphs": flagged,
            "blocked": blocked,
        })
        self._maybe_write(audit, output_dir)
        return audit

    # ------------------------------------------------------------------ #

    @staticmethod
    def _maybe_write(audit: dict[str, Any], output_dir: Optional[Path]) -> None:
        if output_dir is None:
            return
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "register_audit.json").write_text(
            json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8",
        )


__all__ = ["RegisterGate"]
