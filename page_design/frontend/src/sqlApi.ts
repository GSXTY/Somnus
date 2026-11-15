export type SqlColumn = { name: string; type: string };
export type SqlTable = { table: string; columns: SqlColumn[] };
export type SqlSchema = { database: string; driver: string; max_rows: number; tables: SqlTable[] };
export type SqlResult = { sql: string; columns: string[]; rows: (string | number | null)[][]; truncated: boolean; elapsed_ms: number };
export type SqlAnswer = SqlResult & { question: string; database: string };

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error: unknown }).error) : `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return payload as T;
}

export const fetchSchema = (signal?: AbortSignal) => send<SqlSchema>('/api/sql/schema', { signal });

export const runQuery = (sql: string, signal?: AbortSignal) => send<SqlResult>('/api/sql/query', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }), signal,
});

export const askQuestion = (question: string, signal?: AbortSignal) => send<SqlAnswer>('/api/sql/ask', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal,
});
