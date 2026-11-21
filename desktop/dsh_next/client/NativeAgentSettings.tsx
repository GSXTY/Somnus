import { useEffect, useRef, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import somnusMark from '../../../electron/brand/somnus.png';
import { attachConfigurationRelay } from '../../../page_design/frontend/src/configuration/embeddedConfigurationBridge.mjs';
import { externalProvider } from './model-provider-route.mjs';
import './native-agent-settings.css';

export interface SomnusSettingsBridge {
  origin(): Promise<string>;
  configuration?(method: string, args: unknown[]): Promise<unknown>;
  onConfigurationUpdate?(listener: (update: unknown) => void): () => void;
}

export function NativeModelSettingsAction({ onOpen, dismiss }: { onOpen(): void; dismiss(): void }) {
  return <Button variant="ghost" size="sm" onClick={() => { dismiss(); onOpen(); }}>模型与 Agent 设置</Button>;
}

export { externalProvider };

export function NativeModelIdentity({ provider, model, placement }: {
  provider: { id: string; name: string }; model: { id: string; name: string }; placement: string;
}) {
  if (placement !== 'trigger') return <>{model.name}</>;
  const external = externalProvider(provider);
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    {!external && <img src={somnusMark} alt="" width={15} height={15} />}
    <span>{external ? provider.name : 'Somnus'} / {model.name}</span>
  </span>;
}

/**
 * The native settings surface embeds the complete Somnus configuration center.
 * The embedded page talks to the desktop ACP bridge through the parent relay,
 * so Agent installation, credentials, Providers, MCP, Skills and plugins all
 * keep their existing behavior instead of being reimplemented here.
 */
export function NativeAgentSettings(_props: { configuration: (method: string, args: unknown[]) => Promise<any>; styles: Record<string, string> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const bridge = (window as Window & { somnusApi?: SomnusSettingsBridge }).somnusApi;
    if (!bridge?.origin) {
      setError('配置中心连接尚未就绪。');
      return () => { active = false; };
    }
    void bridge.origin().then(value => {
      if (active) setOrigin(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '无法打开配置中心。');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!origin || !frame.current) return;
    const bridge = (window as Window & { somnusApi?: SomnusSettingsBridge }).somnusApi;
    if (!bridge) return;
    return attachConfigurationRelay(window, frame.current, new URL(origin).origin, bridge,
      () => ({ known: true, active: false }));
  }, [origin]);

  if (error) return <div className="somnus-native-config-state" role="alert">{error}</div>;
  if (!origin) return <div className="somnus-native-config-state" role="status">正在打开配置中心…</div>;
  const src = `${origin}/workbench-assets/embed.html?somnus_parent_origin=${encodeURIComponent(window.location.origin)}#config`;
  return <div className="somnus-native-config-embed">
    <iframe ref={frame} src={src} title="Somnus 配置中心" />
  </div>;
}
