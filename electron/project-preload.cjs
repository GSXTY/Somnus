const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.protocol === 'http:' &&
    location.hostname === '127.0.0.1' && location.pathname === '/') {
  contextBridge.exposeInMainWorld('somnusClipboard', {
    writeText: value => ipcRenderer.invoke('vvman-acp:copy-text', value),
  });
  if (process.platform === 'win32') contextBridge.exposeInMainWorld('somnusDesktop', {
    run: action => ipcRenderer.invoke('somnus-desktop:run', action),
    teamwork: conversationId => ipcRenderer.invoke('vvman-acp:teamwork', conversationId),
    setTeamwork: (conversationId, enabled) => ipcRenderer.invoke('vvman-acp:set-teamwork', conversationId, enabled),
  });
  const terminalPrefix = 'somnus-workspace-terminal:';
  function onTerminalEvent(action, listener) {
    const channel = terminalPrefix + action;
    const forward = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, forward);
    return () => ipcRenderer.removeListener(channel, forward);
  }
  if (process.platform === 'win32') contextBridge.exposeInMainWorld('somnusWorkspaceFiles', {
    watch: input => ipcRenderer.invoke('somnus-workspace-files:watch',input),
    unwatch: (id,cid) => ipcRenderer.invoke('somnus-workspace-files:unwatch',id,cid),
    onChange: listener => { const receive=(_event,value)=>listener(value);ipcRenderer.on('somnus-workspace-files:change',receive);return ()=>ipcRenderer.removeListener('somnus-workspace-files:change',receive); },
  });
  if (process.platform === 'win32') contextBridge.exposeInMainWorld('somnusWorkspaceTerminal', {
    shells: () => ipcRenderer.invoke(terminalPrefix + 'shells'),
    list: (projectId,sourceIndex,cid) => ipcRenderer.invoke(terminalPrefix+'list',projectId,sourceIndex,cid),
    snapshot: (id,cid) => ipcRenderer.invoke(terminalPrefix+'snapshot',id,cid),
    start: (projectId, sourceIndex, conversationId, cols, rows, shellId) =>
      ipcRenderer.invoke(terminalPrefix + 'start', projectId, sourceIndex, conversationId, cols, rows,shellId),
    write: (id, data,cid) => ipcRenderer.invoke(terminalPrefix + 'write', id, data,cid),
    resize: (id, cols, rows,cid) => ipcRenderer.invoke(terminalPrefix + 'resize', id, cols, rows,cid),
    stop: (id,cid) => ipcRenderer.invoke(terminalPrefix + 'stop', id,cid),
    onData: listener => onTerminalEvent('data', listener),
    onExit: listener => onTerminalEvent('exit', listener),
    onState: listener => onTerminalEvent('state', listener),
  });
  if (process.platform === 'win32') contextBridge.exposeInMainWorld('somnusDshIm', {
    status: () => ipcRenderer.invoke('somnus-dsh-im:status'),
    show: bounds => ipcRenderer.invoke('somnus-dsh-im:show', bounds),
    bounds: bounds => ipcRenderer.invoke('somnus-dsh-im:bounds', bounds),
    close: () => ipcRenderer.invoke('somnus-dsh-im:close'),
  });
  if (process.platform === 'win32') {
    const ownedPages = id => ipcRenderer.invoke('somnus-plugin-pages:list', id);
    const showOwned = async (id, bounds) => {
      await ipcRenderer.invoke('somnus-dsh-plugin-page:close');
      return ipcRenderer.invoke('somnus-plugin-pages:show', id, bounds);
    };
    contextBridge.exposeInMainWorld('somnusDshPluginPage', {
      extensions: id => ipcRenderer.invoke('somnus-plugin-pages:extensions', id),
      list: () => ownedPages(),
      showOwned,
      status: async (id, source) => (source === 'community' && (await ownedPages(id)).length)
        ? { available: true } : ipcRenderer.invoke('somnus-dsh-plugin-page:status', id, source),
      show: async (id, source, bounds) => {
        const page = source === 'community' && (await ownedPages(id))[0];
        if (page) return showOwned(page.id, bounds);
        await ipcRenderer.invoke('somnus-plugin-pages:close');
        return ipcRenderer.invoke('somnus-dsh-plugin-page:show', bounds, id, source);
      },
      bounds: bounds => Promise.all([ipcRenderer.invoke('somnus-dsh-plugin-page:bounds', bounds),
        ipcRenderer.invoke('somnus-plugin-pages:bounds', bounds)]).then(() => {}),
      close: () => Promise.all([ipcRenderer.invoke('somnus-dsh-plugin-page:close'),
        ipcRenderer.invoke('somnus-plugin-pages:close')]).then(() => {}),
    });
  }
  if (process.platform === 'win32') contextBridge.exposeInMainWorld('somnusNativeDshChat', {
    promptConversation: input => ipcRenderer.invoke('vvman-acp:native-dsh-prompt', input),
    listCommands: input => ipcRenderer.invoke('vvman-acp:native-dsh-list-commands', input),
    taskState: input => ipcRenderer.invoke('vvman-acp:native-dsh-task-state', input),
    listAgentModes: input => ipcRenderer.invoke('vvman-acp:native-dsh-list-agent-modes', input),
    selectAgentMode: input => ipcRenderer.invoke('vvman-acp:native-dsh-select-agent-mode', input),
    executeCommand: input => ipcRenderer.invoke('vvman-acp:native-dsh-execute-command', input),
    cancelConversation: id => ipcRenderer.invoke('vvman-acp:native-dsh-cancel', id),
    steer: input => ipcRenderer.invoke('vvman-acp:native-dsh-steer', input),
    steerQueue: input => ipcRenderer.invoke('vvman-acp:native-dsh-steer-queue', input),
    inheritedHistory: input => ipcRenderer.invoke('vvman-acp:native-dsh-inherited-history',input),
    nativePreferences: input => ipcRenderer.invoke('vvman-acp:native-dsh-native-preferences',input),
    saveNativePreferences: input => ipcRenderer.invoke('vvman-acp:native-dsh-save-native-preferences',input),
    childConversation: input => ipcRenderer.invoke('vvman-acp:native-dsh-child-conversation', input),
    history: input => ipcRenderer.invoke('vvman-acp:native-dsh-history', input),
    trajectory: input => ipcRenderer.invoke('vvman-acp:native-dsh-history', input),
    historyTool: input => ipcRenderer.invoke('vvman-acp:native-dsh-history-tool', input),
    fork: input => ipcRenderer.invoke('vvman-acp:native-dsh-fork', input),
    subagentDetail: input => ipcRenderer.invoke('vvman-acp:native-dsh-subagent-detail', input),
    subagentToolDetail: input => ipcRenderer.invoke('vvman-acp:native-dsh-subagent-tool', input),
    respondPermission: (id, requestId, optionId) =>
      ipcRenderer.invoke('vvman-acp:native-dsh-respond-permission', id, requestId, optionId),
    respondQuestion: (id, requestId, answers) =>
      ipcRenderer.invoke('vvman-acp:native-dsh-respond-question', id, requestId, answers),
    holdQuestion: (id, requestId, held) =>
      ipcRenderer.invoke('vvman-acp:native-dsh-hold-question', id, requestId, held),
    recoverQuestions: id => ipcRenderer.invoke('vvman-acp:native-dsh-recover-questions', id),
    getDraft: id => ipcRenderer.invoke('vvman-acp:native-dsh-read-draft', id),
    saveDraft: (id, draft) => ipcRenderer.invoke('vvman-acp:native-dsh-save-draft', id, draft),
    getQueue: id => ipcRenderer.invoke('vvman-acp:native-dsh-read-queue', id),
    saveQueue: (id, items) => ipcRenderer.invoke('vvman-acp:native-dsh-save-queue', id, items),
    onUpdate: callback => {
      const channel = 'vvman-acp:native-dsh-update';
      const listener = (_event, update) => callback(update);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  });
  if (process.platform === 'win32') contextBridge.exposeInMainWorld('somnusAddonInstaller', {
    install: input => ipcRenderer.invoke('vvman-acp:install-chat-addon', input),
    onProgress: callback => {
      const channel = 'vvman-acp:chat-addon-progress';
      const listener = (_event, stage) => callback(stage);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  });
  contextBridge.exposeInMainWorld('somnusWorkspaceWeb', {
    show: (url, bounds) => ipcRenderer.invoke('somnus-workspace-web:show', url, bounds),
    bounds: bounds => ipcRenderer.invoke('somnus-workspace-web:bounds', bounds),
    close: () => ipcRenderer.invoke('somnus-workspace-web:close'),
  });
  ipcRenderer.on('somnus-task-attention:open', (_event, hash) => {
    if (!/^#(?:assistant\?conversation|deep-analysis\?task)=[a-f0-9]{32}$/.test(hash)) return;
    if (location.hash === hash) window.dispatchEvent(new Event('hashchange'));
    else location.hash = hash;
  });
  contextBridge.exposeInMainWorld('somnusTaskAttention', {
    conversationFinished: (conversationId, replyId, status) =>
      ipcRenderer.invoke('somnus-task-attention:turn', conversationId, replyId, status),
    watchAnalysis: id => ipcRenderer.invoke('somnus-task-attention:analysis', id),
    takePending: () => ipcRenderer.invoke('somnus-task-attention:take-pending'),
  });
  contextBridge.exposeInMainWorld('somnusPluginWorkspace', {
    status: () => ipcRenderer.invoke('somnus-plugin-workspace:status'),
    openFolder: scope => ipcRenderer.invoke('somnus-plugin-workspace:open-folder', scope),
    choosePersonalManifest: () => ipcRenderer.invoke('somnus-plugin-workspace:choose-personal-manifest'),
    saveCandidate: candidateId => ipcRenderer.invoke('somnus-plugin-workspace:save-candidate', candidateId),
  });
  contextBridge.exposeInMainWorld('somnusDocuments', {
    list: (scope, folder = '') => ipcRenderer.invoke('somnus-documents:list', scope, folder),
    createFolder: (folder, name) => ipcRenderer.invoke('somnus-documents:create-folder', folder, name),
    createFile: (folder, name, content) => ipcRenderer.invoke('somnus-documents:create-file', folder, name, content),
    deleteEntry: entryPath => ipcRenderer.invoke('somnus-documents:delete-entry', entryPath),
    importFiles: folder => ipcRenderer.invoke('somnus-documents:import-files', folder),
    readFile: (scope, file) => ipcRenderer.invoke('somnus-documents:read-file', scope, file),
    openFile: (scope, file) => ipcRenderer.invoke('somnus-documents:open-file', scope, file),
  });
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
    chooseDocumentFolder: folder => ipcRenderer.invoke('vvman-projects:choose-document-folder', folder),
    openDirectory: (projectId, sourceIndex, target) =>
      ipcRenderer.invoke('vvman-projects:open-directory', projectId, sourceIndex, target),
    approvedFileLocation: (conversationId, proposalId) => ipcRenderer.invoke('vvman-projects:approved-file-location', conversationId, proposalId),
    openApprovedFile: (conversationId, proposalId) => ipcRenderer.invoke('vvman-projects:open-approved-file', conversationId, proposalId),
    revealProposal: (conversationId, proposalId) => ipcRenderer.invoke('vvman-projects:reveal-proposal', conversationId, proposalId),
    chooseTestExecutable: () => ipcRenderer.invoke('vvman-projects:choose-test-executable'),
    listTestRunners: projectId => ipcRenderer.invoke('vvman-projects:list-test-runners', projectId),
    saveTestRunner: (projectId, runner) => ipcRenderer.invoke('vvman-projects:save-test-runner', projectId, runner),
    removeTestRunner: (projectId, runnerId) => ipcRenderer.invoke('vvman-projects:remove-test-runner', projectId, runnerId),
    runTests: (projectId, runnerId, conversationId) => ipcRenderer.invoke('vvman-projects:run-tests', projectId, runnerId, conversationId),
    gitDiff: (projectId, source, conversationId) => ipcRenderer.invoke('vvman-projects:git-diff', projectId, source, conversationId),
    createWorktree: (conversationId, source) => ipcRenderer.invoke('vvman-projects:create-worktree', conversationId, source),
    openWorktree: (conversationId, target) => ipcRenderer.invoke('vvman-projects:open-worktree', conversationId, target),
    worktreeLocation: conversationId => ipcRenderer.invoke('vvman-projects:worktree-location', conversationId),
    prepareDevelopment: (conversationId, id) => ipcRenderer.invoke('vvman-projects:prepare-development', conversationId, id),
    respondDevelopment: (conversationId, id, approved) => ipcRenderer.invoke('vvman-projects:respond-development', conversationId, id, approved),
    cancelDevelopment: (conversationId, id) => ipcRenderer.invoke('vvman-projects:cancel-development', conversationId, id),
  });
  contextBridge.exposeInMainWorld('somnusRuntime', {
    onAppearance: listener => {
      const receive = (_event,value) => listener(value);
      ipcRenderer.on('somnus-runtime:appearance',receive);
      return () => ipcRenderer.removeListener('somnus-runtime:appearance',receive);
    },
    setAppearance: value => ipcRenderer.invoke('vvman-acp:runtime-appearance', value),
    uiPreferences: () => ipcRenderer.invoke('vvman-acp:runtime-ui-preferences'),
    saveUiPreferences: value => ipcRenderer.invoke('vvman-acp:save-runtime-ui-preferences', value),
    settings: () => ipcRenderer.invoke('vvman-acp:runtime-settings'),
    setSettings: value => ipcRenderer.invoke('vvman-acp:set-runtime-settings', value),
    diagnostics: () => ipcRenderer.invoke('vvman-acp:runtime-diagnostics'),
    capabilities: input => ipcRenderer.invoke('vvman-acp:runtime-capabilities', input),
    cancelTask: input => ipcRenderer.invoke('vvman-acp:runtime-cancel-task', input),
    interactions: input => ipcRenderer.invoke('vvman-acp:runtime-interactions', input),
    respondPermission: (input, requestId, optionId) => ipcRenderer.invoke('vvman-acp:runtime-respond-permission', input, requestId, optionId),
    respondQuestion: (input, requestId, answers) => ipcRenderer.invoke('vvman-acp:runtime-respond-question', input, requestId, answers),
  });
  contextBridge.exposeInMainWorld('vvmanAcp', {
    list: () => ipcRenderer.invoke('vvman-acp:list'),
    detectAdapter: provider => ipcRenderer.invoke('vvman-acp:detect-adapter', provider),
    companyRuntime: modelId => ipcRenderer.invoke('vvman-acp:company-runtime', modelId),
    dshPluginMarket: () => ipcRenderer.invoke('vvman-acp:dsh-plugin-market'),
    dshInstalledPlugins: () => ipcRenderer.invoke('vvman-acp:dsh-installed-plugins'),
    dshPluginSettings: (id, source) => ipcRenderer.invoke('vvman-acp:dsh-plugin-settings', id, source),
    saveDshPluginSettings: (id, source, section, revision, edits) =>
      ipcRenderer.invoke('vvman-acp:save-dsh-plugin-settings', id, source, section, revision, edits),
    dshSkills: () => ipcRenderer.invoke('vvman-acp:dsh-skills'),
    agentExecutionSettings: () => ipcRenderer.invoke('vvman-acp:agent-execution-settings'),
    setAgentExecutionSettings: settings => ipcRenderer.invoke('vvman-acp:set-agent-execution-settings', settings),
    setDshInstalledPluginEnabled: (id, source, enabled) => ipcRenderer.invoke('vvman-acp:set-dsh-installed-plugin-enabled', id, source, enabled),
    uninstallDshPlugin: (id, source) => ipcRenderer.invoke('vvman-acp:uninstall-dsh-plugin', id, source),
    installDshPluginSource: reference => ipcRenderer.invoke('vvman-acp:install-dsh-plugin-source', reference),
    dshOarStatus: () => ipcRenderer.invoke('vvman-acp:dsh-oar-status'),
    setDshOarEnabled: enabled => ipcRenderer.invoke('vvman-acp:set-dsh-oar-enabled', enabled),
    dshCommunityMarket: (query, refresh, source, options) => ipcRenderer.invoke('vvman-acp:dsh-community-market', query, refresh, source, options),
    dshMcpConnections: () => ipcRenderer.invoke('vvman-acp:dsh-mcp-connections'),
    changeDshCommunityPlugin: (id, action, query, source) => ipcRenderer.invoke('vvman-acp:change-dsh-community-plugin', id, action, query, source),
    setDshCommunityMarketSources: urls => ipcRenderer.invoke('vvman-acp:set-dsh-community-market-sources', urls),
    installDshCommunityPluginVersion: (id, version, source, query) =>
      ipcRenderer.invoke('vvman-acp:install-dsh-community-plugin-version', id, version, source, query),
    installDshPlugin: id => ipcRenderer.invoke('vvman-acp:install-dsh-plugin', id),
    removeDshPlugin: id => ipcRenderer.invoke('vvman-acp:remove-dsh-plugin', id),
    managedDshAccountStatus: () => ipcRenderer.invoke('vvman-acp:managed-dsh-account-status'),
    signInManagedDshAccount: () => ipcRenderer.invoke('vvman-acp:sign-in-managed-dsh-account'),
    connectManagedDsh: () => ipcRenderer.invoke('vvman-acp:connect-managed-dsh'),
    connectCodex: () => ipcRenderer.invoke('vvman-acp:connect-codex'),
    chooseExecutable: () => ipcRenderer.invoke('vvman-acp:choose-executable'),
    save: profile => ipcRenderer.invoke('vvman-acp:save', profile),
    remove: id => ipcRenderer.invoke('vvman-acp:remove', id),
    probe: id => ipcRenderer.invoke('vvman-acp:probe', id),
    agentReadiness: () => ipcRenderer.invoke('vvman-acp:agent-readiness'),
    saveConfigurationCheckpoint: (id, revision) => ipcRenderer.invoke('vvman-acp:save-configuration-checkpoint', id, revision),
    authenticate: (id, methodId) => ipcRenderer.invoke('vvman-acp:authenticate', id, methodId),
    cancelAuthentication: () => ipcRenderer.invoke('vvman-acp:cancel-authentication'),
    prompt: (id, text) => ipcRenderer.invoke('vvman-acp:prompt', id, text),
    listDelegationAgents: () => ipcRenderer.invoke('vvman-acp:list-delegation-agents'),
    runDelegation: input => ipcRenderer.invoke('vvman-acp:run-delegation', input),
    cancelDelegation: (conversationId, requestId) => ipcRenderer.invoke('vvman-acp:cancel-delegation', conversationId, requestId),
    discoverModels: (id, modelId) => ipcRenderer.invoke('vvman-acp:discover-models', id, modelId),
    promptConversation: input => ipcRenderer.invoke('vvman-acp:prompt-conversation', input),
    connectionStates: input => ipcRenderer.invoke('vvman-acp:connection-states', input),
    warmConversation: input => ipcRenderer.invoke('vvman-acp:warm-conversation', input),
    releaseConversationAgent: input => ipcRenderer.invoke('vvman-acp:release-conversation-agent', input),
    cancelConversation: (id, turnId) => ipcRenderer.invoke('vvman-acp:cancel-conversation', id, turnId),
    resetConversation: id => ipcRenderer.invoke('vvman-acp:reset-conversation', id),
    respondPermission: (conversationId, requestId, optionId, turnId) =>
      ipcRenderer.invoke('vvman-acp:respond-permission', conversationId, requestId, optionId, turnId),
    cancel: () => ipcRenderer.invoke('vvman-acp:cancel'),
    reset: () => ipcRenderer.invoke('vvman-acp:reset'),
    onUpdate: callback => {
      const listener = (_event, update) => callback(update);
      ipcRenderer.on('vvman-acp:update', listener);
      return () => ipcRenderer.removeListener('vvman-acp:update', listener);
    },
  });
}
