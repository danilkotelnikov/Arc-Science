import pytest
from conftest import module


def test_parallel_frontier_honours_dependencies_conflicts_and_budget():
    p=module('planning')
    tasks=[p.Task(id='source',cost=1,priority=1),
      p.Task(id='structure',requires=frozenset({'source'}),cost=2,priority=5,writes=frozenset({'scene'})),
      p.Task(id='literature',requires=frozenset({'source'}),cost=1,priority=4,writes=frozenset({'evidence'})),
      p.Task(id='render',requires=frozenset({'structure'}),cost=1,priority=1,reads=frozenset({'scene'}))]
    graph=p.ResearchGraph(tasks)
    assert [t.id for t in graph.frontier(budget=5)]==['source']
    graph.resolve('source',passed=True,evidence_digest='a'*64)
    assert {t.id for t in graph.frontier(budget=3)}=={'structure','literature'}
    assert len(graph.frontier(budget=1))==1
    graph.resolve('structure',passed=True,evidence_digest='b'*64)
    assert 'render' in {t.id for t in graph.frontier(budget=3)}

def test_failed_route_does_not_destroy_alternative():
    p=module('planning')
    graph=p.ResearchGraph([p.Task(id='a',cost=1,priority=1),p.Task(id='b',cost=1,priority=1),
          p.Task(id='verify',any_of=(frozenset({'a','b'}),),cost=1,priority=1)])
    graph.resolve('a',passed=False,evidence_digest='a'*64)
    assert [t.id for t in graph.frontier(budget=1)]==['b']
    graph.resolve('b',passed=True,evidence_digest='b'*64)
    assert [t.id for t in graph.frontier(budget=1)]==['verify']

def test_invalidation_reopens_only_dependents():
    p=module('planning')
    graph=p.ResearchGraph([p.Task(id='a',cost=1,priority=1),p.Task(id='b',requires=frozenset({'a'}),cost=1,priority=1),
                          p.Task(id='independent',cost=1,priority=1)])
    for name in ('a','b','independent'):graph.resolve(name,passed=True,evidence_digest='a'*64)
    assert graph.invalidate('a')=={'a','b'}
    assert graph.states['independent']=='done' and graph.states['b']=='pending'

def test_cycle_and_unknown_reference_are_rejected():
    p=module('planning')
    for tasks in [[p.Task(id='a',requires=frozenset({'a'}),cost=1,priority=1)],
                  [p.Task(id='a',requires=frozenset({'missing'}),cost=1,priority=1)]]:
        with pytest.raises(ValueError):p.ResearchGraph(tasks)

def test_read_write_conflict_cannot_run_concurrently():
    p=module('planning');graph=p.ResearchGraph([
      p.Task(id='a',writes=frozenset({'x'}),cost=1,priority=2),
      p.Task(id='b',reads=frozenset({'x'}),cost=1,priority=1)])
    assert len(graph.frontier(budget=3))==1

def test_context_never_silently_drops_counterevidence():
    p=module('planning')
    records=[p.ContextRecord(id='for',text='Supporting finding.',tokens=10,required=True),
             p.ContextRecord(id='against',text='Contradictory finding.',tokens=10,kind='counterevidence'),
             p.ContextRecord(id='extra',text='Background.',tokens=20,priority=1)]
    assert {x.id for x in p.compile_context(records,token_budget=20)}=={'for','against'}
    with pytest.raises(p.ContextBudgetExceeded):p.compile_context(records,token_budget=19)

def test_context_dependency_closure_and_scope_cache_key():
    p=module('planning')
    records=[p.ContextRecord(id='raw',text='Raw observation.',tokens=10),
             p.ContextRecord(id='claim',text='Claim.',tokens=10,requires=frozenset({'raw'}),required=True)]
    assert [x.id for x in p.compile_context(records,token_budget=20)]==['raw','claim']
    args=dict(project='p',principal='u',policy='a',model='m',prompt='p',tools='t',sources=('s',))
    first=p.context_cache_key(**args);args['project']='other'
    assert first!=p.context_cache_key(**args)

def test_evolution_cannot_rewrite_current_run_or_kernel():
    p=module('planning')
    candidate=p.EvolutionCandidate(origin_run='run1',patch_digest='a'*64,holdout_digest='b'*64,
             tests_passed=True,holdout_passed=True,approved_by='human:u')
    assert not candidate.can_activate('run1') and candidate.can_activate('run2')
    assert not candidate.model_copy(update={'changes_kernel':True}).can_activate('run2')
    assert not candidate.model_copy(update={'holdout_passed':False}).can_activate('run2')

@pytest.mark.parametrize('budget',[float('inf'),float('nan'),-1])
def test_scheduler_rejects_unbounded_budget(budget):
    p=module('planning');graph=p.ResearchGraph([p.Task(id='a',cost=1,priority=1)])
    with pytest.raises(ValueError):graph.frontier(budget=budget)
