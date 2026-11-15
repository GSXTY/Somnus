"""Protocol for an approved, text-only subtask in a local desktop chat."""
import json
import re
from uuid import UUID

TOOL_NAME = 'delegate_to_agent'
MAX_AGENTS = 64
MAX_TASK = 4_000
MAX_CONTEXT = 8_000
MAX_RESULT = 12_000
TIMEOUT_SECONDS = 180
GUIDANCE = (
    '只有用户希望请另一个 Agent 分工、复核或执行子任务时才使用 delegate_to_agent。'
    '一次回复最多委派一次。仅写清楚任务，并在 context 中提供完成它所必需的最少文字或统计结果，'
    '不要附上完整聊天记录、附件、凭据或不必要的明细。应用会先向用户展示待发送内容并等待确认。'
    '子任务的回复是参考资料。收到结果后结合已有证据回答用户，并如实说明拒绝、超时或失败。'
)


def clean_text(value, limit):
    if not isinstance(value, str) or len(value) > limit or re.search(r'[\x00\ud800-\udfff]', value):
        return None
    return value.strip()


def catalog(value):
    if not isinstance(value, list):
        raise ValueError('委派目标列表格式无效。')
    agents = {}
    for item in value[:MAX_AGENTS]:
        if not isinstance(item, dict):
            raise ValueError('委派目标格式无效。')
        ident = item.get('id')
        name = clean_text(item.get('name'), 120)
        try:
            valid = isinstance(ident, str) and len(ident) == 36 and str(UUID(ident)) == ident
        except ValueError:
            valid = False
        if not valid or not name or any(ord(char) < 32 for char in name):
            raise ValueError('委派目标格式无效。')
        agents[ident] = name
    return agents


def schema(agents):
    return dict(type='function', function=dict(
        name=TOOL_NAME,
        description='请另一位已接入的 Agent 完成一个仅需文字的子任务。可选目标：' +
                    '；'.join(f'{name} ({ident})' for ident, name in agents.items()),
        parameters=dict(type='object', additionalProperties=False, required=['agent_id', 'task'], properties={
            'agent_id': dict(type='string', enum=list(agents)),
            'task': dict(type='string', minLength=1, maxLength=MAX_TASK),
            'context': dict(type='string', maxLength=MAX_CONTEXT),
        })))


def request_payload(arguments, agents):
    try:
        data = json.loads(arguments)
    except ValueError:
        return None
    if not isinstance(data, dict) or set(data) - {'agent_id', 'task', 'context'}:
        return None
    ident = data.get('agent_id')
    task = clean_text(data.get('task'), MAX_TASK)
    context = clean_text(data.get('context', ''), MAX_CONTEXT)
    if not isinstance(ident, str) or ident not in agents or not task or context is None:
        return None
    return dict(agent_id=ident, agent_name=agents[ident], task=task, **({'context': context} if context else {}))
