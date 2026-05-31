"""Tests for the register-quality gate + manifest reader.

These exercise the pipeline-integration seam (``register_gate`` +
``register_manifest``) WITHOUT loading torch: the gate's discriminator
cache is pre-seeded with a fake judge so the real model load is never
reached. This is the same graceful-degradation path production uses
when a model is present but we want deterministic behaviour.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from plugins.vedix.mcp.lib.orchestrator.register_manifest import RegisterManifest
from plugins.vedix.mcp.lib.orchestrator.register_gate import RegisterGate


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


def _make_pair(root: Path, discipline: str, language: str, f1: float = 0.99) -> Path:
    """Create a register_<d>_<l>/ dir shaped like a trained model output."""
    d = root / f"register_{discipline}_{language}"
    d.mkdir(parents=True, exist_ok=True)
    # model.safetensors presence is what is_available() keys on.
    (d / "model.safetensors").write_bytes(b"FAKE_WEIGHTS")
    (d / "metrics.json").write_text(
        json.dumps({"f1": f1, "accuracy": f1 - 0.002, "model": "xlm-roberta-base"}),
        encoding="utf-8",
    )
    return d


class _FakeDisc:
    """A discriminator whose verdict is keyed on a substring rule:
    paragraphs containing 'AI-MUSH' fail; everything else passes."""

    def judge_paragraph(self, text: str) -> dict:
        passed = "AI-MUSH" not in text
        score = 0.95 if passed else 0.05
        return {
            "layer_b": {
                "pass": passed,
                "score": score,
                "explanation": f"P(in-register) = {score:.3f}",
            },
            "overall_pass": passed,
        }


# --------------------------------------------------------------------------- #
# RegisterManifest
# --------------------------------------------------------------------------- #


def test_manifest_lists_available_pairs(tmp_path: Path) -> None:
    _make_pair(tmp_path, "chemistry", "en", f1=0.9934)
    _make_pair(tmp_path, "computer_science", "en", f1=0.9794)
    man = RegisterManifest(tmp_path)
    pairs = man.available_pairs()
    names = {p["name"] for p in pairs}
    assert names == {"register_chemistry_en", "register_computer_science_en"}
    # Multi-underscore discipline parses correctly.
    cs = next(p for p in pairs if p["name"] == "register_computer_science_en")
    assert cs["discipline"] == "computer_science"
    assert cs["language"] == "en"
    assert cs["f1"] == 0.9794


def test_manifest_is_available_and_metrics(tmp_path: Path) -> None:
    _make_pair(tmp_path, "physics", "en", f1=0.9924)
    man = RegisterManifest(tmp_path)
    assert man.is_available("physics", "en") is True
    assert man.is_available("physics", "ru") is False
    assert man.metrics_for("physics", "en")["f1"] == 0.9924
    assert man.metrics_for("physics", "ru") == {}


def test_manifest_ignores_dirs_without_weights(tmp_path: Path) -> None:
    # A dir with metrics but no weights is not "available".
    d = tmp_path / "register_geology_en"
    d.mkdir()
    (d / "metrics.json").write_text(json.dumps({"f1": 0.99}), encoding="utf-8")
    man = RegisterManifest(tmp_path)
    assert man.is_available("geology", "en") is False
    assert man.available_pairs() == []


def test_manifest_summary_aggregates(tmp_path: Path) -> None:
    _make_pair(tmp_path, "chemistry", "en", f1=0.99)
    _make_pair(tmp_path, "biology", "en", f1=0.98)
    summary = RegisterManifest(tmp_path).summary()
    assert summary["n_pairs"] == 2
    assert summary["mean_f1"] == pytest.approx(0.985, abs=1e-3)
    assert summary["by_language"] == {"en": 2}


# --------------------------------------------------------------------------- #
# RegisterGate — settings parsing
# --------------------------------------------------------------------------- #


def test_gate_from_full_settings_dict(tmp_path: Path) -> None:
    settings = {
        "plugins": {"vedix": {"orchestrator": {"register_discriminator": {
            "enabled": True, "mode": "layer_b_only",
            "layer_b_threshold": 0.6, "fail_action": "block",
            "min_pass_fraction": 0.8, "max_paragraphs": 200,
        }}}}
    }
    gate = RegisterGate.from_settings(settings, classifiers_root=tmp_path)
    assert gate.enabled is True
    assert gate.layer_b_threshold == 0.6
    assert gate.fail_action == "block"
    assert gate.min_pass_fraction == 0.8
    assert gate.max_paragraphs == 200


def test_gate_from_subblock_directly(tmp_path: Path) -> None:
    gate = RegisterGate.from_settings(
        {"layer_b_threshold": 0.4, "fail_action": "warn"},
        classifiers_root=tmp_path,
    )
    assert gate.layer_b_threshold == 0.4
    assert gate.fail_action == "warn"
    # Unspecified keys fall back to defaults.
    assert gate.enabled is True
    assert gate.mode == "layer_b_only"


def test_gate_from_empty_settings_uses_defaults(tmp_path: Path) -> None:
    gate = RegisterGate.from_settings(None, classifiers_root=tmp_path)
    assert gate.enabled is True
    assert gate.fail_action == "flag"
    assert gate.min_pass_fraction == 0.7


# --------------------------------------------------------------------------- #
# RegisterGate — graceful degradation
# --------------------------------------------------------------------------- #


def test_gate_disabled_skips_and_passes(tmp_path: Path) -> None:
    _make_pair(tmp_path, "chemistry", "en")
    gate = RegisterGate(enabled=False, classifiers_root=tmp_path)
    audit = gate.judge_manuscript(
        ["any text"], discipline="chemistry", language="en",
    )
    assert audit["skipped"] is True
    assert audit["skip_reason"] == "gate_disabled"
    assert audit["blocked"] is False


def test_gate_no_model_skips_gracefully(tmp_path: Path) -> None:
    # No model dir at all for this pair.
    gate = RegisterGate(enabled=True, classifiers_root=tmp_path)
    audit = gate.judge_manuscript(
        ["any text"], discipline="chemistry", language="en",
    )
    assert audit["skipped"] is True
    assert audit["skip_reason"] == "no_trained_model_for_pair"
    assert audit["blocked"] is False


def test_gate_available_reflects_model_presence(tmp_path: Path) -> None:
    _make_pair(tmp_path, "biology", "en")
    gate = RegisterGate(enabled=True, classifiers_root=tmp_path)
    assert gate.available("biology", "en") is True
    assert gate.available("biology", "ru") is False
    gate_off = RegisterGate(enabled=False, classifiers_root=tmp_path)
    assert gate_off.available("biology", "en") is False


# --------------------------------------------------------------------------- #
# RegisterGate — judging (fake discriminator injected into cache)
# --------------------------------------------------------------------------- #


def test_gate_judges_manuscript_and_flags_bad_paragraphs(tmp_path: Path) -> None:
    _make_pair(tmp_path, "chemistry", "en", f1=0.9934)
    gate = RegisterGate(
        enabled=True, fail_action="flag", classifiers_root=tmp_path,
    )
    # Pre-seed the cache so torch is never loaded.
    gate._cache[("chemistry", "en")] = _FakeDisc()

    paragraphs = [
        "The catalyst exhibited activity in the 0.1 to 1 mM range.",  # pass
        "AI-MUSH delve into the tapestry of robust frameworks.",      # fail
        "Density functional theory gave a barrier of 0.45 eV.",       # pass
    ]
    out_dir = tmp_path / "job_out"
    audit = gate.judge_manuscript(
        paragraphs, discipline="chemistry", language="en", output_dir=out_dir,
    )
    assert audit["available"] is True
    assert audit["skipped"] is False
    assert audit["n_evaluated"] == 3
    assert audit["n_pass"] == 2
    assert audit["pass_fraction"] == pytest.approx(2 / 3, abs=1e-3)
    assert len(audit["flagged_paragraphs"]) == 1
    assert audit["flagged_paragraphs"][0]["para_idx"] == 1
    # flag mode never blocks
    assert audit["blocked"] is False
    # metrics surfaced from the pair's metrics.json
    assert audit["metrics"]["f1"] == 0.9934
    # artifact written
    written = json.loads((out_dir / "register_audit.json").read_text(encoding="utf-8"))
    assert written["n_pass"] == 2


def test_gate_block_mode_blocks_below_threshold(tmp_path: Path) -> None:
    _make_pair(tmp_path, "chemistry", "en")
    gate = RegisterGate(
        enabled=True, fail_action="block", min_pass_fraction=0.7,
        classifiers_root=tmp_path,
    )
    gate._cache[("chemistry", "en")] = _FakeDisc()

    # 1 pass / 3 = 0.33 < 0.7 → blocked
    paragraphs = [
        "Real academic sentence about kinetics.",
        "AI-MUSH one.",
        "AI-MUSH two.",
    ]
    audit = gate.judge_manuscript(
        paragraphs, discipline="chemistry", language="en",
    )
    assert audit["pass_fraction"] == pytest.approx(1 / 3, abs=1e-3)
    assert audit["blocked"] is True


def test_gate_block_mode_passes_above_threshold(tmp_path: Path) -> None:
    _make_pair(tmp_path, "chemistry", "en")
    gate = RegisterGate(
        enabled=True, fail_action="block", min_pass_fraction=0.7,
        classifiers_root=tmp_path,
    )
    gate._cache[("chemistry", "en")] = _FakeDisc()
    paragraphs = ["Good one.", "Good two.", "Good three.", "AI-MUSH bad."]
    audit = gate.judge_manuscript(
        paragraphs, discipline="chemistry", language="en",
    )
    assert audit["pass_fraction"] == pytest.approx(0.75, abs=1e-3)
    assert audit["blocked"] is False


def test_gate_skips_blank_paragraphs(tmp_path: Path) -> None:
    _make_pair(tmp_path, "chemistry", "en")
    gate = RegisterGate(enabled=True, classifiers_root=tmp_path)
    gate._cache[("chemistry", "en")] = _FakeDisc()
    audit = gate.judge_manuscript(
        ["Good text.", "", "   ", "Another good one."],
        discipline="chemistry", language="en",
    )
    assert audit["n_evaluated"] == 2
    assert audit["n_pass"] == 2


def test_gate_judge_single_paragraph_passthrough_when_disabled(tmp_path: Path) -> None:
    gate = RegisterGate(enabled=False, classifiers_root=tmp_path)
    v = gate.judge_paragraph("x", discipline="chemistry", language="en")
    assert v["skipped"] is True
    assert v["overall_pass"] is True
