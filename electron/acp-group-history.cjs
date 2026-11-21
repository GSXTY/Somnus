const { createHash } = require('node:crypto');
const { priorTranscript } = require('./acp-live.cjs');
const digest = text => createHash('sha256').update(text).digest('hex');
function rememberReply(current, turnId) {
  current.ownReplies ??= new Set();
  if (typeof turnId === 'string') current.ownReplies.add(turnId);
  if (current.ownReplies.size > 512) current.ownReplies.delete(current.ownReplies.values().next().value);
}
function groupHistory(current, prepared) {
  current.seenHistory ??= new Set();
  const rows = Array.isArray(prepared?.history) ? prepared.history : [];
  const unseen = [];
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const question = rows[index], answer = rows[index + 1];
    if (question?.role !== 'user' || answer?.role !== 'assistant' ||
        typeof question.content !== 'string' || typeof answer.content !== 'string') continue;
    index += 1;
    const replyId = typeof answer.message_id === 'string' ? answer.message_id : null;
    const key = replyId || digest(JSON.stringify([question.content, answer.content]));
    if (!current.seenHistory.has(key) && !(replyId && current.ownReplies?.has(replyId))) unseen.push(question, answer);
    current.seenHistory.add(key);
  }
  while (current.seenHistory.size > 512) current.seenHistory.delete(current.seenHistory.values().next().value);
  const summary = prepared?.history_summary;
  const changedSummary = typeof summary === 'string' && summary !== current.historySummary ? summary : undefined;
  current.historySummary = summary;
  return priorTranscript(unseen, changedSummary);
}
module.exports = { groupHistory, rememberReply };
