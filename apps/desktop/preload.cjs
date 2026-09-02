const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  createObsidianNote: (vaultDir, filename, content) => ipcRenderer.invoke('obsidian:createNote', { vaultDir, filename, content }),
  scanFolder: (folderPath) => ipcRenderer.invoke('fs:scanFolder', folderPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  getGitStatus: (folderPath) => ipcRenderer.invoke('git:status', folderPath),
  checkPort: (port) => ipcRenderer.invoke('net:checkPort', port),
  listPorts: () => ipcRenderer.invoke('ports:list'),
  killPortProcess: (port) => ipcRenderer.invoke('ports:kill', port),
  runBuildCommand: (folderPath, command) => ipcRenderer.invoke('build:run', { folderPath, command }),
  fetchStatusUrl: (url) => ipcRenderer.invoke('net:fetchStatusUrl', url),
  backupWrite: (dir, data) => ipcRenderer.invoke('backup:write', { dir, data }),
  backupRead: (filePath) => ipcRenderer.invoke('backup:read', filePath),
  selectRestoreFile: () => ipcRenderer.invoke('backup:selectRestoreFile'),
  mcpListTools: () => ipcRenderer.invoke('mcp:listTools'),
  mcpCallTool: (name, args) => ipcRenderer.invoke('mcp:callTool', { name, args }),
  storeGet: () => ipcRenderer.invoke('store:get'),
  storeSave: (key, value) => ipcRenderer.invoke('store:save', { key, value }),
  checkAnswerConfidence: (model, question, answer) => ipcRenderer.invoke('confidence:check', { model, question, answer }),
  escalateToClaude: (question) => ipcRenderer.invoke('confidence:escalate', { question }),
  getEscalationStats: () => ipcRenderer.invoke('confidence:stats'),
  checkInShouldInclude: () => ipcRenderer.invoke('checkin:shouldInclude'),
  isLockConfigured: () => ipcRenderer.invoke('lock:isConfigured'),
  verifyLockPin: (pin) => ipcRenderer.invoke('lock:verifyPin', pin),
  setupLockPin: (newPin) => ipcRenderer.invoke('lock:setup', newPin),
  changeLockPin: (currentPin, newPin) => ipcRenderer.invoke('lock:changePin', { currentPin, newPin }),
  clearLockPin: (currentPin) => ipcRenderer.invoke('lock:clearPin', currentPin),
  researchTopic: (topic) => ipcRenderer.invoke('research:topic', topic),
  getSkillsDashboard: () => ipcRenderer.invoke('dashboard:skills'),
  proofreadDocument: (originalDocument, localResponse) => ipcRenderer.invoke('document:proofread', originalDocument, localResponse),
  parseDocument: (bytes, filename) => ipcRenderer.invoke('document:parse', { bytes, filename }),
  saveLearnedKnowledge: (entry) => ipcRenderer.invoke('knowledge:save', entry),
  saveLesson: (entry) => ipcRenderer.invoke('lesson:save', entry),
  getLessons: () => ipcRenderer.invoke('lesson:list'),
  getRelevantKnowledge: (questionText) => ipcRenderer.invoke('knowledge:relevant', questionText),
  logToolCallSequence: (question, toolSequence) => ipcRenderer.invoke('skills:logToolSequence', question, toolSequence),
  getRelevantSkills: (questionText) => ipcRenderer.invoke('skills:relevant', questionText),
  autoResolveSkillsGaps: () => ipcRenderer.invoke('skills:autoresolve'),
  getAutoRipStatus: () => ipcRenderer.invoke('autorip:status'),
  searchKnowledgeGraph: (query) => ipcRenderer.invoke('knowledge:searchGraph', query),
  getNews: () => ipcRenderer.invoke('news:get'),
  getNewsSources: () => ipcRenderer.invoke('news:getSources'),
  setNewsSources: (sources) => ipcRenderer.invoke('news:setSources', sources),
  getNewsInterests: () => ipcRenderer.invoke('news:getInterests'),
  setNewsInterests: (interests) => ipcRenderer.invoke('news:setInterests', interests),
  refreshNews: () => ipcRenderer.invoke('news:refresh'),
  getNewsRefreshStatus: () => ipcRenderer.invoke('news:refreshStatus'),
  getServerToken: () => ipcRenderer.invoke('server:getToken'),
  getConnectedClients: () => ipcRenderer.invoke('server:getConnectedClients'),
  deleteLearnedKnowledge: (id) => ipcRenderer.invoke('knowledge:delete', id),
  deleteEscalation: (id) => ipcRenderer.invoke('escalation:delete', id),
  isUiSourceAvailable: () => ipcRenderer.invoke('ui-source:available'),
  readOwnUiSource: (relativePath) => ipcRenderer.invoke('ui-source:read', relativePath),
  proposeUiChange: (payload) => ipcRenderer.invoke('ui-source:propose', payload),
  listDevIdeas: () => ipcRenderer.invoke('dev-ideas:list'),
  addDevIdea: (payload) => ipcRenderer.invoke('dev-ideas:add', payload),
  updateDevIdeaStatus: (id, status) => ipcRenderer.invoke('dev-ideas:updateStatus', { id, status }),
  deleteDevIdea: (id) => ipcRenderer.invoke('dev-ideas:delete', id),
  getDependencyHealth: () => ipcRenderer.invoke('system:dependencyHealth'),
  logObservation: (obs) => ipcRenderer.invoke('aloy:log-observation', obs),
  getObservationLogs: () => ipcRenderer.invoke('aloy:get-observation-logs'),
  // HEPHAESTUS APIs
  hephListTasks: (filter) => ipcRenderer.invoke('hephaestus:listTasks', filter),
  hephGetTask: (taskId) => ipcRenderer.invoke('hephaestus:getTask', taskId),
  hephCreateTask: (taskData) => ipcRenderer.invoke('hephaestus:createTask', taskData),
  hephStageChange: (payload) => ipcRenderer.invoke('hephaestus:stageChange', payload),
  hephVerify: (payload) => ipcRenderer.invoke('hephaestus:verify', payload),
  hephApprove: (taskId) => ipcRenderer.invoke('hephaestus:approve', taskId),
  hephReject: (payload) => ipcRenderer.invoke('hephaestus:reject', payload),
  hephRollback: (taskId) => ipcRenderer.invoke('hephaestus:rollback', taskId),
  hephGetTrainingStats: () => ipcRenderer.invoke('hephaestus:getTrainingStats'),

  // Athena Research Scout IPC
  athenaListTasks: () => ipcRenderer.invoke('athena:listTasks'),
  athenaGetTask: (taskId) => ipcRenderer.invoke('athena:getTask', taskId),
  athenaCreateTask: (taskData) => ipcRenderer.invoke('athena:createTask', taskData),
  athenaDeleteTask: (taskId) => ipcRenderer.invoke('athena:deleteTask', taskId),
  athenaCancelTask: (taskId) => ipcRenderer.invoke('athena:cancelTask', taskId),

  // Apollo Document Intelligence IPC
  apolloListTasks: () => ipcRenderer.invoke('apollo:listTasks'),
  apolloGetTask: (taskId) => ipcRenderer.invoke('apollo:getTask', taskId),
  apolloCreateTask: (taskData) => ipcRenderer.invoke('apollo:createTask', taskData),
  apolloGardenMemories: () => ipcRenderer.invoke('apollo:gardenMemories'),
  apolloSyncVault: () => ipcRenderer.invoke('apollo:syncVault'),

  // Minerva Sentinel & Watchdog IPC
  minervaHealthScan: () => ipcRenderer.invoke('minerva:healthScan'),
  minervaDispatchAlert: (alertData) => ipcRenderer.invoke('minerva:dispatchAlert', alertData),
  // REMOVED: minervaHaCall. Its 'minerva:haCall' handler was deleted from
  // electron.cjs (see the note there) because it executed arbitrary Home
  // Assistant services with no securityGuard validation and no 2FA. Leaving
  // the bridge behind kept a dangling surface that reads like a bug to fix by
  // restoring the handler — which is exactly how the bypass came back once
  // already. Smart-home control from any UI goes through /api/smarthome/execute.
  getSecurityStats: () => ipcRenderer.invoke('minerva:securityStats'),
  getInboxFeed: (windowMs) => ipcRenderer.invoke('inbox:feed', windowMs),

  // Hermes Operations & Briefings IPC
  hermesDailyBrief: (params) => ipcRenderer.invoke('hermes:dailyBrief', params),
  hermesBudgetHealth: () => ipcRenderer.invoke('hermes:budgetHealth'),
  getPortfolioSnapshot: () => ipcRenderer.invoke('hermes:portfolioSnapshot'),
  setPortfolioShares: (symbol, shares) => ipcRenderer.invoke('hermes:setPortfolioShares', symbol, shares),
  conclaveLatest: () => ipcRenderer.invoke('conclave:latest'),
  conclaveHistory: () => ipcRenderer.invoke('conclave:history'),
  conveneConclave: (params) => ipcRenderer.invoke('conclave:convene', params),

  // Hermes Harvested RPC Pipeline, Dialectic Memory, Evolution & Gateway IPC
  hermesRunPipeline: (script, context) => ipcRenderer.invoke('hermes:runPipeline', { script, context }),
  hermesListSkills: () => ipcRenderer.invoke('hermes:listSkills'),
  hermesSynthesizeSkill: (skillData) => ipcRenderer.invoke('hermes:synthesizeSkill', skillData),
  hermesEvolveSkill: (skillName, reason, feedback) => ipcRenderer.invoke('hermes:evolveSkill', { skillName, reason, feedback }),
  hermesGetUserModel: () => ipcRenderer.invoke('hermes:getUserModel'),
  hermesUpdateUserModel: (updates) => ipcRenderer.invoke('hermes:updateUserModel', updates),
  hermesSearchMemory: (query, limit) => ipcRenderer.invoke('hermes:searchMemory', { query, limit }),
  hermesGetGatewayStatus: () => ipcRenderer.invoke('hermes:getGatewayStatus'),
  hermesScheduleTask: (task) => ipcRenderer.invoke('hermes:scheduleTask', task),

  // Job Radar IPC
  jobsGetListings: (filter) => ipcRenderer.invoke('jobs:getListings', filter),
  jobsScan: (params) => ipcRenderer.invoke('jobs:scan', params),
  jobsUpdateStatus: (id, status) => ipcRenderer.invoke('jobs:updateStatus', { id, status }),
  jobsGetConfig: () => ipcRenderer.invoke('jobs:getConfig'),
  jobsUpdateConfig: (config) => ipcRenderer.invoke('jobs:updateConfig', config),
  jobsGetSummary: () => ipcRenderer.invoke('jobs:getSummary'),

  // Model Router IPC
  modelsRoute: (messages) => ipcRenderer.invoke('models:route', messages),

  // Multi-Machine Remote IPC
  remoteGetMachinesStatus: () => ipcRenderer.invoke('remote:machinesStatus'),
  remoteGetMachineStatus: (machineId) => ipcRenderer.invoke('remote:machineStatus', machineId),
  remoteExec: (machineId, command, opts = {}) => ipcRenderer.invoke('remote:exec', { machineId, command, elevated: !!opts.elevated }),
  remoteLaunchTerminal: (machineId) => ipcRenderer.invoke('remote:launchTerminal', machineId),

  // Bazzite Remote IPC (Aliases)
  bazziteGetStatus: () => ipcRenderer.invoke('bazzite:status'),
  bazziteExec: (command) => ipcRenderer.invoke('bazzite:exec', command),
  bazziteLaunchTerminal: () => ipcRenderer.invoke('bazzite:launchTerminal'),

  // Top-Bar HUD Overlay Desktop IPC
  hudResize: (expanded, height) => ipcRenderer.invoke('hud:resize', { expanded, height }),
  hudSetExpanded: (expanded) => ipcRenderer.invoke('hud:setExpanded', expanded),
  hudGetMetrics: () => ipcRenderer.invoke('hud:getMetrics'),
  hudToggleMainApp: () => ipcRenderer.invoke('hud:toggleMainApp'),
  hudClose: () => ipcRenderer.invoke('hud:close'),
  onHudFocus: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('hud:focus', handler);
    return () => ipcRenderer.removeListener('hud:focus', handler);
  }
});
