const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const PACKAGE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;

const SAFE_BUILTINS = new Map([
  ['compact', '@deepseek-ai/dsh-command-compact'],
  ['feedback', '@deepseek-ai/dsh-command-feedback'],
  ['plan', '@deepseek-ai/dsh-plan-mode'],
  ['goal', '@deepseek-ai/dsh-command-goal'],
]);
const MANAGED = new Map([
  ['permission', '请在 Somnus 输入框旁的权限菜单切换。'],
  ['sandbox', '请在 Somnus 输入框旁的权限菜单切换。'],
  ['model', '请使用 Somnus 的模型菜单。'],
  ['login', '请通过 Somnus 的配置中心管理账户。'],
  ['logout', '请通过 Somnus 的配置中心管理账户。'],
  ['shell', '请在 Somnus 的终端页运行命令。'],
  ['terminal', '请打开 Somnus 的终端页。'],
  ['export', '请使用 Somnus 的会话导出。'],
]);

function belongsTo(value, packageName) {
  return typeof value === 'string' &&
    (value === packageName || value.startsWith(packageName + ':') || value.startsWith(packageName + '/'));
}

const cleanText = (text, limit) => typeof text === 'string' ? text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, limit) : '';

function listCommandRows(values, activeBundles) {
  if (!Array.isArray(values)) throw new Error('托管 DSH 未返回可用命令清单。');
  const rows = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || !NAME.test(value.name ?? '') || seen.has(value.name) || typeof value.description !== 'string') continue;
    seen.add(value.name);
    const { name, definitionId } = value;
    const hosted = typeof definitionId === 'string' && activeBundles.some(bundle => PACKAGE.test(bundle) &&
      !bundle.startsWith('@deepseek-ai/') &&
      belongsTo(definitionId, bundle));
    const permitted = SAFE_BUILTINS.has(name) ? SAFE_BUILTINS.get(name) === definitionId : hosted;
    const reason = MANAGED.get(name) ?? (permitted
      ? undefined : '此命令尚无可验证的 Somnus 直接执行入口。');
    rows.push({
      name, description: cleanText(value.description, 300), executable: !reason,
      ...(value.input?.hint ? { hint: cleanText(value.input.hint, 140) } : {}),
      ...(reason ? { reason } : {}),
    });
    if (rows.length >= 120) break;
  }
  return rows;
}

function exactCommand(line) {
  if (typeof line !== 'string' || line.length > 4000 || /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(line)) {
    throw new Error('请输入一条 DSH 命令。');
  }
  const match = /^\/([a-z][a-z0-9_-]{0,63})(?:[ \t]+.*)?$/.exec(line);
  if (!match) throw new Error('请输入一条 DSH 命令。');
  return match[1];
}

function taskState(values, liveGoal) {
  const result = {};
  if (typeof values?.plan?.active === 'boolean' && typeof values.plan.pending === 'boolean') {
    result.plan = { active: values.plan.active, pending: values.plan.pending };
  }
  const goal = liveGoal ?? values?.goal?.goal;
  const rounds = liveGoal ?? values?.goal;
  if (goal && typeof goal.objective === 'string' && ['active', 'paused', 'blocked', 'complete'].includes(goal.phase) &&
      Number.isSafeInteger(rounds?.roundsStarted) && Number.isSafeInteger(goal.maxGoalRounds)) {
    result.goal = { objective: cleanText(goal.objective, 4000), phase: goal.phase,
      roundsStarted: rounds.roundsStarted, maxGoalRounds: goal.maxGoalRounds,
      ...(['armed', 'disarmed'].includes(goal.activation) ? { activation: goal.activation } : {}),
      ...(goal.blockedReason?.message ? { blockedReason: cleanText(goal.blockedReason.message, 500) } : {}) };
  }
  return result;
}

module.exports = { listCommandRows, exactCommand, cleanText, belongsTo, taskState };
