"""Routing fixtures: each fixture's expected agents are listed in the corresponding intent row in routing-intents.md."""
import json
import re
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
ROUTING_DOC = PLUGIN_ROOT / "skills" / "vedix" / "routing-intents.md"
FIXTURES = json.load(open(PLUGIN_ROOT / "tests" / "routing-fixtures.json"))["fixtures"]


ALL_TWELVE = {
    "ideator", "codebase-scanner", "literature-searcher", "hypothesizer",
    "code-generator", "experiment-runner", "plotter", "manuscript-writer",
    "citator", "reviewer", "meta-analyst",
    # Note: fixer is dispatched only on errors, not part of any routing intent
}


def _parse_intent_table():
    """Parse routing-intents.md and return {intent_name: set(agent_kebab_names)}.

    Handles three notations in the agents column:
    - Plain comma-separated names: "ideator, hypothesizer"
    - "all 12": expands to ALL_TWELVE
    - Conditional: "code-generator (+ experiment-runner if ...)" — both are
      treated as part of the intent's potential agent set (the conditional
      runs in some inputs but not others; fixtures may include it).
    """
    text = ROUTING_DOC.read_text(encoding="utf-8")
    rows = {}
    in_table = False
    for line in text.splitlines():
        if line.startswith("|") and "Name" in line and "Example" in line:
            in_table = True
            continue
        if not in_table:
            continue
        if not line.startswith("|") or "---" in line:
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 5:
            continue
        try:
            _ = int(cells[0])  # number column — skips header/separator
        except ValueError:
            continue
        name = cells[1]
        agents_text = cells[3]

        # Special: "all 12" → all eleven primary agents
        if "all 12" in agents_text or "all twelve" in agents_text.lower():
            rows[name] = set(ALL_TWELVE)
            continue

        # Special: "none" → empty
        if agents_text.strip().lower().startswith("none"):
            rows[name] = set()
            continue

        agents = set()
        # Strip parenthesized "if ..." conditions but keep the agents inside
        # e.g., "code-generator (+ experiment-runner if 'and run')" →
        # "code-generator, experiment-runner"
        cleaned = re.sub(r"\(\s*\+\s*([^)]+?)\s*if\s*[^)]+\)", r", \1", agents_text)
        cleaned = re.sub(r"\(.*?\)", "", cleaned)  # any other parens

        for tok in re.split(r"[,/]", cleaned):
            tok = tok.strip().strip("+").strip()
            if not tok or tok in ("etc", "etc.", "—", "-"):
                continue
            agents.add(tok)
        rows[name] = agents
    return rows


@pytest.fixture(scope="module")
def intent_table():
    return _parse_intent_table()


def _strip_prefix(agent: str) -> str:
    return agent.removeprefix("ai-scientist-")


@pytest.mark.parametrize("fx", FIXTURES, ids=lambda f: f["id"])
def test_fixture_agents_subset_of_intent(fx, intent_table):
    intent = fx["expected_intent"]
    expected = {_strip_prefix(a) for a in fx["expected_agents"]}
    if intent == "ambiguous":
        assert not expected, "ambiguous intent must have empty expected_agents"
        return
    assert intent in intent_table, \
        f"intent {intent!r} not in routing-intents.md (parsed: {sorted(intent_table)})"
    declared = intent_table[intent]
    missing = expected - declared
    assert not missing, \
        f"fixture {fx['id']!r} expects {missing} but routing doc declares {declared}"
