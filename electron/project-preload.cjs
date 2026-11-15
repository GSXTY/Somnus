const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.protocol === 'http:' &&
    location.hostname === '127.0.0.1' && location.pathname === '/') {
  contextBridge.exposeInMainWorld('somnusUpdater', {
    getState: () => ipcRenderer.invoke('somnus-updater:getState'),
    check: () => ipcRenderer.invoke('somnus-updater:check'),
    download: () => ipcRenderer.invoke('somnus-updater:download'),
    install: () => ipcRenderer.invoke('somnus-updater:install'),
    subscribe: callback => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('somnus-updater:state', listener);
      return () => ipcRenderer.removeListener('somnus-updater:state', listener);
    },
  });
  contextBridge.exposeInMainWorld('vvmanProjects', {
    chooseDirectory: () => ipcRenderer.invoke('vvman-projects:choose-directory'),
    openDirectory: (projectId, sourceIndex) => ipcRenderer.invoke('vvman-projects:open-directory', projectId, sourceIndex),
    chooseTestExecutable: () => ipcRenderer.invoke('vvman-projects:choose-test-executable'),
    listTestRunners: projectId => ipcRenderer.invoke('vvman-projects:list-test-runners', projectId),
    saveTestRunner: (projectId, runner) => ipcRenderer.invoke('vvman-projects:save-test-runner', projectId, runner),
    removeTestRunner: (projectId, runnerId) => ipcRenderer.invoke('vvman-projects:remove-test-runner', projectId, runnerId),
    runTests: (projectId, runnerId, conversationId) => ipcRenderer.invoke('vvman-projects:run-tests', projectId, runnerId, conversationId),
    gitDiff: (projectId, source, conversationId) => ipcRenderer.invoke('vvman-projects:git-diff', projectId, source, conversationId),
    createWorktree: (conversationId, source) => ipcRenderer.invoke('vvman-projects:create-worktree', conversationId, source),
    openWorktree: conversationId => ipcRenderer.invoke('vvman-projects:open-worktree', conversationId),
    prepareDevelopment: (conversationId, id) => ipcRenderer.invoke('vvman-projects:prepare-development', conversationId, id),
    respondDevelopment: (conversationId, id, approved) => ipcRenderer.invoke('vvman-projects:respond-development', conversationId, id, approved),
    cancelDevelopment: (conversationId, id) => ipcRenderer.invoke('vvman-projects:cancel-development', conversationId, id),
  });
  contextBridge.exposeInMainWorld('vvmanAcp', {
    list: () => ipcRenderer.invoke('vvman-acp:list'),
    detectAdapter: provider => ipcRenderer.invoke('vvman-acp:detect-adapter', provider),
    openDeepSeekHarness: () => ipcRenderer.invoke('vvman-acp:open-deepseek-harness'),
    companyRuntime: modelId => ipcRenderer.invoke('vvman-acp:company-runtime', modelId),
    dshPluginMarket: () => ipcRenderer.invoke('vvman-acp:dsh-plugin-market'),
    dshInstalledPlugins: () => ipcRenderer.invoke('vvman-acp:dsh-installed-plugins'),
    setDshInstalledPluginEnabled: (id, source, enabled) => ipcRenderer.invoke('vvman-acp:set-dsh-installed-plugin-enabled', id, source, enabled),
    dshCommunityMarket: (query, refresh) => ipcRenderer.invoke('vvman-acp:dsh-community-market', query, refresh),
    changeDshCommunityPlugin: (id, action, query) => ipcRenderer.invoke('vvman-acp:change-dsh-community-plugin', id, action, query),
    installDshPlugin: id => ipcRenderer.invoke('vvman-acp:install-dsh-plugin', id),
    removeDshPlugin: id => ipcRenderer.invoke('vvman-acp:remove-dsh-plugin', id),
    openManagedDshSettings: () => ipcRenderer.invoke('vvman-acp:open-managed-dsh-settings'),
    managedDshAccountStatus: () => ipcRenderer.invoke('vvman-acp:managed-dsh-account-status'),
    signInManagedDshAccount: () => ipcRenderer.invoke('vvman-acp:sign-in-managed-dsh-account'),
    connectManagedDsh: () => ipcRenderer.invoke('vvman-acp:connect-managed-dsh'),
    connectCodex: () => ipcRenderer.invoke('vvman-acp:connect-codex'),
    chooseExecutable: () => ipcRenderer.invoke('vvman-acp:choose-executable'),
    save: profile => ipcRenderer.invoke('vvman-acp:save', profile),
    remove: id => ipcRenderer.invoke('vvman-acp:remove', id),
    probe: id => ipcRenderer.invoke('vvman-acp:probe', id),
    authenticate: (id, methodId) => ipcRenderer.invoke('vvman-acp:authenticate', id, methodId),
    cancelAuthentication: () => ipcRenderer.invoke('vvman-acp:cancel-authentication'),
    prompt: (id, text) => ipcRenderer.invoke('vvman-acp:prompt', id, text),
    listDelegationAgents: () => ipcRenderer.invoke('vvman-acp:list-delegation-agents'),
    runDelegation: input => ipcRenderer.invoke('vvman-acp:run-delegation', input),
    cancelDelegation: (conversationId, requestId) => ipcRenderer.invoke('vvman-acp:cancel-delegation', conversationId, requestId),
    discoverModels: (id, modelId) => ipcRenderer.invoke('vvman-acp:discover-models', id, modelId),
    promptConversation: input => ipcRenderer.invoke('vvman-acp:prompt-conversation', input),
    cancelConversation: id => ipcRenderer.invoke('vvman-acp:cancel-conversation', id),
    resetConversation: id => ipcRenderer.invoke('vvman-acp:reset-conversation', id),
    respondPermission: (conversationId, requestId, optionId) =>
      ipcRenderer.invoke('vvman-acp:respond-permission', conversationId, requestId, optionId),
    cancel: () => ipcRenderer.invoke('vvman-acp:cancel'),
    reset: () => ipcRenderer.invoke('vvman-acp:reset'),
    onUpdate: callback => {
      const listener = (_event, update) => callback(update);
      ipcRenderer.on('vvman-acp:update', listener);
      return () => ipcRenderer.removeListener('vvman-acp:update', listener);
    },
  });
}

