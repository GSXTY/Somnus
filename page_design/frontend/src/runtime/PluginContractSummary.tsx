import type { PluginContract } from '../chat/assistantApi';

export function PluginContractSummary({ contract }: { contract?: PluginContract }) {
  const status = !contract || contract.legacy ? '旧版规范 · 未声明兼容性' :
    contract.compatibility === 'incompatible' ? '与当前版本不兼容' :
    contract.compatibility === 'requires-adapter' ? '需要界面适配' :
    contract.compatibility === 'compatible' ? '已声明兼容' : '兼容性待确认';
  return <details className="runtime-capabilities"><summary>插件兼容性 · {status}</summary>
    {contract ? <><p>{contract.format === 'dsh.bundle' ? 'DSH 插件包' : 'Somnus 插件包'} · 规范 {contract.schema_version}</p>
      {contract.minimum_somnus_version && <p>最低 Somnus 版本：{contract.minimum_somnus_version}</p>}
      {contract.reason && <p>{contract.reason}</p>}
      <p>声明能力：{contract.capabilities.length ? contract.capabilities.join('、') : '未声明'}</p></> :
      <p>此插件未提供统一兼容声明，保留原有安装方式与功能。</p>}
    <p className="small-note">兼容声明不会授予权限。界面扩展仍需对应的 Somnus 扩展入口，实际可用性以运行结果为准。</p>
  </details>;
}
