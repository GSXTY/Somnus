export const configurationMethods = Object.freeze([
  'list', 'agentReadiness', 'detectAdapter', 'connectCodex', 'chooseExecutable',
  'save', 'remove', 'probe', 'authenticate', 'cancelAuthentication',
  'connectManagedDsh', 'managedDshAccountStatus', 'signInManagedDshAccount',
  'dshPluginMarket', 'prompt', 'cancel', 'nativeConfigChanged', 'refreshNativeModels',
  'agentExecutionSettings', 'setAgentExecutionSettings', 'discoverModels', 'saveConfigurationCheckpoint',
]);

/** Bind only the app-owned iframe and its exact loopback origin. */
export function attachConfigurationRelay(hostWindow, frame, origin, bridge, activity = () => ({ known: false, active: true })) {
  const onMessage = async event => {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    const request = event.data;
    if (request?.type !== 'somnus-config-request' || typeof request.id !== 'string' ||
        !configurationMethods.includes(request.method) || !Array.isArray(request.args)) return;
    const response = { type: 'somnus-config-response', id: request.id };
    try {
      if (request.method === 'refreshNativeModels') {
        const current = activity();
        if (!current.known) throw new Error('暂时无法确认任务状态，请稍后重试。');
        if (current.active) throw new Error('仍有任务正在运行，请等待任务完成后更新模型列表。');
      }
      if (!bridge?.configuration) throw new Error('配置连接尚未就绪，请稍后重试。');
      response.result = await bridge.configuration(request.method, request.args);
    } catch (error) { response.error = error instanceof Error ? error.message : '配置操作未完成'; }
    frame.contentWindow?.postMessage(response, origin);
  };
  hostWindow.addEventListener('message', onMessage);
  const unsubscribe = bridge?.onConfigurationUpdate?.(update => {
    frame.contentWindow?.postMessage({ type: 'somnus-config-update', update }, origin);
  });
  return () => { hostWindow.removeEventListener('message', onMessage); unsubscribe?.(); };
}

export function nativeRefreshActivity(snapshot) {
  if (!snapshot || typeof snapshot.byId !== 'object' || snapshot.byId === null) return { known: false, active: true };
  const sessions = Object.values(snapshot.byId);
  if (sessions.some(value => typeof value?.running !== 'boolean')) return { known: false, active: true };
  return { known: true, active: sessions.some(value => value.running) };
}

/** Install before embedded React renders; never replace the native preload. */
export function installEmbeddedConfigurationBridge(target = window) {
  if (target.parent === target || target.vvmanAcp) return;
  const requested = new URL(target.location.href).searchParams.get('somnus_parent_origin');
  if (!requested) return;
  let parentOrigin;
  try {
    const url = new URL(requested);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
    parentOrigin = url.origin;
  } catch { return; }
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  target.addEventListener('message', event => {
    if (event.source !== target.parent || event.origin !== parentOrigin) return;
    const value = event.data;
    if (value?.type === 'somnus-config-update') { listeners.forEach(listener => listener(value.update)); return; }
    if (value?.type !== 'somnus-config-response') return;
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id); target.clearTimeout(request.timer);
    if (typeof value.error === 'string') request.reject(new Error(value.error));
    else request.resolve(value.result);
  });
  const bridge = Object.fromEntries(configurationMethods.map(method => [method, (...args) => new Promise((resolve, reject) => {
    const id = `somnus-config-${++sequence}`;
    const timer = target.setTimeout(() => { pending.delete(id); reject(new Error('配置连接超时，请重试。')); }, method === 'authenticate' || method === 'connectCodex' ? 300000 : 60000);
    pending.set(id, { resolve, reject, timer });
    target.parent.postMessage({ type: 'somnus-config-request', id, method, args }, parentOrigin);
  })]));
  bridge.onUpdate = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  target.vvmanAcp = bridge;
}
