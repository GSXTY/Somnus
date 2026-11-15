"""A tiny MCP stdio server used by the test suite.

Implements initialize / tools/list / tools/call for a single `echo` tool.
"""
import json
import sys

TOOLS = [{
    'name': 'echo',
    'description': '返回传入的文本',
    'inputSchema': {'type': 'object', 'properties': {'text': {'type': 'string'}}, 'required': ['text']},
}]


def reply(request_id, result):
    sys.stdout.write(json.dumps({'jsonrpc': '2.0', 'id': request_id, 'result': result}) + '\n')
    sys.stdout.flush()


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    message = json.loads(line)
    method = message.get('method')
    if method == 'initialize':
        reply(message['id'], {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}},
                              'serverInfo': {'name': 'echo-server', 'version': '1.0'}})
    elif method == 'tools/list':
        reply(message['id'], {'tools': TOOLS})
    elif method == 'tools/call':
        args = (message.get('params') or {}).get('arguments') or {}
        reply(message['id'], {'content': [{'type': 'text', 'text': f"echo: {args.get('text', '')}"}]})
    elif 'id' in message:
        reply(message['id'], {})
