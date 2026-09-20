"""A stand-in for the Gemini CLI: `python fake_gemini.py <mode> <cli args...>`.

Self-contained on purpose (the transport scrubs the environment, so no PYTHONPATH):
it checks the invocation contract, then answers one JSON document according to `mode`.
"""
import json
import os
import sys
import time

mode = sys.argv[1]
args = sys.argv[2:]

if args == ['--version']:
    print('0.99.0 (Gemini CLI fake)')
    sys.exit(0)

PROPOSAL = {'branches': [{'id': 'linear', 'title': 'Linear response', 'hypothesis': 'A linear curve describes the fixture.',
                          'falsifier': 'Residual structure.', 'parents': []}],
            'actions': [{'id': 'fit-linear', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}],
            'stop': False, 'reason': 'Baseline first.'}


def value(flag):
    return args[args.index(flag) + 1] if flag in args else None


def contract_violations():
    problems = []
    if value('-p') != '':
        problems.append('prompt must be empty (stdin carries it)')
    if value('-o') != 'json':
        problems.append('output not json')
    if value('--approval-mode') != 'plan':
        problems.append('approval mode not plan')
    if '-e' not in args or value('-e') != 'none':
        problems.append('extensions not disabled')
    if not value('-m'):
        problems.append('model missing')
    policy = value('--policy')
    if not policy or not os.path.isfile(policy) or 'decision = "deny"' not in open(policy, encoding='utf-8').read():
        problems.append('deny-all policy missing')
    system = os.environ.get('GEMINI_SYSTEM_MD')
    if not system or not os.path.isfile(system) or 'Arc Science' not in open(system, encoding='utf-8').read():
        problems.append('system prompt file missing')
    settings = os.environ.get('GEMINI_CLI_SYSTEM_SETTINGS_PATH')
    try:
        merged = json.load(open(settings, encoding='utf-8'))
        if merged['hooksConfig']['enabled'] or merged['skills']['enabled'] or merged['admin']['extensions']['enabled'] or merged['admin']['mcp']['enabled']:
            problems.append('system settings leave customizations on')
    except Exception:
        problems.append('system settings file missing')
    for secret in ('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'ARC_TEST_SECRET'):
        if secret in os.environ:
            problems.append('environment leaked ' + secret)
    stray = [name for name in os.listdir(os.getcwd())
             if name not in ('deny-all.toml', 'system-settings.json') and not name.endswith('.system.md')]
    if stray:
        problems.append('working directory is not private: ' + ','.join(sorted(stray)))
    return problems


model = value('-m') or 'unknown'
request = json.loads(sys.stdin.read())
schema_title = request['response_schema'].get('title', '')
violations = contract_violations()


def text():
    if violations:
        return 'CONTRACT VIOLATION: ' + '; '.join(violations)
    if schema_title == 'ProbeReply':
        return json.dumps({'ok': True})
    if schema_title == 'Proposal':
        return json.dumps(PROPOSAL)
    return json.dumps({'assessments': [], 'summary': 'Nothing observed yet.'})


def document(**overrides):
    body = {'session_id': 'fake-session', 'response': text(),
            'stats': {'models': {model: {'api': {'totalRequests': 1, 'totalErrors': 0}, 'tokens': {'input': 100, 'candidates': 20, 'total': 120}}},
                      'tools': {'totalCalls': 0, 'totalSuccess': 0, 'totalFail': 0}}}
    body.update(overrides)
    return json.dumps(body, indent=2)


if mode == 'success':
    print(document())
elif mode == 'ineligible':
    print(document(response=None, stats=None, error={'type': 'IneligibleTierError', 'message': 'IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.'}))
    sys.exit(1)
elif mode == 'tool':
    print(document(stats={'models': {model: {'tokens': {}}}, 'tools': {'totalCalls': 1}}))
elif mode == 'wrong-model':
    print(document(stats={'models': {'gemini-2.5-flash': {'tokens': {}}}, 'tools': {'totalCalls': 0}}))
elif mode == 'dated-model':
    print(document(stats={'models': {model + '-20260901': {'tokens': {'input': 1}}}, 'tools': {'totalCalls': 0}}))
elif mode == 'garbage':
    print('not json at all')
elif mode == 'hang':
    time.sleep(30)
else:
    sys.exit(2)
