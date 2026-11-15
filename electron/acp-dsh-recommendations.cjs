const { createHash } = require('node:crypto');
const { validId } = require('./acp-models.cjs');

const RECOMMENDATIONS = '@deepseek-ai/dsh-personalized-recommendations';
const PROPOSE_ACTION = 'propose_action';
const CARD_ADMITTED = 'Card shown below your answer. Do not restate it. ';
const OFFICIAL_PACKAGE = /^@deepseek-ai\/dsh-[a-z0-9-]{1,80}$/;

function label(value, limit) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || /[\x00-\x1f\x7f]/u.test(normalized)) return null;
  const text = normalized.slice(0, limit).toWellFormed().trimEnd();
  return text || null;
}

const kinds = {
  enable_official_plugin: 'plugin',
  create_personalized_page: 'page',
};

class DshRecommendation {
  constructor() {
    this.pending = new Map();
    this.card = null;
  }

  observe(update) {
    const id = update?.toolCallId;
    if (this.card || !validId(id)) return;
    if (update.sessionUpdate === 'tool_call') {
      if (update.title !== PROPOSE_ACTION || update.status !== 'in_progress' || this.pending.size >= 8) return;
      const input = update.rawInput;
      if (!input || typeof input !== 'object' || typeof input.action !== 'string' || !Object.hasOwn(kinds, input.action)) return;
      const title = label(input.title, 160);
      const description = label(input.brief, 750);
      if (!title || !description) return;
      const pluginId = input.details?.name;
      const kind = kinds[input.action];
      this.pending.set(id, {
        id: createHash('sha256').update(id).digest('hex').slice(0, 32), kind, title, description,
        ...(kind === 'plugin' && typeof pluginId === 'string' && OFFICIAL_PACKAGE.test(pluginId) ? { pluginId } : {}),
      });
    } else if (update.sessionUpdate === 'tool_call_update') {
      if (update.status !== 'completed' && update.status !== 'failed') return;
      const candidate = this.pending.get(id);
      this.pending.delete(id);
      if (candidate && update.status === 'completed' && Array.isArray(update.content) &&
          update.content.some(block => block?.type === 'content' && block.content?.type === 'text' &&
            typeof block.content.text === 'string' && block.content.text.startsWith(CARD_ADMITTED))) {
        this.card = candidate;
        this.pending.clear();
      }
    }
  }
}

module.exports = { DshRecommendation, RECOMMENDATIONS };
