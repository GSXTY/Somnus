export const WORKSPACE_WIDTH_KEY = 'somnus-chat-workspace-width';
export const DEFAULT_WORKSPACE_WIDTH = 440;

export function workspaceWidthLimits(available) {
  if (!(available > 0)) return { min: 280, max: 850 };
  const max = Math.max(1, Math.min(850, available - Math.min(360, Math.floor(available * 0.48))));
  return { min: Math.min(280, max), max };
}

export function clampWorkspaceWidth(width, available) {
  const { min, max } = workspaceWidthLimits(available);
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(width) ? width : DEFAULT_WORKSPACE_WIDTH)));
}
