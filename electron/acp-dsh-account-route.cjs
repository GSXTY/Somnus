const { setSessionModel } = require('./acp-models.cjs');
const { AcpError } = require('./acp-stdio.cjs');
function route(id) {
  try { const value = JSON.parse(id); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function accountModel(id) { return route(id)[0] === 'deepseek-account'; }
// External official DSH uses its own account. Somnus Provider sessions do not enter here.
async function selectDshAccount(current, timeout, requestedModelId) {
  const selected = current.modelSelection;
  const models = selected.models.filter(model => accountModel(model.id));
  if (!models.length) throw new AcpError('DSH 尚未提供账户模型，请在 Agent 配置中登录 DeepSeek 账户并刷新。', -32000);
  let target;
  if (requestedModelId) {
    target = models.find(model => model.id === requestedModelId);
    // Older saved selections used the API-key route; preserve their model choice on the account route.
    const requested = route(requestedModelId);
    if (!target && requested[0] === 'deepseek-official') {
      target = models.find(model => route(model.id)[1] === requested[1]);
    }
    if (!target) throw new AcpError('此模型已不在 DSH 账户提供的列表中。请刷新模型列表并重新选择。');
  } else {
    target = models.find(model => model.id === selected.modelId) ||
      models.find(model => /flash/i.test(model.id)) || models[0];
  }
  await setSessionModel(current, target.id, timeout);
  current.modelSelection = { ...current.modelSelection, models };
}
module.exports = { accountModel, selectDshAccount };
