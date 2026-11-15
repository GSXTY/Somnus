"""Authorization-aware data tools exposed through the native ACP bridge."""
from dataclasses import replace
import csv
import io
import json
from pathlib import Path
import re

from agent_core.sql_access import SqlAccessError, SqlSettings, run, schema
from agent_core.sql_agent import propose_sql
from deep_analysis.service import AnalysisError

from .external_context import IDENTIFIER, TABLE_OWNER, TABLE_UPLOAD_LIMIT, table_record
from .permissions import allowed


SCHEMA, QUERY = 'list_database_schema', 'query_database'
PROJECT_SEARCH = 'search_project_files'
PROJECT_TESTS = 'run_project_tests'
PROJECT_GIT_DIFF = 'project_git_diff'
NATIVE_PROJECT_TOOLS = frozenset({PROJECT_TESTS, PROJECT_GIT_DIFF})
ATTACHED, ANALYZE, STATUS = ('create_deep_analysis', 'create_deep_analysis_from_query', 'get_deep_analysis_task')
DATA_NAMES = frozenset({SCHEMA, QUERY, ATTACHED, ANALYZE, STATUS})
TOOL_NAME = re.compile(r'[A-Za-z0-9_-]{1,64}')
MAX_RESULT_CHARS = 28000
MAX_LOCAL_ROWS = 2000
MAX_REMOTE_MODEL_ROWS = 50


def _tool(name, description, properties, required=()):
    return dict(name=name, description=description,
                inputSchema=dict(type='object', properties={key: dict(type='string', description=value)
                                                           for key, value in properties.items()},
                                 required=list(required), additionalProperties=False))


SECURE_TOOLS = (
    _tool(SCHEMA, '查看已授权数据库表和字段。可提供 table 查看一张表的详细字段。', {'table': '已授权的表名'}),
    _tool(QUERY, '执行已授权数据库只读查询。提供 question（自然语言）或 sql（单条 SELECT）。',
          {'question': '自然语言查询', 'sql': '已授权表的 SELECT 或 WITH 语句'}),
    _tool(ATTACHED, '分析本轮明确添加的表格，创建深度分析任务。', {'question': '分析问题'}, ('question',)),
    _tool(ANALYZE, '查询已授权数据库，将实际查询结果交给深度分析。提交后返回任务编号。',
          {'db_question': '自然语言查询', 'sql': '已授权表的 SELECT 或 WITH 语句', 'analysis_question': '分析问题'},
          ('analysis_question',)),
    _tool(STATUS, '查看当前会话创建的深度分析任务状态、报告与产物。',
          {'task_id': '该会话的深度分析任务编号'}, ('task_id',)),
)
FIELDS = {item['name']: set(item['inputSchema']['properties']) for item in SECURE_TOOLS}


class ToolError(ValueError):
    pass


def configured_data_tools(remote, local_deep, *, attached):
    remote_mode = getattr(remote, 'mode', 'local')
    if remote_mode != 'local':
        use_sql = deep = remote_mode == 'remote'
    else:
        use_sql = bool(SqlSettings.from_env().allowed_tables)
        deep = local_deep is not None
    enabled = {SCHEMA, QUERY} if use_sql else set()
    if deep:
        enabled.add(STATUS)
        if attached:
            enabled.add(ATTACHED)
        if use_sql:
            enabled.add(ANALYZE)
    return [item for item in SECURE_TOOLS if item['name'] in enabled]


def schemas(permission, data_tools, chat_specs, *, mcp_policy, project_search=None):
    tools = [item for item in data_tools if allowed(permission, item['name'])]
    if project_search and allowed(permission, PROJECT_SEARCH):
        description, properties, required = project_search
        tools.append(dict(name=PROJECT_SEARCH, description=description, inputSchema=dict(
            type='object', properties=properties, required=required, additionalProperties=False)))
        tools.extend(item for item in PROJECT_DEVELOPMENT_TOOLS if allowed(permission, item['name']))
    for spec in chat_specs:
        tool = spec['function']
        if tool['name'].startswith('mcp__') and TOOL_NAME.fullmatch(tool['name']):
            item = dict(name=tool['name'], description=tool.get('description', ''), inputSchema=tool['parameters'])
            if mcp_policy(tool['name']) != 'read':
                item['requires_confirmation'] = True
            tools.append(item)
    return tools[:128]


PROJECT_DEVELOPMENT_TOOLS = (
    _tool(PROJECT_GIT_DIFF, '查看当前项目已授权的 Git 仓库工作区差异。省略 source 时使用主目录。',
          {'source': '来源标识，例如 source_1', 'path': '可选的 Git 仓库相对文件路径'}),
    dict(_tool(PROJECT_TESTS,
               '请用户逐次确认运行项目中已保存的测试。测试使用当前磁盘内容。已有修改提案时，先让用户应用修改，再发起测试。',
               {'preset_id': '用户已保存的测试预设 ID'}, ('preset_id',)), requires_confirmation=True),
)


def response(text, *, error=False):
    return dict(content=[dict(type='text', text=text)], isError=error)


def _json_response(data):
    text = json.dumps(data, ensure_ascii=False, default=str)
    if len(text) <= MAX_RESULT_CHARS:
        return response(text)
    return response('工具结果超过大小限制。请缩小查询或查看 Somnus 中的完整结果。', error=True)


def _text(arguments, key, limit, *, optional=False):
    value = arguments.get(key)
    if value is None and optional:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit or '\0' in value:
        raise ToolError('请填写有效的查询、任务编号或分析问题。')
    return value.strip()


def _query(source, arguments, *, analysis=False):
    question = _text(arguments, 'db_question' if analysis else 'question', 2000, optional=True)
    statement = _text(arguments, 'sql', 20000, optional=True)
    if (question is None) == (statement is None):
        raise ToolError('请提供自然语言查询或 SQL 两者之一。')
    if getattr(source, 'mode', 'local') == 'remote':
        if statement:
            return source.request_tool_data('/api/sql/query', 'POST', fields={'sql': statement})
        return source.request_tool_data('/api/sql/ask', 'POST', fields={'question': question})
    settings = SqlSettings.from_env()
    if not settings.allowed_tables:
        raise ToolError('尚未配置授权数据表。')
    # Use the gateway's AST guard so optional raw SQL and model-generated SQL
    # both preserve table scope (including joins and qualified names).
    from data_gateway.sql_policy import checked_sql
    maximum = MAX_LOCAL_ROWS if analysis else MAX_REMOTE_MODEL_ROWS
    settings = replace(settings, max_rows=min(settings.max_rows, maximum))
    if question:
        statement = propose_sql(question, schema(settings))
    checked = checked_sql(statement, settings)
    # AST provenance is already checked (CTE names are not physical tables).
    result = run(checked, replace(settings, allowed_tables=()))
    if len(result['rows']) >= settings.max_rows:
        result['truncated'] = True
    return result


def _table_result(source, result):
    columns = result.get('columns', [])
    rows = result.get('rows', [])
    capped = rows[:MAX_REMOTE_MODEL_ROWS]
    limited = bool(result.get('truncated')) or len(capped) < len(rows)
    packet = dict(source=source, sql=result.get('sql', ''), columns=columns,
                  rows=capped, row_count=len(rows), truncated=limited)
    while len(packet['rows']) > 0 and len(json.dumps(packet, ensure_ascii=False, default=str)) > MAX_RESULT_CHARS:
        packet['rows'] = packet['rows'][:len(packet['rows']) // 2]
        packet['truncated'] = True
    return packet


def _schema_result(source, tables, table=None):
    packet = dict(source=source, table_count=len(tables), tables=tables)
    if table is not None:
        packet['tables'] = [item for item in tables if item['table'] == table]
        if not packet['tables']:
            raise ToolError('该表不在授权范围内。')
    entries = [{**item, 'columns': list(item.get('columns', []))} for item in packet['tables']]
    packet['tables'] = entries
    while len(json.dumps(packet, ensure_ascii=False)) > MAX_RESULT_CHARS:
        largest = max(entries, key=lambda item: len(item['columns']), default=None)
        if not largest or not largest['columns']:
            break
        largest['columns'] = largest['columns'][:len(largest['columns']) // 2]
        largest['columns_truncated'] = True
        packet['truncated'] = True
    return packet


def _analysis_csv(result):
    rows, columns = result.get('rows', []), result.get('columns', [])
    if not rows or not columns:
        raise ToolError('查询返回 0 行，调整范围后可重新分析。')
    stream = io.StringIO(newline='')
    writer = csv.writer(stream, lineterminator='\n')
    writer.writerow(columns)
    writer.writerows(rows)
    data = stream.getvalue().encode('utf-8')
    if len(data) > TABLE_UPLOAD_LIMIT:
        raise ToolError('查询结果超过表格大小限制。请按指标汇总或缩小查询范围。')
    return data


def _attached_csv(stores, file_id):
    record, path = table_record(stores, file_id)
    with path.open('rb') as stream:
        data = stream.read(TABLE_UPLOAD_LIMIT + 1)
    if len(data) > TABLE_UPLOAD_LIMIT:
        raise ToolError('表格超过 5 MiB。请缩小文件后重新上传。')
    return str(Path(record['name']).with_suffix('.csv')), data


def _create_analysis(remote, local_deep, filename, raw, question):
    if getattr(remote, 'mode', 'local') == 'remote':
        uploaded = remote.request_tool_data('/api/deep-analysis/files', 'POST', upload=(filename, raw))
        return remote.request_tool_data('/api/deep-analysis/tasks', 'POST',
                                        fields=dict(file_id=uploaded['file']['id'], question=question))['task']
    source = local_deep.upload(TABLE_OWNER, filename, raw)
    return local_deep.create_task(TABLE_OWNER, source['id'], question)


def _analysis_status(remote, local_deep, task_id):
    if getattr(remote, 'mode', 'local') == 'remote':
        return remote.request_tool_data(f'/api/deep-analysis/tasks/{task_id}', 'GET')['task']
    return local_deep.get_task(TABLE_OWNER, task_id)


def _analysis_packet(task, *, full=False):
    result = dict(task_id=task['id'], status=task['status'], page='/#deep-analysis')
    if task.get('error_code'):
        result['error_code'] = task['error_code']
    if full:
        result['answer'] = str(task.get('answer') or '')[:12000]
        result['artifacts'] = [dict(name=item.get('name', '')[:150], type=item.get('mime', ''),
                                    url=item['url'])
                               for item in task.get('artifacts', [])[:20]
                               if re.fullmatch(r'/api/deep-analysis/artifacts/[a-f0-9]{32}', str(item.get('url')))]
    return result


def call_data_tool(name, arguments, *, remote, local_deep, attached, stores, known_tasks, on_task):
    if set(arguments) - FIELDS[name]:
        return response('工具参数无效。', error=True)
    try:
        remote_mode = getattr(remote, 'mode', 'local')
        source = '远程只读网关' if remote_mode == 'remote' else '本机配置的授权只读数据库'
        if name == SCHEMA:
            table = _text(arguments, 'table', 128, optional=True)
            if remote_mode == 'remote':
                tables = remote.request_tool_data('/api/sql/schema', 'GET')['tables']
            else:
                settings = SqlSettings.from_env()
                if not settings.allowed_tables:
                    raise ToolError('尚未配置授权数据表。')
                tables = schema(settings)
            return _json_response(_schema_result(source, tables, table))
        if name == QUERY:
            return _json_response(_table_result(source, _query(remote, arguments)))
        if name == STATUS:
            task_id = _text(arguments, 'task_id', 32)
            if not IDENTIFIER.fullmatch(task_id) or task_id not in known_tasks:
                raise ToolError('请使用当前会话创建的任务编号。')
            return _json_response(_analysis_packet(_analysis_status(remote, local_deep, task_id), full=True))
        if name == ATTACHED:
            question = _text(arguments, 'question', 2000)
            filename, raw = _attached_csv(stores, attached)
        else:
            question = _text(arguments, 'analysis_question', 2000)
            result = _query(remote, arguments, analysis=True)
            if result.get('truncated'):
                question = '查询结果达到行数上限，分析仅覆盖已返回数据。' + question
            filename, raw = 'authorized-query.csv', _analysis_csv(result)
        task = _create_analysis(remote, local_deep, filename, raw, question)
        on_task(task['id'])
        return _json_response(_analysis_packet(task))
    except ToolError as exc:
        return response(str(exc), error=True)
    except SqlAccessError:
        return response('只读查询未通过校验或执行失败。请核对授权表、字段及查询范围。', error=True)
    except AnalysisError as exc:
        return response(f'深度分析请求失败（{exc.code}）。请检查表格和分析服务状态。', error=True)
    except (OSError, ImportError, ValueError, KeyError, TypeError):
        return response('数据工具未返回可用结果。请在 Somnus 检查数据连接或分析服务。', error=True)
