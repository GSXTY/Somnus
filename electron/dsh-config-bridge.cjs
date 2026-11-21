const CONFIG_METHODS = Object.freeze({
  prompt: 'prompt', cancel: 'cancel', list: 'list', agentReadiness: 'agent-readiness', save: 'save', remove: 'remove', probe: 'probe',
  authenticate: 'authenticate', cancelAuthentication: 'cancel-authentication',
  detectAdapter: 'detect-adapter', chooseExecutable: 'choose-executable', connectCodex: 'connect-codex',
  connectManagedDsh: 'connect-managed-dsh', managedDshAccountStatus: 'managed-dsh-account-status',
  signInManagedDshAccount: 'sign-in-managed-dsh-account', dshPluginMarket: 'dsh-plugin-market',
  agentExecutionSettings: 'agent-execution-settings', setAgentExecutionSettings: 'set-agent-execution-settings',
  discoverModels: 'discover-models', saveConfigurationCheckpoint: 'save-configuration-checkpoint',
});
function verifyConfigurationSender(event, window, rendererOrigin) {
  const frame = event?.senderFrame;
  if (!window || window.isDestroyed() || event?.sender !== window.webContents ||
      frame !== window.webContents.mainFrame || frame?.detached ||
      URL.parse(frame?.url || '')?.origin !== rendererOrigin) {
    throw new Error('Somnus configuration rejected an unowned renderer');
  }
}
function createConfigurationDispatcher({ window, rendererOrigin, handlers, onNativeConfigChanged, onRefreshNativeModels }) {
  return async (event, method, args) => {
    verifyConfigurationSender(event, window, rendererOrigin());
    if (typeof method !== 'string' || !Array.isArray(args) || args.length > 16 || JSON.stringify(args).length > 256 * 1024) {
      throw new Error('Invalid Somnus configuration request');
    }
    if (method === 'nativeConfigChanged') return onNativeConfigChanged();
    if (method === 'refreshNativeModels') return onRefreshNativeModels();
    if (!Object.hasOwn(CONFIG_METHODS, method)) throw new Error('Unsupported Somnus configuration action');
    const handler = handlers.get('vvman-acp:' + CONFIG_METHODS[method]);
    if (!handler) throw new Error('Somnus configuration is not ready');
    return handler(event, ...args);
  };
}
module.exports = { CONFIG_METHODS, verifyConfigurationSender, createConfigurationDispatcher };
