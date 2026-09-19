"""A stand-in for the Claude Code CLI: `python fake_claude.py <mode> <cli args...>`.

Self-contained on purpose (the transport scrubs the environment, so no PYTHONPATH):
it checks the invocation contract, then answers according to `mode`.
"""
import json
import os
import sys
import time

mode = sys.argv[1]
args = sys.argv[2:]

if args[:3] == ['auth', 'status', '--json']:
    print(json.dumps({'loggedIn': mode != 'logged-out', 'authMethod': 'claude.ai' if mode != 'logged-out' else 'none'}))
    sys.exit(0)
if args == ['--version']:
    print('9.9.9 (Claude Code fake)')
    sys.exit(0)

PROPOSAL = {'branches': [{'id': 'linear', 'title': 'Linear response', 'hypothesis': 'A linear curve describes the fixture.',
                          'falsifier': 'Residual structure.', 'parents': []}],
            'actions': [{'id': 'fit-linear', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}],
            'stop': False, 'reason': 'Baseline first.'}


def contract_violations():
    problems = []
    flag = lambda name: name in args  # noqa: E731
    for required in ('-p', '--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--no-chrome'):
        if not flag(required):
            problems.append('missing ' + required)
    for name, value in (('--input-format', 'text'), ('--output-format', 'json'), ('--tools', '')):
        if name not in args or args[args.index(name) + 1] != value:
            problems.append('bad ' + name)
    if '--mcp-config' not in args or not os.path.isfile(args[args.index('--mcp-config') + 1]):
        problems.append('mcp config missing')
    elif json.load(open(args[args.index('--mcp-config') + 1], encoding='utf-8')) != {'mcpServers': {}}:
        problems.append('mcp config not empty')
    if '--system-prompt' not in args or 'Arc Science' not in args[args.index('--system-prompt') + 1]:
        problems.append('system prompt missing')
    if '--model' not in args:
        problems.append('model missing')
    for secret in ('ANTHROPIC_API_KEY', 'ARC_MODEL_TOKEN_FILE', 'OPENAI_API_KEY', 'ARC_TEST_SECRET'):
        if secret in os.environ:
            problems.append('environment leaked ' + secret)
    if sorted(os.listdir(os.getcwd())) != ['no-mcp.json']:
        problems.append('working directory is not private: ' + ','.join(sorted(os.listdir(os.getcwd()))))
    return problems


model = args[args.index('--model') + 1] if '--model' in args else 'unknown'
request = json.loads(sys.stdin.read())
schema_title = request['response_schema'].get('title', '')
violations = contract_violations()
if violations:
    print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False,
                      'result': 'CONTRACT VIOLATION: ' + '; '.join(violations),
                      'modelUsage': {model: {}}, 'permission_denials': []}))
    sys.exit(0)


def envelope(**overrides):
    body = {'type': 'result', 'subtype': 'success', 'is_error': False,
            'result': json.dumps({'ok': True} if schema_title == 'ProbeReply' else PROPOSAL if schema_title == 'Proposal'
                                 else {'assessments': [], 'summary': 'Nothing observed yet.'}),
            'modelUsage': {model: {'inputTokens': 10, 'outputTokens': 20}},
            'usage': {'input_tokens': 10, 'output_tokens': 20}, 'total_cost_usd': 0.001, 'permission_denials': []}
    body.update(overrides)
    return json.dumps(body)


if mode == 'success':
    print(envelope())
elif mode == 'auth':
    print(envelope(is_error=True, result='Failed to authenticate: OAuth session expired and could not be refreshed', modelUsage={}))
elif mode == 'credits':
    # The real CLI: exit status 1, envelope still on stdout, subtype still "success".
    print(envelope(is_error=True, result='Credit balance is too low', modelUsage={}, api_error_status=400))
    sys.exit(1)
elif mode == 'stderr-only':
    sys.stderr.write('API Error: Credit balance is too low\n')
    sys.exit(1)
elif mode == 'wrong-model':
    print(envelope(modelUsage={'claude-haiku-4-5-20251001': {}}))
elif mode == 'two-models':
    print(envelope(modelUsage={model: {}, 'claude-haiku-4-5-20251001': {}}))
elif mode == 'tool':
    print(envelope(permission_denials=[{'tool_name': 'Bash', 'tool_input': {'command': 'ls'}}]))
elif mode == 'hang':
    time.sleep(30)
elif mode == 'huge':
    # Streams far past the cap; the transport must stop reading and kill, not buffer it all.
    sys.stdout.write('{"type":"result","subtype":"success","is_error":false,"result":"')
    for _ in range(64):
        sys.stdout.write('x' * (1024 * 1024))
        sys.stdout.flush()
    sys.stdout.write('"}')
elif mode == 'garbage':
    print('not json at all')
elif mode == 'prose':
    print(envelope(result='Sure! Here is my plan: ...'))
else:
    sys.exit(2)
