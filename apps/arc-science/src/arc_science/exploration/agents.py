"""Agent contract and explicitly scripted fixture agent (not an LLM simulation)."""
from typing import Protocol

class Agent(Protocol):
    model: str
    async def propose(self, context: dict) -> dict: ...
    async def assess(self, role: str, context: dict) -> dict: ...

# Scripted measurable falsifiers: a branch is refuted when the named metric lands on the
# stated side of the threshold. Fixed by this script, never tuned to the data.
FIT_ERROR = {'tool':'polynomial_fit','metric':'validation_mse','threshold':.02,'direction':'above'}

def estimate(role, context, payload):
    """Fixture provenance: usage estimated from text length (about four characters a token)
    so budgets work offline, flagged as an estimate; a fixture costs nothing."""
    from ..contracts import canonical
    return {'transport': 'fixture', 'role': role, 'outcome': 'ok', 'estimated': True, 'usage_source': 'fixture_estimate',
            'usage': {'input_tokens': len(canonical(context)) // 4, 'output_tokens': len(canonical(payload)) // 4},
            'cost_usd': 0.0}


class DemoAgent:
    model = 'scripted-fixture-v1'

    def take_provenance(self, role):
        # Handed over once per call. A scripted subclass that overrides a call without the
        # base method leaves nothing measured, and its record says so instead of guessing.
        found = self.__dict__.get('_usage', {}).pop(role, None)
        return found or {'transport': 'fixture', 'role': role, 'outcome': 'ok', 'usage': None}

    def _estimate(self, role, context, payload):
        self.__dict__.setdefault('_usage', {})[role] = estimate(role, context, payload)
        return payload

    async def propose(self, context):
        return self._estimate('planner', context, self._plan(context))

    def _plan(self, context):
        if context['round']==0:
            return {'branches':[{'id':'linear','title':'Linear response','hypothesis':'A linear curve adequately describes the fixture.',
                    'falsifier':'Residual structure or substantially worse exploratory validation error than an alternative.','parents':[],
                    'falsifier_test':FIT_ERROR}],
                    'actions':[{'id':'fit-linear','branch_id':'linear','tool':'polynomial_fit','arguments':{'degree':1}}],
                    'stop':False,'reason':'Establish a simple baseline before testing a nonlinear alternative.'}
        if context['round']==1:
            return {'branches':[
                 {'id':'quadratic','title':'Curved response','hypothesis':'The response requires a quadratic term.',
                  'falsifier':'No improvement over the linear baseline on the fixed exploratory split.','parents':['linear'],
                  'falsifier_test':FIT_ERROR},
                 {'id':'null-control','title':'Shuffled-response control','hypothesis':'The fit is indistinguishable from shuffled responses.',
                  'falsifier':'The observed fit has substantially smaller error than shuffled controls.','parents':['linear'],
                  'falsifier_test':{'tool':'permutation_control','metric':'minimum_shuffled_validation_mse','threshold':.1,'direction':'above'}}],
              'actions':[{'id':'fit-quadratic','branch_id':'quadratic','tool':'polynomial_fit','arguments':{'degree':2}},
                         {'id':'shuffle-control','branch_id':'null-control','tool':'permutation_control','arguments':{'permutations':16}}],
              'stop':False,'reason':'Reconcile the linear residual challenge against a curved model and a negative control.'}
        return {'branches':[],'actions':[],'stop':True,
                'reason':'Exploratory fixture comparison completed. No biological or confirmatory claim is authorized.'}

    async def assess(self, role, context):
        return self._estimate(role, context, self._assess(role, context))

    def _assess(self, role, context):
        out=[]
        for o in context['observations']:
            if o['status']!='ok':
                out.append({'branch_id':o['branch_id'],'position':'uncertain','evidence_ids':[o['id']],
                            'finding':'Execution failed; the hypothesis remains unresolved.','next_test':'Repair input or select another valid tool.'})
            elif o['tool']=='polynomial_fit':
                # Numbers are written as references to the recorded values (D019), never typed.
                good=o['data']['validation_mse']<.02;error='{{'+o['id']+'.validation_mse}}'
                out.append({'branch_id':o['branch_id'],'position':'support' if good else 'challenge','evidence_ids':[o['id']],
                            'finding':('Low error on the exploratory split: validation error '+error+'.' if good else
                                       'The linear fit leaves substantial residual error: validation error '+error+'.') +
                                      (' Adaptive reuse of this split prevents confirmatory interpretation.' if role=='falsifier' else ''),
                            'next_test':'Use independently acquired data before a scientific conclusion.' if good else 'Compare a nonlinear alternative.'})
            else:
                out.append({'branch_id':o['branch_id'],'position':'challenge','evidence_ids':[o['id']],
                            'finding':'The shuffled-response control has substantial error'
                                      +(' (best shuffle {{'+o['id']+'.minimum_shuffled_validation_mse}})' if o['tool']=='permutation_control' else '')
                                      +'; this is descriptive, not a p-value.',
                            'next_test':'Independent replication.'})
        return {'assessments':out,'summary':'Cross-branch findings retained; no consensus vote authorizes scientific truth.'}


class DemoVisionAgent(DemoAgent):
    """The scripted fixture with a scripted vision seat (not an LLM simulation): the
    first, default-preset render of a round is flagged for legibility so one repair
    cycle runs offline; any repaired render is reported adequate. The verdicts are
    fixed by this script, never by the image."""
    vision_model = 'scripted-vision-fixture-v1'

    async def review_visual(self, context, artifacts):
        from ..contracts import digest
        from .models import VisualFinding, VisualReport
        from .vision import VISUAL_PROMPT_VERSION
        repaired = all(artifact.preset != 'default' for artifact in artifacts)
        findings = () if repaired else tuple(
            VisualFinding(artifact_digest=artifact.digest, severity='minor', category='legibility',
                          detail='Scripted fixture verdict: the default preset is flagged so that one presentation repair cycle runs.')
            for artifact in artifacts)
        report = VisualReport(candidate_digest=context['candidate_digest'],
                              reviewed_digests=tuple(artifact.digest for artifact in artifacts),
                              verdict='adequate' if repaired else 'issues', findings=findings,
                              model=self.vision_model, round=context['round'], prompt_version=VISUAL_PROMPT_VERSION,
                              context_digest=digest(context), input_context=context)
        self._estimate('vision', context, report.manifest())
        return report
