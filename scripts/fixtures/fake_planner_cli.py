"""A stand-in for the Claude Code CLI for the native journeys (`scripts/native-journeys.mjs`:
`interrupt-kill` and `interrupt-reopen`, wrapped by the generated `fake-claude.cmd`): answers
`auth status --json`, `--version`, and `-p` calls with a planner that asks the fake MCP echo
tool once per round for two rounds, then stops. It sleeps so a person (or the journey)
can revoke a grant or kill the service between rounds. The MCP side is
`apps/arc-science/tests/fixtures/fake_mcp_server.py`. Nothing leaves this machine."""
import json
import sys
import time

args = sys.argv[1:]
# An optional leading `--arc-sleep N` (from a wrapper .cmd) sets the per-call delay so a
# native journey can interrupt the service while a planner call is in flight.
SLEEP = 4
if args[:1] == ['--arc-sleep']:
    SLEEP = int(args[1])
    args = args[2:]
if args[:2] == ['auth', 'status']:
    print(json.dumps({'loggedIn': True, 'authMethod': 'fake-local', 'apiProvider': 'fake'}))
    sys.exit(0)
if args == ['--version']:
    print('0.0.0-fake-planner')
    sys.exit(0)
model = args[args.index('--model') + 1] if '--model' in args else 'fake'
request = json.loads(sys.stdin.read())
ctx = request['context']
schema = request['response_schema'].get('title')
time.sleep(SLEEP)
if schema == 'ProbeReply':
    text = json.dumps({'ok': True})
elif schema == 'Reconciliation':
    text = json.dumps({'assessments': [], 'summary': 'The echo answered; nothing scientific follows.'})
else:
    asked = [o for o in ctx['observations'] if o['tool'].startswith('mcp_')]
    if len(asked) >= 2:
        text = json.dumps({'branches': [], 'actions': [], 'stop': True, 'reason': 'Asked the connector twice; stopping.'})
    else:
        text = json.dumps({'branches': [{'id': 'echo', 'title': 'Connector answers', 'hypothesis': 'The echo tool answers.',
                                         'falsifier': 'It does not answer.', 'parents': []}] if not ctx['branches'] else [],
                           'actions': [{'id': 'ask-' + str(len(asked) + 1), 'branch_id': 'echo', 'tool': 'mcp_fake_echo',
                                        'arguments': {'text': 'ping', 'times': 1}}],
                           'stop': False, 'reason': 'ask the connector'})
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': text, 'modelUsage': {model: {}},
                  'usage': {'input_tokens': 1, 'output_tokens': 1}, 'permission_denials': []}))
