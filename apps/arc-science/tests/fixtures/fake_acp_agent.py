"""A stand-in ACP agent: newline-delimited JSON-RPC over stdio.

`python fake_acp_agent.py <mode>`: initialize, session/new and session/prompt; in
mode `permission` it asks the client for permission and reads a file before answering,
so the client's refusals are visible in the answer.
"""
import json
import os
import sys
import time

mode = sys.argv[1] if len(sys.argv) > 1 else 'success'
pending = {}
counter = 0


def send(message):
    sys.stdout.write(json.dumps(message) + '\n')
    sys.stdout.flush()


def request(method, params):
    global counter
    counter += 1
    send({'jsonrpc': '2.0', 'id': 'agent-' + str(counter), 'method': method, 'params': params})
    while True:
        line = sys.stdin.readline()
        if not line:
            sys.exit(0)
        reply = json.loads(line)
        if reply.get('id') == 'agent-' + str(counter):
            return reply


for line in sys.stdin:
    message = json.loads(line)
    method = message.get('method')
    ident = message.get('id')
    params = message.get('params') or {}
    if method == 'initialize':
        if params.get('clientCapabilities', {}).get('fs', {}).get('readTextFile') is not False:
            send({'jsonrpc': '2.0', 'id': ident, 'error': {'code': -32602, 'message': 'client offered file access'}})
            continue
        send({'jsonrpc': '2.0', 'id': ident, 'result': {'protocolVersion': 1, 'agentInfo': {'name': 'fake-acp', 'version': '0.1'},
                                                     'agentCapabilities': {'loadSession': False}, 'authMethods': []}})
    elif method == 'session/new':
        send({'jsonrpc': '2.0', 'id': ident, 'result': {'sessionId': 'sess-1'}})
    elif method == 'session/prompt':
        text = ''.join(p.get('text', '') for p in params.get('prompt', []) if p.get('type') == 'text')
        refused = []
        if mode == 'permission':
            answer = request('session/request_permission', {'sessionId': 'sess-1', 'toolCall': {'title': 'Run rm -rf'},
                                                            'options': [{'optionId': 'allow', 'kind': 'allow_once'}, {'optionId': 'no', 'kind': 'reject_once'}]})
            refused.append(answer.get('result', {}).get('outcome'))
            answer = request('fs/read_text_file', {'sessionId': 'sess-1', 'path': 'C:/secret.txt'})
            refused.append(answer.get('error', {}).get('code'))
        if mode == 'hang':
            time.sleep(30)
        leaked = [name for name in ('ARC_TEST_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ARC_TOKEN_FILE') if name in os.environ]
        for piece in ('Echo: ', text, ' | refusals=' + json.dumps(refused)) + ((' | LEAKED ' + ','.join(leaked),) if leaked else ()):
            send({'jsonrpc': '2.0', 'method': 'session/update', 'params': {'sessionId': 'sess-1', 'update': {
                'sessionUpdate': 'agent_message_chunk', 'content': {'type': 'text', 'text': piece}}}})
        send({'jsonrpc': '2.0', 'id': ident, 'result': {'stopReason': 'end_turn'}})
    else:
        send({'jsonrpc': '2.0', 'id': ident, 'error': {'code': -32601, 'message': 'unknown ' + str(method)}})
