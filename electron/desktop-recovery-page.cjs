const page = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-somnus-local-profile'">
<title>Somnus</title>
<style>
  :root { font: 15px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif; color: #193730; background: #f4f8f6; }
  body { max-width: 650px; margin: auto; padding: 26px; }
  h1 { margin: 0; font-size: 25px; }
  h2 { margin: 0 0 8px; font-size: 17px; }
  p { margin: 8px 0 14px; color: #50665d; }
  section { padding: 16px; margin: 14px 0; background: #fff; border: 1px solid #d9e5df; border-radius: 9px; }
  label { display: block; margin-bottom: 6px; font-weight: 600; }
  form { margin-top: 12px; }
  select, input, button { font: inherit; padding: 7px 10px; border: 1px solid #9eb6aa; border-radius: 6px; }
  select, input { box-sizing: border-box; min-width: 192px; max-width: 100%; color: inherit; background: #fff; }
  button { cursor: pointer; color: #174d41; background: #f7fbf9; }
  button.primary { background: #176d61; border-color: #176d61; color: #fff; }
  button:disabled { opacity: .55; cursor: default; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #176d61; outline-offset: 2px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  #status { min-height: 22px; white-space: pre-wrap; }
  #status[data-error] { color: #aa3227; }
</style>
<header>
  <h1 id="title"></h1>
  <p id="intro"></p>
</header>
<section id="selection">
  <label for="profiles">运行配置</label>
  <div class="actions">
    <select id="profiles"></select>
    <button id="switch" type="button" class="primary">切换并重启</button>
  </div>
  <form id="create">
    <label for="name">新配置名称</label>
    <div class="actions">
      <input id="name" maxlength="48" required>
      <button>创建配置</button>
    </div>
  </form>
</section>
<section id="recovery" hidden>
  <h2>恢复工作台</h2>
  <div class="actions">
    <button id="rollback" type="button" class="primary">返回上次可用配置</button>
    <button id="retry" type="button">重试当前配置</button>
    <button id="safe" type="button">以安全模式启动</button>
    <button id="reset-registry" type="button">恢复默认配置清单</button>
  </div>
  <p>安全模式会暂时停用外部 Agent、插件开发和 Dot 接入，并跳过配置环境文件。已有会话、波形和历史仍保存在当前配置的数据目录。</p>
</section>
<section id="tools" hidden>
  <h2>排查</h2>
  <div class="actions">
    <button id="disable-dsh" type="button">停用当前配置的 DSH 扩展并重启</button>
    <button id="restore-dsh" type="button">恢复停用前的 DSH 插件组合</button>
    <button id="diagnostics" type="button">导出启动诊断</button>
  </div>
</section>
<p id="status" role="status" aria-live="polite"></p>
<script nonce="somnus-local-profile">
const api = window.somnusProfiles;
const find = id => document.getElementById(id);
const select = find('profiles');
const status = find('status');
let current;
let busy = false;
function render(state, preferred = state.selected) {
  current = state;
  const recovery = state.kind === 'recovery';
  find('title').textContent = recovery ? '故障恢复' : '运行配置';
  find('intro').textContent = recovery
    ? (state.launchFailed || state.startupError ? 'Somnus 未能正常启动。可在此切换配置或排查。' : '此窗口独立于工作台本机服务。')
    : '每项配置单独保存模型、Agent、插件、账号和会话数据。切回默认配置即可继续使用现有数据。';
  const options = state.profiles.map(row => new Option(
    row.name + (row.id === state.selected ? '（当前）' : ''), row.id,
  ));
  select.replaceChildren(...options);
  select.value = preferred;
  find('create').hidden = recovery;
  find('selection').hidden = !state.registryValid;
  find('recovery').hidden = !recovery;
  find('tools').hidden = !recovery;
  find('reset-registry').hidden = state.registryValid;
  find('rollback').disabled = !state.rollback;
  find('rollback').textContent = state.rollback ? '返回 ' + state.rollback.name : '返回上次可用配置';
  find('disable-dsh').disabled = !state.dshAvailable;
  find('restore-dsh').disabled = !state.dshBackupAvailable;
  find('retry').disabled = !state.registryValid;
  find('safe').disabled = !state.registryValid || (state.startupError && state.selected !== state.active);
  find('switch').disabled = !select.value || select.value === state.selected;
}
async function run(operation, feedback) {
  if (busy) return;
  busy = true;
  status.textContent = '';
  status.removeAttribute('data-error');
  try {
    if (await operation()) status.textContent = feedback;
  } catch (error) {
    status.setAttribute('data-error', '');
    status.textContent = String(error.message || error).replace(/^Error invoking remote method '.+?': (?:Error: )?/, '');
  } finally {
    busy = false;
  }
}
select.onchange = () => { find('switch').disabled = !select.value || select.value === current.selected; };
find('switch').onclick = () => run(() => api.select(select.value), '正在重启…');
find('create').onsubmit = event => {
  event.preventDefault();
  void run(async () => {
    const name = find('name');
    const state = await api.create(name.value);
    render(state, state.profiles.at(-1).id);
    name.value = '';
    select.focus();
    return true;
  }, '配置已创建，可切换到该配置。');
};
for (const action of ['rollback', 'retry', 'safe', 'reset-registry', 'disable-dsh', 'restore-dsh', 'diagnostics']) {
  find(action).onclick = () => run(() => api.recover(action), action === 'diagnostics' ? '启动诊断已导出。' : '正在重启…');
}
function refresh() { return run(async () => { render(await api.status()); }, ''); }
api.onRefresh(refresh);
void refresh();
</script>
</html>`;

module.exports = { page };
