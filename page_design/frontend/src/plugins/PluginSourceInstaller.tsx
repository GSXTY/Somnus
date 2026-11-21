import { useId, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Spin } from 'antd';
import type { InputRef } from 'antd';
import { CheckCircleOutlined, DownOutlined, WarningOutlined } from '@ant-design/icons';
import { describeError } from '../shared/errors.mjs';

export type InstalledPluginSource = {
  id: string;
  version: string;
  profile: 'acp' | 'web';
  installed: boolean;
  cancelled?: boolean;
};

const sources = [
  { name: 'npm 包名', reference: 'dsh-plugin-whale-pet', detail: '输入包名或加上 @版本。' },
  { name: 'GitHub 仓库', reference: 'https://github.com/author/dsh-plugin', detail: '也可指定分支、标签和仓库里的插件目录。' },
  { name: 'GitHub Release 压缩包', reference: 'https://github.com/author/dsh-plugin/releases/download/v1.0.0/plugin.tgz',
    detail: '填写发布资源的 .tgz 或 .tar.gz 链接。' },
];

export function PluginSourceInstaller({ install, initialReference = '', onInstalled, onEnable, onClose }: {
  install: (reference: string) => Promise<InstalledPluginSource>;
  initialReference?: string;
  onInstalled: () => void;
  onEnable?: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const guideId = useId();
  const errorId = useId();
  const input = useRef<InputRef>(null);
  const lock = useRef(false);
  const [reference, setReference] = useState(initialReference);
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<InstalledPluginSource>();
  const [enabled, setEnabled] = useState(false);

  async function submit() {
    const source = reference.trim();
    if (lock.current || !source) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await install(source);
      if (next.cancelled) return;
      if (!next.installed) {
        setError('桌面版没有确认安装结果，请刷新插件列表后再试。');
        return;
      }
      setResult(next);
      onInstalled();
    } catch (failure) {
      setError(describeError(failure, '安装插件失败'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function enablePlugin() {
    if (!onEnable || !result || lock.current || enabled) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await onEnable(result.id);
      setEnabled(true);
    } catch (failure) {
      setError(describeError(failure, '启用插件失败'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <Modal open title="添加插件" width={560} className="plugin-source-installer" footer={null}
    closable={!busy} keyboard={!busy} maskClosable={false} onCancel={() => { if (!lock.current) onClose(); }}
    afterOpenChange={open => { if (open) input.current?.focus(); }}>
    {result ? <div className="plugin-source-result">
      <CheckCircleOutlined aria-hidden="true" />
      <h3 role="status">{enabled ? '插件已启用' : '插件已安装'}</h3>
      <dl><div><dt>插件</dt><dd>{result.id}</dd></div>
        <div><dt>版本</dt><dd>{result.version}</dd></div>
        <div><dt>运行位置</dt><dd>{result.profile === 'web' ? '独立网页' : 'Somnus 会话'}</dd></div></dl>
      {error && <Alert type="error" showIcon message={error} />}
      <div className="plugin-source-result-actions">
        {onEnable && !enabled && <Button type="primary" onClick={() => void enablePlugin()} loading={busy}>立即启用</Button>}
        <Button type={onEnable && !enabled ? 'default' : 'primary'} disabled={busy} onClick={onClose}>完成</Button>
      </div>
    </div> : <div className="plugin-source-body">
      <p>输入插件的 npm 包名、GitHub 仓库地址或 GitHub Release 下载链接。</p>
      <Input ref={input} value={reference} maxLength={1024} className="plugin-source-input"
        aria-label="包名或地址" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        placeholder="例如 dsh-plugin-whale-pet" disabled={busy}
        onChange={event => { setReference(event.target.value); setError(''); }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.repeat) {
            event.preventDefault();
            void submit();
          }
        }} />
      {error && <div id={errorId}><Alert type="error" showIcon message={error} /></div>}
      <button type="button" className="plugin-source-guide-toggle" aria-expanded={guide} aria-controls={guideId}
        onClick={() => setGuide(value => !value)}>
        <DownOutlined aria-hidden="true" />{guide ? '收起引导' : '插件安装引导和示例'}
      </button>
      {guide && <ol id={guideId} className="plugin-source-guide">
        {sources.map(source => <li key={source.name}>
          <div><strong>{source.name}</strong><small>{source.detail}</small><code>{source.reference}</code></div>
          <Button size="small" disabled={busy} aria-label={'填入示例 ' + source.name} onClick={() => {
            setReference(source.reference);
            setError('');
            input.current?.focus();
          }}>填入示例</Button>
        </li>)}
      </ol>}
      <p className="plugin-source-safety" role="note"><WarningOutlined aria-hidden="true" />
        <span>只安装你信任的插件。桌面版会检查来源和版本，并在安装前请你确认。</span>
      </p>
      {busy && <p className="plugin-source-progress" role="status"><Spin size="small" />正在检查并安装插件…</p>}
      <Button type="primary" block onClick={() => void submit()} disabled={!reference.trim() || busy} loading={busy}>安装</Button>
    </div>}
  </Modal>;
}
