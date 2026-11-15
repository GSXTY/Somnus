const root = '/api/deep-analysis';
export const activeTaskStates = new Set(['queued', 'running']);
export const taskLabels = { queued: '排队中', running: '分析中', complete: '分析完成', failed: '分析失败', cancelled: '已取消', blocked: '条件未就绪', interrupted: '服务中断' };
export function safeArtifactUrl(value) { return typeof value === 'string' && /^\/api\/deep-analysis\/artifacts\/[A-Za-z0-9_-]+$/.test(value) ? value : null; }
export function imageArtifact(item) { return ['image/png', 'image/jpeg', 'image/webp'].includes(item.mime) && safeArtifactUrl(item.url); }
async function request(path, init = {}) {
  const response = await fetch(root + path, { cache: 'no-store', ...init });
  if (!response.ok) {
    let message = '', code;
    try { const data = await response.json(); message = typeof data.error === 'string' ? data.error : data.error?.message || data.detail || ''; code = typeof data.error === 'object' ? data.error?.code : undefined; } catch { /* keep status */ }
    const failure = new Error(typeof message === 'string' && message ? message : `深度分析服务返回 ${response.status}`);
    failure.code = code || `E-DEEP-${response.status}`;
    throw failure;
  }
  return response.json();
}
const jsonPost = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function deepStatus(signal) {
  const data = await request('/status', { signal });
  if (typeof data.configured !== 'boolean' || typeof data.execution_ready !== 'boolean') throw new Error('深度分析状态格式无效');
  return data;
}
export async function uploadAnalysisFile(file, signal) {
  if (!file || !/\.(csv|xlsx|xlsm)$/i.test(file.name) || !file.size) throw new Error('请选择非空的 CSV 或 Excel（.xlsx）文件');
  const data = await request('/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file, signal });
  if (!data.file?.id || !Array.isArray(data.file.columns)) throw new Error('上传文件响应无效');
  return data.file;
}
function validateTask(data, id) {
  if (!data.task?.id || !(data.task.status in taskLabels) || (id && data.task.id !== id)) throw new Error('分析任务响应不匹配');
  return data.task;
}
export async function createAnalysisTask(fileId, question, signal) {
  if (!fileId || !question.trim()) throw new Error('请先选择数据并填写分析问题');
  return validateTask(await request('/tasks', { ...jsonPost({ file_id: fileId, question: question.trim() }), signal }));
}
export async function getAnalysisTask(id, signal) { return validateTask(await request('/tasks/' + encodeURIComponent(id), { signal }), id); }
export async function cancelAnalysisTask(id) { return validateTask(await request(`/tasks/${encodeURIComponent(id)}/cancel`, jsonPost({})), id); }
export async function listAnalysisTasks(signal, limit = 20) {
  const data = await request('/tasks?limit=' + encodeURIComponent(String(limit)), { signal });
  if (!Array.isArray(data.tasks)) throw new Error('任务列表格式无效');
  return data.tasks;
}

