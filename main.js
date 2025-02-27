// Central error handler for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ollamaClient = require('./src/ollama');

// Centralized error handler
const errorHandler = {
  log: (message, error) => {
    console.error(`Error: ${message}`, error);
  },
  showError: (message, error) => {
    console.error(`Error: ${message}`, error);
    dialog.showErrorBox('Error', `${message}: ${error.message}`);
    return null;
  }
};

let mainWindow;
const sessionsDirectory = path.join(app.getPath('userData'), 'sessions');

/**
 * Session Manager class to handle all session operations
 */
class SessionManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.ensureDirectoryExists();
  }
  
  ensureDirectoryExists() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }
  
  getSessionPath(sessionId) {
    return path.join(this.baseDir, `${sessionId}.json`);
  }
  
  async save(sessionData) {
    try {
      this.ensureDirectoryExists();
      
      // ensure session has required fields
      const timestamp = new Date().toISOString();
      
      // if no ID exists, create one
      if (!sessionData.id) {
        sessionData.id = crypto.randomBytes(16).toString('hex');
      }
      
      // update timestamp
      sessionData.savedAt = timestamp;
      
      // write to disk
      const filePath = this.getSessionPath(sessionData.id);
      fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf8');
      
      return { success: true, id: sessionData.id };
    } catch (error) {
      errorHandler.log('Failed to save session', error);
      return { success: false, error: error.message };
    }
  }
  
  async load(sessionId) {
    try {
      const filePath = this.getSessionPath(sessionId);
      
      if (!fs.existsSync(filePath)) {
        return null;
      }
      
      const rawData = fs.readFileSync(filePath, 'utf8');
      const sessionData = JSON.parse(rawData);
      
      // ensure the ID matches the filename
      sessionData.id = sessionId;
      
      return sessionData;
    } catch (error) {
      errorHandler.log(`Failed to load session ${sessionId}`, error);
      return null;
    }
  }
  
  async delete(sessionId) {
    try {
      const filePath = this.getSessionPath(sessionId);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      errorHandler.log(`Failed to delete session ${sessionId}`, error);
      return false;
    }
  }
  
  async loadList() {
    try {
      this.ensureDirectoryExists();
      
      const sessions = fs.readdirSync(this.baseDir)
        .filter(file => file.endsWith('.json'))
        .map(file => {
          try {
            const filePath = path.join(this.baseDir, file);
            const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
              id: path.basename(file, '.json'),
              title: sessionData.title,
              patientName: sessionData.patientName,
              savedAt: sessionData.savedAt,
              messageCount: sessionData.messages?.length || 0
            };
          } catch (err) {
            errorHandler.log(`Error reading session file ${file}`, err);
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
      
      return sessions;
    } catch (error) {
      errorHandler.log('Failed to load sessions list', error);
      return [];
    }
  }
  
  async cleanup() {
    try {
      const sessions = await this.loadList();
      
      // find problematic sessions
      const problematicSessions = sessions.filter(session => {
        return !session.title && !session.patientName;
      });
      
      console.log(`Found ${problematicSessions.length} problematic sessions to clean up`);
      
      // delete them
      for (const session of problematicSessions) {
        await this.delete(session.id);
      }
      
      return problematicSessions.length;
    } catch (error) {
      errorHandler.log('Error during cleanup', error);
      return 0;
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Phys.IO',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setTitle('Phys.IO');
  
  // Only open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Initialize the SessionManager
const sessionManager = new SessionManager(sessionsDirectory);

// Initialize the app
app.whenReady().then(async () => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Error handler factory
function createIpcHandler(handlerFn, errorOptions = {}) {
  const { errorMessage = 'Error in IPC handler', consoleOnly = false, fallbackValue = null } = errorOptions;
  
  return async (event, ...args) => {
    try {
      return await handlerFn(event, ...args);
    } catch (error) {
      if (consoleOnly) {
        errorHandler.log(errorMessage, error);
      } else {
        errorHandler.showError(errorMessage, error);
      }
      
      return fallbackValue;
    }
  };
}

// Function to register multiple handlers at once
function registerIpcHandlers(handlers) {
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, createIpcHandler(handler.fn, handler.options));
  });
}

// IPC Handlers - Ollama client functions
registerIpcHandlers({
  'generate-report': {
    fn: async (event, notes) => await ollamaClient.generateReport(notes),
    options: { errorMessage: 'Failed to generate report' }
  },
  'generate-clarification-questions': {
    fn: async (event, notes) => await ollamaClient.generateClarificationQuestions(notes),
    options: { errorMessage: 'Failed to generate clarification questions', consoleOnly: true, fallbackValue: [] }
  },
  'generate-report-with-clarifications': {
    fn: async (event, notes, clarifications) => await ollamaClient.generateReportWithClarifications(notes, clarifications),
    options: { errorMessage: 'Failed to generate report with clarifications' }
  },
  'generate-conversational-response': {
    fn: async (event, contextPrompt) => await ollamaClient.generateConversationalResponse(contextPrompt),
    options: { errorMessage: 'Failed to generate response' }
  },
  // Ollama connection and settings
  'check-ollama-connection': {
    fn: async () => await ollamaClient.checkConnection(),
    options: { errorMessage: 'Failed to check Ollama connection', consoleOnly: true, fallbackValue: false }
  },
  'get-ollama-models': {
    fn: async () => await ollamaClient.getAvailableModels(),
    options: { errorMessage: 'Failed to get Ollama models', consoleOnly: true, fallbackValue: [] }
  },
  'set-ollama-model': {
    fn: async (event, model) => {
      ollamaClient.setModel(model);
      return true;
    },
    options: { errorMessage: 'Failed to set Ollama model', consoleOnly: true, fallbackValue: false }
  },
  'get-prompt-file': {
    fn: async () => ollamaClient.getPromptFile(),
    options: { errorMessage: 'Failed to get prompt file', consoleOnly: true, fallbackValue: 'v3.txt' }
  },
  'set-prompt-file': {
    fn: async (event, promptFile) => {
      ollamaClient.setPromptFile(promptFile);
      return true;
    },
    options: { errorMessage: 'Failed to set prompt file', consoleOnly: true, fallbackValue: false }
  },
  // System information
  'get-system-info': {
    fn: async () => await ollamaClient.getSystemInfo(),
    options: { errorMessage: 'Failed to get system info', consoleOnly: true, fallbackValue: null }
  },
  'evaluate-model-compatibility': {
    fn: async (event, modelName) => {
      const systemInfo = await ollamaClient.getSystemInfo();
      return ollamaClient.evaluateModelCompatibility(modelName, systemInfo);
    },
    options: { 
      errorMessage: 'Failed to evaluate model compatibility',
      consoleOnly: true, 
      fallbackValue: {
        modelSizeInB: null,
        comfortLevel: 'Unknown',
        message: 'Could not determine compatibility.',
        loadingMessage: null
      }
    }
  }
});

// File loading utility function
function loadContentFile(basePath, filename) {
  try {
    const filePath = path.join(__dirname, basePath, filename);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return null;
  } catch (error) {
    errorHandler.log(`Error loading file ${filename} from ${basePath}`, error);
    return null;
  }
}

// Session management handlers
registerIpcHandlers({
  'save-session': {
    fn: async (event, sessionData) => sessionManager.save(sessionData),
    options: { 
      errorMessage: 'Failed to save session', 
      consoleOnly: false, 
      fallbackValue: { success: false, error: 'Failed to save session' } 
    }
  },
  'load-sessions-list': {
    fn: async () => sessionManager.loadList(),
    options: { errorMessage: 'Failed to load sessions list', consoleOnly: true, fallbackValue: [] }
  },
  'load-session': {
    fn: async (event, sessionId) => sessionManager.load(sessionId),
    options: { errorMessage: 'Failed to load session', consoleOnly: false, fallbackValue: null }
  },
  'delete-session': {
    fn: async (event, sessionId) => sessionManager.delete(sessionId),
    options: { errorMessage: 'Failed to delete session', consoleOnly: true, fallbackValue: false }
  },
  'cleanup-sessions': {
    fn: async () => sessionManager.cleanup(),
    options: { errorMessage: 'Failed to clean up sessions', consoleOnly: true, fallbackValue: 0 }
  },
  // File operations
  'save-report': {
    fn: async (event, reportText, suggestedName) => {
      const defaultPath = suggestedName 
        ? path.join(app.getPath('documents'), suggestedName) 
        : path.join(app.getPath('documents'), 'physio-report.txt');
        
      const { filePath } = await dialog.showSaveDialog({
        defaultPath,
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (filePath) {
        fs.writeFileSync(filePath, reportText);
        return true;
      }
      return false;
    },
    options: { errorMessage: 'Failed to save report', consoleOnly: false, fallbackValue: false }
  },
  'load-notes': {
    fn: async () => {
      const { filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (filePaths && filePaths.length > 0) {
        return fs.readFileSync(filePaths[0], 'utf8');
      }
      return null;
    },
    options: { errorMessage: 'Failed to load notes', consoleOnly: false, fallbackValue: null }
  },
  'load-doc-file': {
    fn: async (event, filename) => {
      const content = loadContentFile('docs', filename);
      if (content === null) {
        return `Error: Document file "${filename}" not found`;
      }
      return content;
    },
    options: { 
      errorMessage: 'Failed to load document file', 
      consoleOnly: true, 
      fallbackValue: 'Error: Could not load the requested document file' 
    }
  },
  'load-prompt-file': {
    fn: async (event, filename) => {
      const content = loadContentFile('prompts', filename);
      if (content === null) {
        console.warn(`Prompt file not found: ${filename}`);
      }
      return content;
    },
    options: { errorMessage: 'Failed to load prompt file', consoleOnly: true, fallbackValue: null }
  }
});