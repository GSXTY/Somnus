const statuses = new Set([
  "linked",
  "none",
  "pending",
  "deleted",
  "archived",
  "source_deleted",
  "source_archived",
  "source_scope_changed",
  "target_scope_changed",
  "unverified",
]);
export function validChildAssociation(value) {
  if (
    !value ||
    !statuses.has(value.status) ||
    typeof value.can_open !== "boolean" ||
    typeof value.can_send !== "boolean"
  )
    return false;
  if(value.can_open && !["linked","archived"].includes(value.status))return false;
  if (
    value.can_open &&
    (typeof value.conversation_id !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.conversation_id))
  )
    return false;
  if (value.can_send && (value.status !== "linked" || !value.can_open))
    return false;
  if (
    value.continuation !== undefined &&
    (!value.continuation ||
      typeof value.continuation.agentId !== "string" ||
      value.continuation.agentId.length > 120 ||
      (value.continuation.providerModelId !== undefined &&
        typeof value.continuation.providerModelId !== "string"))
  )
    return false;
  return true;
}
export const childAssociationLabels = {
  linked: "已恢复经验证的独立子会话。",
  none: "尚未创建独立子会话；继续发言将创建分支并重新授权。",
  pending: "上一次分支创建尚未确认，请等待或刷新。不会重复新建。",
  deleted: "此前的独立子会话已删除，未重新创建。",
  archived: "此前的独立子会话已归档，可查看记录，不能继续发送。",
  source_deleted: "原会话已删除，无法恢复子会话关联。",
  source_archived: "原会话已归档，请先在会话管理中恢复。",
  source_scope_changed: "原会话的工作区范围已变更，无法沿用此前的关联。",
  target_scope_changed: "独立子会话的工作区范围已变更，未重新绑定。",
  unverified: "现有记录不足以验证独立子会话归属，未使用本地缓存自动绑定。",
};
