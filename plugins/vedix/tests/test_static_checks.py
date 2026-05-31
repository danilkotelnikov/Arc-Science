"""Static checks: every agent file has required frontmatter fields."""
import re
from pathlib import Path

import pytest
import yaml

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = PLUGIN_ROOT / "agents"

EXPECTED_AGENTS = {
    "ideator", "codebase-scanner", "literature-searcher",
    "hypothesizer", "code-generator", "experiment-runner",
    "plotter", "manuscript-writer", "citator", "reviewer",
    "meta-analyst", "fixer",
    "vlm-reviewer",                 # Tier B
    "tree-search-runner",           # Tier C
    "codex-cross-validator",        # Codex bridge (CC-exclusive)
    "slide-presenter",              # Phase E §8.4
}

# SGCA-class agents use a distinct frontmatter schema (name + description
# + agent_class + preferred_providers) rather than the classic
# model/thinking/tools block, so they live on disk but are exempt from the
# classic-frontmatter parametrized test below.
SGCA_AGENTS = {
    "paper-extractor",              # SGCA §3.1 KGFragment extractor
}

REQUIRED_FRONTMATTER_KEYS = {"name", "description", "model", "thinking", "tools"}
ALLOWED_MODELS = {"opus", "sonnet", "haiku", "inherit"}


def parse_frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        raise AssertionError(f"{path.name}: no YAML frontmatter")
    return yaml.safe_load(m.group(1))


def test_all_expected_agents_exist():
    found = {p.stem for p in AGENTS_DIR.glob("*.md")}
    allowed = EXPECTED_AGENTS | SGCA_AGENTS
    missing = EXPECTED_AGENTS - found
    extra = found - allowed
    assert not missing, f"missing agent files: {missing}"
    assert not extra, f"unexpected agent files: {extra}"


@pytest.mark.parametrize("agent_name", sorted(EXPECTED_AGENTS))
def test_agent_has_required_frontmatter(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    missing = REQUIRED_FRONTMATTER_KEYS - set(fm.keys())
    assert not missing, f"{agent_name}.md missing frontmatter keys: {missing}"


@pytest.mark.parametrize("agent_name", sorted(EXPECTED_AGENTS))
def test_agent_model_valid(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    assert fm["model"] in ALLOWED_MODELS, f"{agent_name}.md: invalid model {fm['model']!r}"


@pytest.mark.parametrize("agent_name", sorted(EXPECTED_AGENTS))
def test_agent_thinking_block(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    thinking = fm["thinking"]
    assert isinstance(thinking, dict), f"{agent_name}.md: thinking must be dict"
    assert "enabled" in thinking and "budget_tokens" in thinking, \
        f"{agent_name}.md: thinking needs enabled+budget_tokens"
    assert isinstance(thinking["budget_tokens"], int), \
        f"{agent_name}.md: budget_tokens must be int"
    assert 0 <= thinking["budget_tokens"] <= 128000, \
        f"{agent_name}.md: budget_tokens out of range"


@pytest.mark.parametrize("agent_name", sorted(EXPECTED_AGENTS))
def test_agent_tools_list(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    tools = fm["tools"]
    assert isinstance(tools, list) and len(tools) > 0, \
        f"{agent_name}.md: tools must be non-empty list"


# Codex-compatibility checks: each agent must declare codex.model + reasoning_effort.
# Heavy roles (5 GPT-5.5 xhigh) must use 1.05M context + 128k output.
HEAVY_AGENTS = {"ideator", "hypothesizer", "code-generator", "manuscript-writer", "reviewer", "vlm-reviewer", "tree-search-runner"}
LIGHT_AGENTS = EXPECTED_AGENTS - HEAVY_AGENTS
ALLOWED_CODEX_MODELS = {"gpt-5.5", "gpt-5.4", "gpt-5.3", "inherit"}
ALLOWED_REASONING_EFFORTS = {"low", "medium", "high", "xhigh"}


@pytest.mark.parametrize("agent_name", sorted(EXPECTED_AGENTS))
def test_agent_has_codex_block(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    assert "codex" in fm, f"{agent_name}.md: missing 'codex:' frontmatter block"
    codex = fm["codex"]
    assert codex.get("model") in ALLOWED_CODEX_MODELS, \
        f"{agent_name}.md: codex.model must be one of {ALLOWED_CODEX_MODELS}, got {codex.get('model')!r}"
    assert codex.get("reasoning_effort") in ALLOWED_REASONING_EFFORTS, \
        f"{agent_name}.md: codex.reasoning_effort must be one of {ALLOWED_REASONING_EFFORTS}"
    assert isinstance(codex.get("max_output_tokens"), int), \
        f"{agent_name}.md: codex.max_output_tokens must be int"


# The 5 "core heavy" agents must all use the maximum tier; the Tier B/C
# specialized heavies (vlm-reviewer, tree-search-runner) get heavy models
# but smaller output caps because their outputs are structured (JSON, not
# long-form prose).
CORE_HEAVY_AGENTS = {"ideator", "hypothesizer", "code-generator", "manuscript-writer", "reviewer"}


@pytest.mark.parametrize("agent_name", sorted(CORE_HEAVY_AGENTS))
def test_heavy_agent_max_context_and_output(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    codex = fm["codex"]
    assert codex["model"] == "gpt-5.5", \
        f"{agent_name}.md: heavy agent must use gpt-5.5"
    assert codex["reasoning_effort"] == "xhigh", \
        f"{agent_name}.md: heavy agent must use reasoning_effort=xhigh"
    assert codex["max_output_tokens"] == 128000, \
        f"{agent_name}.md: heavy agent must have max_output_tokens=128000, got {codex['max_output_tokens']}"
    assert codex.get("context_window") == 1050000, \
        f"{agent_name}.md: heavy agent must have context_window=1050000, got {codex.get('context_window')}"


@pytest.mark.parametrize("agent_name", sorted(LIGHT_AGENTS))
def test_light_agent_uses_gpt54_high(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    codex = fm["codex"]
    assert codex["model"] == "gpt-5.4", \
        f"{agent_name}.md: light agent must use gpt-5.4"
    assert codex["reasoning_effort"] == "high", \
        f"{agent_name}.md: light agent must use reasoning_effort=high"


# Gemini-compatibility checks
ALLOWED_GEMINI_MODELS = {
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "inherit",
}
ALLOWED_THINKING_LEVELS = {"low", "medium", "high"}


@pytest.mark.parametrize("agent_name", sorted(EXPECTED_AGENTS))
def test_agent_has_gemini_block(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    assert "gemini" in fm, f"{agent_name}.md: missing 'gemini:' frontmatter block"
    gem = fm["gemini"]
    assert gem.get("model") in ALLOWED_GEMINI_MODELS, \
        f"{agent_name}.md: gemini.model must be one of {ALLOWED_GEMINI_MODELS}, got {gem.get('model')!r}"
    assert isinstance(gem.get("max_output_tokens"), int), \
        f"{agent_name}.md: gemini.max_output_tokens must be int"
    assert isinstance(gem.get("context_window"), int), \
        f"{agent_name}.md: gemini.context_window must be int"
    # Either thinking_level (Gemini 3.x Pro) or thinking_budget (Flash + 2.5)
    has_level = "thinking_level" in gem
    has_budget = "thinking_budget" in gem
    assert has_level ^ has_budget, \
        f"{agent_name}.md: must declare exactly ONE of thinking_level / thinking_budget"
    if has_level:
        assert gem["thinking_level"] in ALLOWED_THINKING_LEVELS, \
            f"{agent_name}.md: invalid thinking_level"
    if has_budget:
        assert isinstance(gem["thinking_budget"], int) and 0 <= gem["thinking_budget"] <= 32768, \
            f"{agent_name}.md: thinking_budget out of range"


@pytest.mark.parametrize("agent_name", sorted(HEAVY_AGENTS))
def test_heavy_agent_uses_gemini3_pro_high(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    gem = fm["gemini"]
    assert gem["model"] == "gemini-3.1-pro-preview", \
        f"{agent_name}.md: heavy agent must use gemini-3.1-pro-preview"
    assert gem.get("thinking_level") == "high", \
        f"{agent_name}.md: heavy agent must use thinking_level=high"
    # Tier B/C heavies (vlm-reviewer, tree-search-runner) get 2M context too
    # but may have different output caps because their outputs are structured.
    assert gem["context_window"] == 2000000, \
        f"{agent_name}.md: heavy agent must use context_window=2000000"


@pytest.mark.parametrize("agent_name", sorted(LIGHT_AGENTS))
def test_light_agent_uses_gemini3_flash(agent_name):
    fm = parse_frontmatter(AGENTS_DIR / f"{agent_name}.md")
    gem = fm["gemini"]
    assert gem["model"] == "gemini-3-flash-preview", \
        f"{agent_name}.md: light agent must use gemini-3-flash-preview"
    assert "thinking_budget" in gem, \
        f"{agent_name}.md: light agent must use thinking_budget (not thinking_level)"
