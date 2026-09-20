"""A stand-in for the Codex CLI: `python fake_codex.py <mode> exec <cli args...>`.

Self-contained on purpose (the transport scrubs the environment, so no PYTHONPATH):
it checks the invocation contract, then answers as JSONL events according to `mode`.
"""
import json
import os
import sys
import time

mode = sys.argv[1]
args = sys.argv[2:]

if args == ['login', 'status']:
    print('Logged in using ChatGPT' if mode != 'logged-out' else 'Not logged in')
    sys.exit(0 if mode != 'logged-out' else 1)
if args == ['--version']:
    print('codex-cli 9.9.9 (fake)')
    sys.exit(0)

PROPOSAL = {'branches': [{'id': 'linear', 'title': 'Linear response', 'hypothesis': 'A linear curve describes the fixture.',
                          'falsifier': 'Residual structure.', 'parents': []}],
            'actions': [{'id': 'fit-linear', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}],
            'stop': False, 'reason': 'Baseline first.'}


def value(flag):
    return args[args.index(flag) + 1] if flag in args else None


def config_entries():
    return [args[i + 1] for i, a in enumerate(args) if a == '-c']


def contract_violations():
    problems = []
    if args[:1] != ['exec'] or args[-1] != '-':
        problems.append('not exec with a stdin prompt')
    for required in ('--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--strict-config'):
        if required not in args:
            problems.append('missing ' + required)
    if value('--sandbox') != 'read-only':
        problems.append('sandbox not read-only')
    if not value('-m'):
        problems.append('model missing')
    schema = value('--output-schema')
    if not schema or not os.path.isfile(schema):
        problems.append('output schema missing')
    else:
        try:
            json.load(open(schema, encoding='utf-8'))
        except ValueError:
            problems.append('output schema not JSON')
    if not value('-o'):
        problems.append('last message file missing')
    if value('-C') != os.getcwd():
        problems.append('working root is not the private directory')
    entries = config_entries()
    for needed in ('web_search="disabled"', 'approval_policy="never"', 'features.shell_tool=false', 'features.apps=false',
                   'features.browser_use=false', 'features.multi_agent=false', 'skills.max_context_tokens=1',
                   'project_doc_max_bytes=0'):
        if needed not in entries:
            problems.append('missing -c ' + needed)
    if any(e.startswith('tools.view_image') for e in entries):
        problems.append('tools.view_image is rejected by --strict-config')
    for secret in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ARC_MODEL_TOKEN_FILE', 'ARC_TEST_SECRET'):
        if secret in os.environ:
            problems.append('environment leaked ' + secret)
    stray = [name for name in os.listdir(os.getcwd()) if not name.endswith('.schema.json') and not name.endswith('.last.txt')]
    if stray:
        problems.append('working directory is not private: ' + ','.join(sorted(stray)))
    return problems


model = value('-m') or 'unknown'
effort = next((e.split('=', 1)[1].strip('"') for e in config_entries() if e.startswith('model_reasoning_effort=')), None)
stdin = sys.stdin.read()
if 'Arc Science' not in stdin.split('\n\n', 1)[0]:
    violations = ['instructions do not lead the prompt']
else:
    violations = contract_violations()
request = json.loads(stdin[stdin.index('{"context"'):])
schema_title = request['response_schema'].get('title', '')


def emit(event):
    print(json.dumps(event))


def answer_text():
    if violations:
        return 'CONTRACT VIOLATION: ' + '; '.join(violations)
    if schema_title == 'ProbeReply':
        return json.dumps({'ok': True})
    if schema_title == 'Proposal':
        return json.dumps(PROPOSAL)
    return json.dumps({'assessments': [], 'summary': 'Nothing observed yet (effort ' + str(effort) + ').'})


emit({'type': 'thread.started', 'thread_id': 'fake-thread'})
emit({'type': 'turn.started'})
# The real CLI reports the excluded skills catalogue as an error item; the contract expects it.
emit({'type': 'item.completed', 'item': {'id': 'item_0', 'type': 'error',
                                         'message': 'Exceeded skills context budget. All skill descriptions were removed and 9 additional skills were not included in the model-visible skills list.'}})
if mode == 'tool':
    emit({'type': 'item.started', 'item': {'id': 'item_1', 'type': 'command_execution', 'command': 'ls'}})
    sys.exit(0)
if mode == 'error-item':
    emit({'type': 'item.completed', 'item': {'id': 'item_1', 'type': 'error', 'message': 'Rate limit reached for this account'}})
if mode == 'turn-failed':
    emit({'type': 'error', 'message': "The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account."})
    emit({'type': 'turn.failed', 'error': {'message': "The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account."}})
    sys.exit(1)
if mode == 'hang':
    time.sleep(30)
if mode == 'garbage':
    print('not json at all')
    sys.exit(0)
text = answer_text()
emit({'type': 'item.completed', 'item': {'id': 'item_2', 'type': 'agent_message', 'text': text}})
if mode == 'two-messages':
    emit({'type': 'item.completed', 'item': {'id': 'item_3', 'type': 'agent_message', 'text': text}})
emit({'type': 'turn.completed', 'usage': {'input_tokens': 120, 'cached_input_tokens': 0, 'output_tokens': 15, 'reasoning_output_tokens': 0}})
if mode != 'no-last':
    with open(value('-o'), 'w', encoding='utf-8') as handle:
        handle.write(text if mode != 'mismatch' else '{"ok": false}')
