const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // App info
  versions: {
    node: () => process.versions.node,
    electron: () => process.versions.electron
  },
  
  // Ollama functions
  ollama: {
    generateReport: (notes) => ipcRenderer.invoke('generate-report', notes),
    generateClarificationQuestions: (notes) => ipcRenderer.invoke('generate-clarification-questions', notes),
    generateReportWithClarifications: (notes, clarifications) => 
      ipcRenderer.invoke('generate-report-with-clarifications', notes, clarifications),
    generateConversationalResponse: (contextPrompt) => 
      ipcRenderer.invoke('generate-conversational-response', contextPrompt),
    checkConnection: () => ipcRenderer.invoke('check-ollama-connection'),
    getModels: () => ipcRenderer.invoke('get-ollama-models'),
    setModel: (model) => ipcRenderer.invoke('set-ollama-model', model),
    getPromptFile: () => ipcRenderer.invoke('get-prompt-file'),
    setPromptFile: (promptFile) => ipcRenderer.invoke('set-prompt-file', promptFile),
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    evaluateModelCompatibility: (modelName) => ipcRenderer.invoke('evaluate-model-compatibility', modelName)
  },
  
  // File operations
  files: {
    saveReport: (reportText, filename) => ipcRenderer.invoke('save-report', reportText, filename),
    loadNotes: () => ipcRenderer.invoke('load-notes'),
    loadDocFile: (filename) => ipcRenderer.invoke('load-doc-file', filename),
    loadPromptFile: (filename) => ipcRenderer.invoke('load-prompt-file', filename)
  },
  
  // Session management
  sessions: {
    save: (sessionData) => ipcRenderer.invoke('save-session', sessionData),
    loadList: () => ipcRenderer.invoke('load-sessions-list'),
    load: (sessionId) => ipcRenderer.invoke('load-session', sessionId),
    delete: (sessionId) => ipcRenderer.invoke('delete-session', sessionId),
    cleanup: () => ipcRenderer.invoke('cleanup-sessions')
  }
});