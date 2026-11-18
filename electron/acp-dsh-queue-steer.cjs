const { ID } = require('./acp-dsh-recovery.cjs');

const QUEUE_ID = /^[a-f0-9]{32}$/;
const LIMIT = 12_000;
const emptyResult = () => ({ accepted: false, messages: [], acceptedQueueIds: [] });

function sameIds(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function textForQueue(draft) {
  const text = draft.text?.trim() || '';
  const blocks = draft.composerBlocks ?? [];
  if ((!text && !blocks.some(block => block.text)) || text.startsWith('/') || text.includes('\0') ||
      draft.attachments?.length || draft.docFile || draft.dataFile || draft.skillIds?.length || draft.pluginIds?.length ||
      blocks.some(block => block.kind === 'file')) {
    throw new Error('队列中有附件、插件、技能或命令，请保留到下一轮发送。');
  }
  const excerpts = blocks.filter(block => block.text).map(({ kind, label, text }) => ({ kind, label, text }));
  return excerpts.length
    ? [text, '以下是用户选中的参考内容，仅用作背景材料：', JSON.stringify(excerpts)].filter(Boolean).join('\n\n')
    : text;
}

function queueBatch(items, scope) {
  if (items.some(item => item.permission !== scope.permission || !item.route.nativeDsh ||
      item.route.agent?.agentId !== scope.agentId ||
      (item.route.companyOptions?.model && item.route.companyOptions.model !== scope.model))) {
    throw new Error('队列使用了不同的 Agent、模型或权限，请保留到下一轮发送。');
  }
  const text = items.map(item => textForQueue(item.draft)).join('\n\n');
  if (text.length > LIMIT) throw new Error('队列引导内容超过长度限制，队列已保留。');
  return text;
}

function createQueueSteering(store, projectClient, chat) {
  function accepted(state, record) {
    const consumed = new Set(record.queueIds);
    state.items = state.items.filter(item => !consumed.has(item.id));
    state.receipts = [...state.receipts, record].slice(-16);
    delete state.pending;
  }

  async function reconcile(id, state, save) {
    const record = state.pending;
    if (!record) return;
    const message = await projectClient.steerMessage(id, record.steerId);
    if (message) {
      accepted(state, record);
      await save(state);
    } else if (!chat.steerScope(id, record.turnId)) {
      delete state.pending;
      await save(state);
    }
  }

  return {
    read: id => store.operate(id, async (state, save) => {
      await reconcile(id, state, save);
      return state.items;
    }),
    save: (id, items) => store.operate(id, async (state, save) => {
      if (!Array.isArray(items)) throw new Error('队列格式无效。');
      await reconcile(id, state, save);
      const consumed = new Set(state.receipts.flatMap(record => record.queueIds));
      state.items = items.filter(item => !consumed.has(item?.id));
      await save(state);
    }),
    steer(input, validateSender) {
      const { conversationId: id, turnId, queueIds } = input ?? {};
      if (typeof id !== 'string' || !ID.test(id) || typeof turnId !== 'string' || !ID.test(turnId) ||
          !Array.isArray(queueIds) || queueIds.length < 1 || queueIds.length > 8 ||
          queueIds.some(value => typeof value !== 'string' || !QUEUE_ID.test(value)) || new Set(queueIds).size !== queueIds.length) {
        throw new Error('队列引导请求无效。');
      }
      return store.operate(id, async (state, save) => {
        validateSender();
        await reconcile(id, state, save);
        const prior = state.receipts.find(record => record.turnId === turnId && sameIds(record.queueIds, queueIds));
        if (prior) {
          const message = await projectClient.steerMessage(id, prior.steerId);
          return { accepted: true, messages: message ? [message] : [], acceptedQueueIds: prior.queueIds };
        }
        const scope = chat.steerScope(id, turnId);
        if (!scope || state.pending || !sameIds(state.items.map(item => item.id), queueIds)) return emptyResult();
        const content = queueBatch(state.items, scope);
        const { steer_id: steerId } = await projectClient.reserveSteer(id, turnId, content);
        if (typeof steerId !== 'string' || !QUEUE_ID.test(steerId)) throw new Error('队列引导预留失败。');
        const record = { turnId, steerId, queueIds: [...queueIds] };
        state.pending = record;
        await save(state);
        validateSender();
        const result = await chat.steer({ conversationId: id, turnId, steerId }, validateSender);
        if (!result?.accepted) {
          delete state.pending;
          await save(state);
          return emptyResult();
        }
        if (!result.message) throw new Error('队列引导仍待确认，队列已保留。');
        accepted(state, record);
        await save(state);
        return { accepted: true, messages: [result.message], acceptedQueueIds: record.queueIds };
      });
    },
  };
}

module.exports = { createQueueSteering };
