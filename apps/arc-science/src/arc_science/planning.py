"""Bounded AND/OR frontier scheduling and dependency-complete context selection.

Priorities are operator/planner estimates, not calibrated probabilities. This module
implements deterministic greedy scheduling, not an optimal proof-search algorithm.
"""
from __future__ import annotations
import math
from typing import Literal
from pydantic import Field
from .contracts import Record, Identifier, Digest, digest

class Task(Record):
    id: Identifier
    cost: float = Field(gt=0)
    priority: float = Field(ge=0)
    requires: frozenset[Identifier] = frozenset()
    any_of: tuple[frozenset[Identifier], ...] = ()
    reads: frozenset[Identifier] = frozenset()
    writes: frozenset[Identifier] = frozenset()


def _topology(records, dependencies):
    by_id = {item.id: item for item in records}
    if len(by_id) != len(records):
        raise ValueError('Duplicate object IDs')
    order, active, visited = [], set(), set()
    def visit(name):
        if name not in by_id:
            raise ValueError('Unbound dependency')
        if name in active:
            raise ValueError('Cyclic dependency')
        if name in visited:
            return
        active.add(name)
        for parent in sorted(dependencies(by_id[name])):
            visit(parent)
        active.remove(name)
        visited.add(name)
        order.append(name)
    for name in sorted(by_id):
        visit(name)
    return by_id, order

class ResearchGraph:
    """A single-controller graph. Durable reservations belong to the workflow service.

    Each any_of group is an OR obligation; different groups are ANDed. Invalidation
    conservatively reopens dependents even when another OR parent remains valid.
    """
    def __init__(self, tasks: list[Task]):
        self.tasks, self.order = _topology(tasks, self.dependencies)
        if any(not group for task in tasks for group in task.any_of):
            raise ValueError('Empty OR obligation')
        self.states = {name: 'pending' for name in self.tasks}
        self.evidence = {}

    @staticmethod
    def dependencies(task):
        return task.requires | frozenset(parent for group in task.any_of for parent in group)

    def ready(self, name):
        task = self.tasks[name]
        return (self.states[name] == 'pending'
                and all(self.states[p] == 'done' for p in task.requires)
                and all(any(self.states[p] == 'done' for p in group) for group in task.any_of))

    def frontier(self, *, budget: float, max_parallel: int = 4) -> list[Task]:
        if not math.isfinite(budget) or budget < 0 or not 1 <= max_parallel <= 64:
            raise ValueError('Invalid finite scheduling limits')
        selected, spent, reads, writes = [], 0.0, set(), set()
        candidates = sorted((t for t in self.tasks.values() if self.ready(t.id)),
                            key=lambda t: (-t.priority / t.cost, t.id))
        for task in candidates:
            if len(selected) >= max_parallel:
                break
            if spent + task.cost > budget:
                continue
            if task.writes & (reads | writes) or task.reads & writes:
                continue
            selected.append(task)
            spent += task.cost
            reads.update(task.reads)
            writes.update(task.writes)
        return selected

    def resolve(self, name: str, *, passed: bool, evidence_digest: str):
        if name not in self.tasks or not self.ready(name):
            raise ValueError('Task is unknown, resolved, or has unsatisfied obligations')
        # Reuse the digest contract rather than accepting arbitrary completion strings.
        evidence = _Completion(evidence_digest=evidence_digest, passed=passed)
        self.states[name] = 'done' if evidence.passed else 'failed'
        self.evidence[name] = evidence.evidence_digest

    def invalidate(self, name: str) -> set[str]:
        if name not in self.tasks:
            raise ValueError('Unknown task')
        affected = {name}
        for child in self.order:
            if self.dependencies(self.tasks[child]) & affected:
                affected.add(child)
        for item in affected:
            self.states[item] = 'pending'
            self.evidence.pop(item, None)
        return affected

class _Completion(Record):
    evidence_digest: Digest
    passed: bool

class ContextRecord(Record):
    id: Identifier
    text: str = Field(min_length=1, max_length=200000)
    tokens: int = Field(gt=0)
    required: bool = False
    kind: Literal['evidence', 'counterevidence', 'instruction', 'background'] = 'evidence'
    priority: float = Field(default=1, ge=0)
    requires: frozenset[Identifier] = frozenset()

class ContextBudgetExceeded(ValueError):
    pass


def compile_context(records: list[ContextRecord], *, token_budget: int) -> list[ContextRecord]:
    """Select a closed context; supplied token counts must come from the runtime tokenizer.

    All counterevidence in the caller-selected scope is mandatory. An infeasible
    budget raises instead of silently removing contradictions or dependencies.
    """
    if isinstance(token_budget, bool) or not isinstance(token_budget, int) or token_budget < 1:
        raise ValueError('Token budget must be a positive integer')
    by_id, order = _topology(records, lambda r: r.requires)
    def closure(names):
        selected = set(names)
        for name in reversed(order):
            if name in selected:
                selected.update(by_id[name].requires)
        return selected
    chosen = closure(r.id for r in records if r.required or r.kind == 'counterevidence')
    def cost(names):
        return sum(by_id[name].tokens for name in names)
    if cost(chosen) > token_budget:
        raise ContextBudgetExceeded('Mandatory context and counterevidence exceed the budget')
    for item in sorted(records, key=lambda r: (-r.priority / r.tokens, r.id)):
        proposed = closure(chosen | {item.id})
        if cost(proposed) <= token_budget:
            chosen = proposed
    return [by_id[name] for name in order if name in chosen]


def context_cache_key(*, project: str, principal: str, policy: str, model: str,
                      prompt: str, tools: str, sources: tuple[str, ...]) -> str:
    if not all((project, principal, policy, model, prompt, tools)):
        raise ValueError('Cache identity must be fully scoped')
    return digest(dict(project=project, principal=principal, policy=policy,
                       model=model, prompt=prompt, tools=tools, sources=sources))

class EvolutionCandidate(Record):
    """Trusted release-service receipt; never deserialize this from model output."""
    origin_run: Identifier
    patch_digest: Digest
    holdout_digest: Digest
    tests_passed: bool
    holdout_passed: bool
    approved_by: Identifier | None = None
    changes_kernel: bool = False

    def can_activate(self, target_run: str) -> bool:
        return bool(target_run and target_run != self.origin_run and not self.changes_kernel
                    and self.tests_passed and self.holdout_passed and self.approved_by)
