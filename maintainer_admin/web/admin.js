const openedToken = location.hash.slice(1);
if (openedToken) {
  sessionStorage.setItem('somnus-admin', openedToken);
  history.replaceState(null, '', location.pathname);
}
const token = sessionStorage.getItem('somnus-admin') || '';
const byId = id => document.getElementById(id);
const relayToggle = byId('relay-toggle');
const notice = byId('notice');
const save = byId('save');
const submit = byId('submit');
let relay = null;
let saved = null;
let ready = false;

function alertStatus(message, error = false) {
  notice.hidden = false;
  notice.textContent = message;
  notice.classList.toggle('error', error);
}

async function request(path, payload) {
  const headers = {Authorization: 'Bearer ' + token};
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/' + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作未完成。');
  return result;
}

function showRelay(value) {
  relay = value;
  const label = byId('relay-status');
  label.textContent = value.enabled ? '允许访问' : '已暂停';
  label.classList.toggle('on', value.enabled);
  byId('relay-description').textContent = value.running
    ? '本机中继正在运行。关闭共享会拦截朋友的新请求。'
    : '本机中继未运行。开关状态将在中继启动后生效。';
  relayToggle.textContent = value.enabled ? '暂停共享' : '开启共享';
  relayToggle.disabled = false;
}

function draftFields() {
  return {
    version: byId('version').value.trim(),
    handoff: byId('handoff').checked,
    notes: byId('notes').value.trim(),
    signed: byId('signed').checked,
  };
}

function updateSubmit() {
  submit.disabled = !ready || !saved || JSON.stringify(draftFields()) !== JSON.stringify(saved);
}

async function load() {
  try {
    const result = await request('state');
    showRelay(result.relay);
    const {standard} = result;
    if (standard.error) {
      byId('standard-status').textContent = '工作区不可用';
      byId('workflow-status').textContent = '不可用';
      alertStatus(standard.error, true);
      return;
    }
    byId('standard-status').textContent = standard.version;
    byId('workflow-status').textContent = standard.dirty ? '标准版有改动' : standard.workflow ? '工作流已安装' : '等待安装工作流';
    byId('handoff').disabled = false;
    byId('handoff').checked = result.draft?.handoff ?? standard.handoff;
    byId('version').value = result.draft?.version ?? '';
    byId('notes').value = result.draft?.notes ?? '';
    byId('signed').checked = result.draft?.signed ?? false;
    saved = result.draft;
    ready = Boolean(standard.workflow && !standard.dirty);
    save.disabled = false;
    updateSubmit();
  } catch (error) {
    alertStatus(error.message, true);
  }
}

relayToggle.addEventListener('click', async () => {
  relayToggle.disabled = true;
  try {
    const next = await request('relay', {enabled: !relay.enabled});
    showRelay({...relay, enabled: next.enabled});
    alertStatus(next.enabled ? '默认模型共享已开启。' : '默认模型共享已暂停。');
  } catch (error) {
    relayToggle.disabled = false;
    alertStatus(error.message, true);
  }
});
for (const field of ['version', 'notes', 'handoff', 'signed']) byId(field).addEventListener('input', updateSubmit);
byId('draft-form').addEventListener('submit', async event => {
  event.preventDefault();
  save.disabled = true;
  try {
    saved = await request('draft', draftFields());
    alertStatus('草稿已保存。检查版本号、插件选项和发布说明后提交。');
  } catch (error) {
    alertStatus(error.message, true);
  } finally {
    save.disabled = false;
    updateSubmit();
  }
});
submit.addEventListener('click', async () => {
  if (!confirm('将标准版提交到 GitHub 并启动构建和公开发布？')) return;
  submit.disabled = true;
  save.disabled = true;
  try {
    const result = await request('submit', draftFields());
    ready = false;
    alertStatus(`已启动 ${result.version} 的 GitHub 发布。\n${result.action_url}`);
  } catch (error) {
    alertStatus(error.message, true);
  } finally {
    save.disabled = false;
    updateSubmit();
  }
});
load();
