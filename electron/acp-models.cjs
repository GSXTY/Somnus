const { AcpError } = require('./acp-stdio.cjs');

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
const validEffort = value => value === '' || validId(value);

function listedOptions(options, identifier, isValid = validId) {
  if (!Array.isArray(options)) return [];
  const models = new Map();
  for (const option of options.slice(0, 200)) {
    const id = option?.[identifier];
    if (!isValid(id) || models.has(id)) continue;
    models.set(id, {
      id,
      name: typeof option.name === 'string' && option.name ? option.name.slice(0, 160) : id,
      ...(typeof option.description === 'string' ? { description: option.description.slice(0, 320) } : {}),
    });
  }
  return [...models.values()];
}

function configSelect(options, category, fallbackId) {
  if (!Array.isArray(options)) return null;
  const selects = options.slice(0, 80).filter(option =>
    option?.type === 'select' && validId(option.id) && Array.isArray(option.options));
  return selects.find(option => option.category === category) ||
    selects.find(option => option.id === fallbackId && !option.category);
}

function selectValues(choice) {
  return choice.options.slice(0, 200).flatMap(item =>
    Array.isArray(item?.options) ? item.options.slice(0, 200) : [item]);
}

function configSelection(options) {
  const choice = configSelect(options, 'model', 'model');
  if (!choice) return null;
  return { configId: choice.id, modelId: validId(choice.currentValue) ? choice.currentValue : null,
    models: listedOptions(selectValues(choice), 'value') };
}

function reasoningSelection(options) {
  const choice = configSelect(options, 'thought_level', 'reasoning_effort');
  if (!choice) return null;
  const values = listedOptions(selectValues(choice), 'value', validEffort);
  if (!values.length) return null;
  return { configId: choice.id,
    value: values.some(option => option.id === choice.currentValue) ? choice.currentValue : null, options: values };
}

function sessionModels(reply) {
  return configSelection(reply?.configOptions) || {
    configId: null,
    modelId: validId(reply?.models?.currentModelId) ? reply.models.currentModelId : null,
    models: listedOptions(reply?.models?.availableModels, 'modelId'),
  };
}

function updateSessionConfig(current, options) {
  if (!Array.isArray(options)) return;
  const models = configSelection(options);
  if (models || current.modelSelection?.configId) current.modelSelection = models || sessionModels();
  current.reasoningSelection = reasoningSelection(options);
}

function reasoningCatalog(current) {
  if (!current.reasoningSelection) return {};
  const { value, options } = current.reasoningSelection;
  return { reasoning: { modelId: current.modelSelection.modelId, value, options } };
}

function modelSummary(current) {
  const { modelId, models } = current.modelSelection;
  const effort = current.reasoningSelection?.options.find(option => option.id === current.reasoningSelection.value);
  return { modelId, modelName: models.find(model => model.id === modelId)?.name || modelId,
    ...(effort ? { reasoningEffort: effort.id, reasoningName: effort.name } : {}) };
}

async function setSessionModel(current, modelId, timeout) {
  const selected = current.modelSelection;
  if (!modelId || modelId === selected.modelId) return;
  if (!validId(modelId) || !selected.models.some(model => model.id === modelId)) {
    throw new AcpError('此模型已不在 Agent 提供的列表中。请刷新模型列表并重新选择。');
  }
  const { sessionId, connection } = current;
  if (selected.configId) {
    const reply = await connection.request('session/set_config_option', {
      sessionId, configId: selected.configId, value: modelId,
    }, timeout);
    if (!configSelection(reply?.configOptions)) throw new AcpError('Agent 未确认切换模型。');
    updateSessionConfig(current, reply.configOptions);
    if (current.modelSelection.modelId !== modelId) throw new AcpError('Agent 未应用所选模型。');
    return;
  }
  await connection.request('session/set_model', { sessionId, modelId }, timeout);
  current.modelSelection = { ...selected, modelId };
}

async function setSessionReasoning(current, effort, timeout) {
  if (effort == null) return;
  const selected = current.reasoningSelection;
  if (!validEffort(effort) || !selected?.options.some(option => option.id === effort)) {
    throw new AcpError('当前模型未提供所选推理档位，请刷新后重新选择。');
  }
  if (effort === selected.value) return;
  const { sessionId, connection } = current;
  const reply = await connection.request('session/set_config_option', { sessionId, configId: selected.configId, value: effort }, timeout);
  if (!Array.isArray(reply?.configOptions)) throw new AcpError('Agent 未确认切换推理强度。');
  updateSessionConfig(current, reply.configOptions);
  if (current.reasoningSelection?.value !== effort) throw new AcpError('Agent 未应用所选推理强度。');
}

module.exports = { modelSummary, reasoningCatalog, sessionModels, setSessionModel, setSessionReasoning, updateSessionConfig, validEffort, validId };
