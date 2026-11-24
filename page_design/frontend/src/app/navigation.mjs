// Single source of truth for the workspace navigation.
// Both the classic sidebar and the glass theme read from here, so adding a page
// only means editing this file.

export const navigation = [
  {
    key: 'overview', label: '概览',
    items: [{ key: 'dashboard', label: '主页', icon: 'dashboard', hint: '昨日数据与近7天趋势' }],
  },
  {
    key: 'data', label: '数据',
    items: [
      { key: 'users', label: '用户目录', icon: 'team', hint: '用户与设备关联' },
      { key: 'devices', label: '设备目录', icon: 'cloud', hint: '设备型号与状态' },
    ],
  },
  {
    key: 'documents', label: '文档',
    items: [{ key: 'documents', label: '文档', icon: 'documents', hint: '管理个人文档并浏览共享文档' }],
  },
  {
    key: 'analysis', label: '分析',
    items: [
      { key: 'analysis', label: '波形分析', icon: 'experiment', hint: 'CSV 波形与事件复核' },
      { key: 'deep-analysis', label: '深度分析', icon: 'chart', hint: '独立模型分析表格、生成图表与报告' },
      { key: 'sql', label: '数据查询', icon: 'database', hint: '自然语言生成只读 SQL 并执行' },
    ],
  },
  {
    key: 'assistant', label: '助手',
    items: [{ key: 'assistant', label: '会话', icon: 'robot', hint: '聊天、读文件、查数据与跑分析' }],
  },
  {
    key: 'system', label: '系统',
    items: [
      { key: 'models', label: '模型', icon: 'robot', hint: '选择与添加模型供应商' },
      { key: 'skills', label: 'Skills', icon: 'plugin', hint: '导入和管理会话技能' },
      { key: 'mcp', label: 'MCP', icon: 'mcp', hint: '管理 MCP 服务器与工具' },
      { key: 'plugin-config', label: '插件', icon: 'plugin', hint: '导入和管理插件' },
      { key: 'plugins', label: '工具区', icon: 'plugin', hint: '波形分析、深度分析和数据查询' },
      { key: 'alerts', label: '告警中心', icon: 'bell', hint: '工程告警与提示' },
      { key: 'settings', label: '设置', icon: 'setting', hint: '通用、会话、数据连接和快捷键' },
    ],
  },
];

export const navigationItems = navigation.flatMap(group =>
  group.items.map(item => ({ ...item, group: group.key, groupLabel: group.label })));

const railViews = [
  ['assistant', '会话', 'chat'],
  ['dashboard', '主页', 'dashboard'],
  ['documents', '文档', 'documents'],
  ['plugin-config', '插件', 'plugin'],
  ['plugins', '工具区', 'plugin'],
];
export const workspaceRail = railViews.map(([key, label, icon]) => ({ key, label, icon }));
export const builtInTools = navigationItems.filter(item => item.group === 'analysis');
// The 配置中心 entry was removed from the sidebar; its route and page stay so the
// configuration screen can still be opened and restored, but it no longer owns a
// visible rail item. Keeping the key here avoids highlighting an unrelated entry.
const detachedViews = new Set(['config', 'models']);
export function activeRailView(view) {
  if (detachedViews.has(view)) return 'config';
  if (view === 'skills' || view === 'mcp') return 'plugin-config';
  if (['users', 'devices', 'alerts'].includes(view)) return 'dashboard';
  if (view === 'settings') return 'settings';
  return workspaceRail.some(entry => entry.key === view) ? view : 'plugins';
}

/** Quick access shown in the floating dock, in order. */
export const dockKeys = ['assistant', 'analysis', 'deep-analysis', 'sql'];

/** Labels for routed pages that no longer own a sidebar entry. */
const detachedLabels = { config: '配置中心' };

export function labelOf(key) {
  const found = navigationItems.find(item => item.key === key);
  if (found) return found.label;
  return detachedLabels[key] ?? key;
}

export function groupOf(key) {
  const found = navigationItems.find(item => item.key === key);
  return found ? found.groupLabel : '';
}
