"""Fail-closed SQL checks for remote callers before the existing execution guard."""
from sqlglot import exp, parse
from sqlglot.errors import ErrorLevel, SqlglotError
from sqlglot.optimizer.scope import Scope, traverse_scope

from agent_core.sql_access import SqlAccessError


SAFE_FUNCTIONS = frozenset('''
    ABS AVG CAST CEIL CEILING COALESCE CONCAT CONCAT_WS COUNT DATE DATE_ADD
    DATE_DIFF DATE_FORMAT DATE_SUB DATE_TRUNC DAY EXTRACT FLOOR GREATEST IF
    IFNULL LEAST LENGTH LOWER LTRIM MAX MIN MONTH NULLIF ROUND RTRIM STDDEV
    SUBSTRING SUM TIME TIMESTAMP TIMESTAMP_ADD TIMESTAMP_DIFF TIMESTAMP_SUB
    TRIM UPPER YEAR CURRENT_DATE CURRENT_TIMESTAMP DENSE_RANK LAG LEAD
    RANK ROW_NUMBER STR_TO_DATE GROUP_CONCAT MOD STR_TO_TIME TIME_TO_STR
    TS_OR_DS_TO_DATE TS_OR_DS_TO_TIMESTAMP
'''.split())
FORBIDDEN_NODE_KEYS = frozenset({
    'command', 'ddl', 'dml', 'hint', 'into', 'lock', 'parameter',
    'placeholder', 'sessionparameter', 'setitem', 'propertyeq', 'varmap',
})


def checked_sql(statement, settings):
    text = statement.strip() if isinstance(statement, str) else ''
    if not text or len(text) > 20000 or any(marker in text for marker in ('--', '/*', '#', '@', '\x00')):
        raise SqlAccessError('远程 SQL 为空、过长或含不允许的语法。')
    try:
        expressions = parse(text, read=settings.driver, error_level=ErrorLevel.RAISE)
        if len(expressions) != 1 or not isinstance(expressions[0], (exp.Select, exp.SetOperation)):
            raise SqlAccessError('远程 SQL 只允许一条只读 SELECT / WITH 查询。')
        query = expressions[0]
        table_nodes = set()
        for node in query.walk():
            if node.key in FORBIDDEN_NODE_KEYS or isinstance(node, (exp.DDL, exp.DML)):
                raise SqlAccessError('远程 SQL 包含不允许的语法。')
            if isinstance(node, exp.With) and node.args.get('recursive'):
                raise SqlAccessError('远程 SQL 不支持递归查询。')
            if isinstance(node, exp.Dot) or (isinstance(node, exp.Column) and (node.db or node.catalog)):
                raise SqlAccessError('远程 SQL 不允许跨库或限定命名空间。')
            if isinstance(node, exp.Func):
                name = node.name.upper() if isinstance(node, exp.Anonymous) else node.sql_name().upper()
                if name not in SAFE_FUNCTIONS:
                    raise SqlAccessError('远程 SQL 使用了未批准的函数。')
            if isinstance(node, exp.Table):
                if node.db or node.catalog or not isinstance(node.this, exp.Identifier):
                    raise SqlAccessError('远程 SQL 不允许跨库、限定表名或表函数。')
                table_nodes.add(id(node))
        tables = set()
        for scope in traverse_scope(query):
            selected = scope.selected_sources
            for table in scope.tables:
                table_nodes.discard(id(table))
                source = selected.get(table.alias_or_name)
                if source is None or source[0] is not table or not isinstance(source[1], Scope):
                    # Compare exact spelling: on case-sensitive servers the
                    # same spelling with different case may name another table.
                    tables.add(table.name)
        # Apply the bound to the outer query, even when a nested query already has LIMIT.
        limit = query.args.get('limit')
        if limit:
            count = limit.expression
            if not isinstance(count, exp.Literal) or not count.is_int or int(count.this) < 0:
                raise SqlAccessError('远程 SQL 的 LIMIT 必须是非负整数。')
        if not limit or int(limit.expression.this) > settings.max_rows:
            query = query.limit(settings.max_rows, copy=False)
        if table_nodes or not tables or not tables.issubset(settings.allowed_tables):
            raise SqlAccessError('远程 SQL 只能查询已批准的表。')
        # Generate SQL from the validated AST rather than reusing caller-controlled text.
        return query.sql(dialect=settings.driver, comments=False, unsupported_level=ErrorLevel.RAISE)
    except (SqlglotError, RecursionError) as exc:
        raise SqlAccessError('无法解析远程 SQL。') from exc
