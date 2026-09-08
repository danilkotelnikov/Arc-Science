"""Agent contract and explicitly scripted fixture agent (not an LLM simulation)."""
from typing import Protocol

class Agent(Protocol):
    model: str
    async def propose(self, context: dict) -> dict: ...
    async def assess(self, role: str, context: dict) -> dict: ...

class DemoAgent:
    model = 'scripted-fixture-v1'

    async def propose(self, context):
        if context['round']==0:
            return {'branches':[{'id':'linear','title':'Linear response','hypothesis':'A linear curve adequately describes the fixture.',
                    'falsifier':'Residual structure or substantially worse exploratory validation error than an alternative.','parents':[]}],
                    'actions':[{'id':'fit-linear','branch_id':'linear','tool':'polynomial_fit','arguments':{'degree':1}}],
                    'stop':False,'reason':'Establish a simple baseline before testing a nonlinear alternative.'}
        if context['round']==1:
            return {'branches':[
                 {'id':'quadratic','title':'Curved response','hypothesis':'The response requires a quadratic term.',
                  'falsifier':'No improvement over the linear baseline on the fixed exploratory split.','parents':['linear']},
                 {'id':'null-control','title':'Shuffled-response control','hypothesis':'The fit is indistinguishable from shuffled responses.',
                  'falsifier':'The observed fit has substantially smaller error than shuffled controls.','parents':['linear']}],
              'actions':[{'id':'fit-quadratic','branch_id':'quadratic','tool':'polynomial_fit','arguments':{'degree':2}},
                         {'id':'shuffle-control','branch_id':'null-control','tool':'permutation_control','arguments':{'permutations':16}}],
              'stop':False,'reason':'Reconcile the linear residual challenge against a curved model and a negative control.'}
        return {'branches':[],'actions':[],'stop':True,
                'reason':'Exploratory fixture comparison completed. No biological or confirmatory claim is authorized.'}

    async def assess(self, role, context):
        out=[]
        for o in context['observations']:
            if o['status']!='ok':
                out.append({'branch_id':o['branch_id'],'position':'uncertain','evidence_ids':[o['id']],
                            'finding':'Execution failed; the hypothesis remains unresolved.','next_test':'Repair input or select another valid tool.'})
            elif o['tool']=='polynomial_fit':
                good=o['data']['validation_mse']<.02
                out.append({'branch_id':o['branch_id'],'position':'support' if good else 'challenge','evidence_ids':[o['id']],
                            'finding':('Low error on the exploratory split.' if good else 'The linear fit leaves substantial residual error.') +
                                      (' Adaptive reuse of this split prevents confirmatory interpretation.' if role=='falsifier' else ''),
                            'next_test':'Use independently acquired data before a scientific conclusion.' if good else 'Compare a nonlinear alternative.'})
            else:
                out.append({'branch_id':o['branch_id'],'position':'challenge','evidence_ids':[o['id']],
                            'finding':'The shuffled-response control has substantial error; this is descriptive, not a p-value.',
                            'next_test':'Independent replication.'})
        return {'assessments':out,'summary':'Cross-branch findings retained; no consensus vote authorizes scientific truth.'}
